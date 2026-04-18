import "@tanstack/react-start/server-only";
import { Log } from "@/lib/log";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { SandboxEvents } from "@/lib/sandbox/events";
import { abortOpenCodePrompt } from "@/lib/sandbox/opencode-host";
import { SandboxRun } from "@/lib/sandbox/run";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import {
  cancelPendingTaskMessages,
  claimNextTaskMessage,
  clearTaskCancellation,
  findNextPendingTaskMessage,
  findProcessingTaskMessage,
  findStaleProcessingMessage,
  findTaskRecord,
  recomputeTaskMessageQueuePositions,
  updateTaskMessageRecord,
  updateTaskRecord,
} from "@/lib/sandbox/store";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";

const log = Log.create({ ns: "sandbox.queue" });

const PROCESSING_STALE_MS = 10 * 60 * 1000;
const MESSAGE_EXECUTION_TIMEOUT_MS = 90 * 60 * 1000;

const activeProcessors = new Set<string>();
const sandboxProvider = getSandboxProvider();

const abortRunningPrompt = async (taskId: string) => {
  const [taskRecord, processingMessage] = await Promise.all([
    findTaskRecord(taskId),
    findProcessingTaskMessage(taskId),
  ]);

  if (!taskRecord?.sandboxId || !taskRecord.sandboxPath) {
    return;
  }

  try {
    const sandbox = await sandboxProvider.getWorkspace(taskRecord.sandboxId);
    await abortOpenCodePrompt({
      messageId: processingMessage?.id ?? taskId,
      run: async (session, _taskId, _messageId, command, cwd, envVars, timeoutSeconds) =>
        session.executeCommand(command, {
          cwd,
          envVars,
          timeoutSeconds,
        }),
      sandbox,
      sandboxPath: taskRecord.sandboxPath,
      taskId,
    });
  } catch (error) {
    log.warn("failed to abort persistent opencode prompt", { error, taskId });
  }
};

const hasWorkRemaining = async (taskId: string) => {
  const [pending, processing] = await Promise.all([
    findNextPendingTaskMessage(taskId),
    findProcessingTaskMessage(taskId),
  ]);

  return Boolean(pending || processing);
};

const recoverStaleProcessing = async (taskId: string) => {
  if (activeProcessors.has(taskId)) {
    return;
  }

  const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
  const taskRecord = await findTaskRecord(taskId);

  if (taskRecord?.lastHeartbeatAt && taskRecord.lastHeartbeatAt > staleBefore) {
    return;
  }

  const staleMessage = await findStaleProcessingMessage(taskId, staleBefore);

  if (!staleMessage) {
    return;
  }

  log.warn("recovering stale processing message", {
    messageId: staleMessage.id,
    staleBefore: staleBefore.toISOString(),
    taskId,
  });

  await updateTaskMessageRecord(staleMessage.id, {
    completedAt: new Date(),
    error: "Task execution was interrupted. The prompt was not completed.",
    stage: "Execution interrupted",
    status: "failed",
  });

  const pending = await findNextPendingTaskMessage(taskId);

  await updateTaskRecord(taskId, {
    completedAt: pending ? null : new Date(),
    error: pending ? null : "Task execution was interrupted.",
    sandboxStatus: pending ? "stale" : "failed",
    lastHeartbeatAt: new Date(),
    stage: pending ? "Queued next prompt" : "Task interrupted",
    status: pending ? "queued" : "failed",
  });
  await SandboxEvents.publish({
    messageId: staleMessage.id,
    payload: {
      messageId: staleMessage.id,
      reason: "processing_stale",
    },
    taskId,
    type: "error",
  });
  await recomputeTaskMessageQueuePositions(taskId);
  await SandboxRuntimeState.publishChildSnapshot(taskId);
};

const publishPromptQueued = async (taskId: string) => {
  const pending = await findNextPendingTaskMessage(taskId);

  if (!pending) {
    return;
  }

  await SandboxEvents.publish({
    messageId: pending.id,
    payload: {
      model: pending.model,
      queuePosition: pending.queuePosition,
      reasoningEffort: pending.reasoningEffort,
      sequence: pending.sequence,
    },
    taskId,
    type: "prompt_queued",
  });
};

const publishPromptDispatched = async (taskId: string, messageId: string) => {
  const message = await findProcessingTaskMessage(taskId);

  if (!message || message.id !== messageId) {
    return;
  }

  await SandboxEvents.publish({
    messageId,
    payload: {
      dispatchedAt: message.dispatchedAt?.toISOString() ?? null,
      executionTimeoutAt: message.executionTimeoutAt?.toISOString() ?? null,
      model: message.model,
      reasoningEffort: message.reasoningEffort,
      sequence: message.sequence,
    },
    taskId,
    type: "prompt_dispatched",
  });
};

const handleMessageExecutionTimeout = async (taskId: string, messageId: string) => {
  const processingMessage = await findProcessingTaskMessage(taskId);

  if (!processingMessage || processingMessage.id !== messageId) {
    return;
  }

  const completedAt = new Date();
  const hasPending = Boolean(await findNextPendingTaskMessage(taskId));

  await abortRunningPrompt(taskId);
  await SandboxWorkspace.destroy(sandboxProvider, taskId, {
    stage: hasPending
      ? "Execution timed out; recreating sandbox for next prompt"
      : "Execution timed out",
  });

  await updateTaskMessageRecord(messageId, {
    completedAt,
    error: "Prompt execution timed out after 90 minutes.",
    executionTimeoutAt: null,
    stage: "Timed out",
    status: "failed",
  });

  await updateTaskRecord(taskId, {
    completedAt: hasPending ? null : completedAt,
    error: hasPending ? null : "Prompt execution timed out after 90 minutes.",
    lastHeartbeatAt: completedAt,
    sandboxStatus: hasPending ? "stopped" : "failed",
    stage: hasPending ? "Queued next prompt" : "Execution timed out",
    status: hasPending ? "queued" : "failed",
  });

  await SandboxEvents.publish({
    messageId,
    payload: {
      reason: "execution_timeout",
      timeoutMs: MESSAGE_EXECUTION_TIMEOUT_MS,
    },
    taskId,
    type: "error",
  });
  await SandboxEvents.publish({
    messageId,
    payload: {
      status: "failed",
      timeoutMs: MESSAGE_EXECUTION_TIMEOUT_MS,
    },
    taskId,
    type: "execution_complete",
  });
  await recomputeTaskMessageQueuePositions(taskId);
  await SandboxRuntimeState.publishChildSnapshot(taskId);
};

const runMessageWithTimeout = async (taskId: string, messageId: string) => {
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(async () => {
      timedOut = true;
      await handleMessageExecutionTimeout(taskId, messageId);
      resolve();
    }, MESSAGE_EXECUTION_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      SandboxRun.processMessage(taskId, messageId, sandboxProvider),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  if (timedOut) {
    log.error("message execution timed out", {
      messageId,
      taskId,
      timeoutMs: MESSAGE_EXECUTION_TIMEOUT_MS,
    });
  }
};

const drainTaskQueue = async (taskId: string) => {
  if (activeProcessors.has(taskId)) {
    log.debug("task queue drain skipped; processor already active", { taskId });
    return;
  }

  activeProcessors.add(taskId);
  const startedAt = Date.now();
  log.info("task queue drain started", { taskId });

  try {
    for (;;) {
      const claimed = await claimNextTaskMessage(taskId);

      if (!claimed) {
        break;
      }

      log.info("task message claimed for processing", {
        messageId: claimed.id,
        model: claimed.model,
        queuePosition: claimed.queuePosition,
        reasoningEffort: claimed.reasoningEffort,
        sequence: claimed.sequence,
        taskId,
      });

      await publishPromptDispatched(taskId, claimed.id);
      await publishPromptQueued(taskId);
      await runMessageWithTimeout(taskId, claimed.id);
    }
  } finally {
    activeProcessors.delete(taskId);
    log.info("task queue drain finished", {
      durationMs: Date.now() - startedAt,
      taskId,
    });

    if (await hasWorkRemaining(taskId)) {
      log.info("task queue still has work; scheduling another drain", { taskId });
      queueMicrotask(() => {
        void drainTaskQueue(taskId);
      });
    }
  }
};

export namespace SandboxQueue {
  export const enqueue = async (taskId: string) => {
    log.info("enqueue requested", { taskId });
    await clearTaskCancellation(taskId);
    await recoverStaleProcessing(taskId);
    await recomputeTaskMessageQueuePositions(taskId);
    await SandboxRuntimeState.setTaskStage({
      stage: "Queued",
      status: "queued",
      taskId,
    });
    await publishPromptQueued(taskId);
    queueMicrotask(() => {
      void drainTaskQueue(taskId);
    });
  };

  export const resume = async (taskId: string) => {
    log.info("resume requested", { taskId });
    await recoverStaleProcessing(taskId);

    if (await hasWorkRemaining(taskId)) {
      queueMicrotask(() => {
        void drainTaskQueue(taskId);
      });
    }
  };

  export const terminate = async (taskId: string) => {
    const now = new Date();
    log.info("termination requested", { taskId });

    await cancelPendingTaskMessages(taskId, "Task was terminated by user.");

    const processing = await findProcessingTaskMessage(taskId);

    if (processing) {
      await abortRunningPrompt(taskId);
      await updateTaskMessageRecord(processing.id, {
        error: "Termination requested by user.",
        stage: "Termination requested",
      });
    }

    await updateTaskRecord(taskId, {
      cancelRequestedAt: now,
      completedAt: now,
      error: "Task was terminated by user.",
      sandboxStatus: "failed",
      stage: "Terminated",
      status: "failed",
    });
    await SandboxEvents.publish({
      payload: {
        reason: "user_terminated",
      },
      taskId,
      type: "execution_complete",
    });
    await recomputeTaskMessageQueuePositions(taskId);
    await SandboxRuntimeState.publishChildSnapshot(taskId);

    log.info("task terminated", { taskId });
  };
}
