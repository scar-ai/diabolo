import "@tanstack/react-start/server-only";
import { Log } from "@/lib/log";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { SandboxEvents } from "@/lib/sandbox/events";
import { SandboxRun } from "@/lib/sandbox/run";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import {
  cancelPendingTaskMessages,
  claimNextTaskMessage,
  clearTaskCancellation,
  findNextPendingTaskMessage,
  findProcessingTaskMessage,
  findStaleProcessingMessage,
  updateTaskMessageRecord,
  updateTaskRecord,
} from "@/lib/sandbox/store";

const log = Log.create({ ns: "sandbox.queue" });

const PROCESSING_STALE_MS = 10 * 60 * 1000;

const activeProcessors = new Set<string>();
const sandboxProvider = getSandboxProvider();

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

  const staleMessage = await findStaleProcessingMessage(
    taskId,
    new Date(Date.now() - PROCESSING_STALE_MS),
  );

  if (!staleMessage) {
    return;
  }

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
  await SandboxRuntimeState.publishChildSnapshot(taskId);
};

const drainTaskQueue = async (taskId: string) => {
  if (activeProcessors.has(taskId)) {
    return;
  }

  activeProcessors.add(taskId);

  try {
    for (;;) {
      const claimed = await claimNextTaskMessage(taskId);

      if (!claimed) {
        break;
      }

      await SandboxRun.processMessage(taskId, claimed.id, sandboxProvider);
    }
  } finally {
    activeProcessors.delete(taskId);

    if (await hasWorkRemaining(taskId)) {
      queueMicrotask(() => {
        void drainTaskQueue(taskId);
      });
    }
  }
};

export namespace SandboxQueue {
  export const enqueue = async (taskId: string) => {
    await clearTaskCancellation(taskId);
    await recoverStaleProcessing(taskId);
    await SandboxRuntimeState.setTaskStage({
      stage: "Queued",
      status: "queued",
      taskId,
    });
    queueMicrotask(() => {
      void drainTaskQueue(taskId);
    });
  };

  export const resume = async (taskId: string) => {
    await recoverStaleProcessing(taskId);

    if (await hasWorkRemaining(taskId)) {
      queueMicrotask(() => {
        void drainTaskQueue(taskId);
      });
    }
  };

  export const terminate = async (taskId: string) => {
    const now = new Date();

    await cancelPendingTaskMessages(taskId, "Task was terminated by user.");

    const processing = await findProcessingTaskMessage(taskId);

    if (processing) {
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
    await SandboxRuntimeState.publishChildSnapshot(taskId);

    log.info("task terminated", { taskId });
  };
}
