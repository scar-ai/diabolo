import "@tanstack/react-start/server-only";
import { SandboxProvider } from "@/sandbox/provider";
import { SandboxRun } from "@/sandbox/run";
import {
  cancelPendingTaskMessages,
  claimNextTaskMessage,
  clearTaskCancellation,
  findNextPendingTaskMessage,
  findProcessingTaskMessage,
  findStaleProcessingMessage,
  updateTaskMessageRecord,
  updateTaskRecord,
} from "@/sandbox/store";
import { Log } from "@/util/log";

const log = Log.create({ service: "sandbox.queue" });

const PROCESSING_STALE_MS = 10 * 60 * 1000;

const activeProcessors = new Set<string>();
const sandboxProvider = SandboxProvider.get();

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
    stage: pending ? "Queued next prompt" : "Task interrupted",
    status: pending ? "queued" : "failed",
  });
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
      stage: "Terminated",
      status: "failed",
    });

    log.info("task terminated", { taskId });
  };
}
