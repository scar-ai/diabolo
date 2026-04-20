import "@tanstack/react-start/server-only";
import { Log } from "@/lib/log";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import { findTaskMessage, isTaskCancellationRequested } from "@/lib/sandbox/store";

import { runFollowUpMessage, runInitialMessage } from "./run-execution";
import { failMessageExecution } from "./run-support";

const log = Log.create({ ns: "sandbox.run" });

export namespace SandboxRun {
  export const processMessage = async (
    taskId: string,
    messageId: string,
    provider: { formatError(error: unknown): string },
  ) => {
    const op = log.child({ messageId, taskId });
    const message = await findTaskMessage(messageId);

    if (!message) {
      op.warn("message missing before processing");
      return;
    }

    try {
      op.info("message processing started", {
        kind: message.kind,
        sequence: message.sequence,
      });
      await SandboxRuntimeState.setSandboxStatus(taskId, "running");
      if (message.kind === "initial") {
        await runInitialMessage(taskId, messageId);
      } else {
        await runFollowUpMessage(taskId, messageId);
      }

      op.info("message completed");
    } catch (error) {
      const formattedError = provider.formatError(error);
      await failMessageExecution(
        taskId,
        messageId,
        formattedError,
        message.kind === "initial" ? "Task failed" : "Follow-up failed",
      );
      op.error("message failed", { error });
    } finally {
      if (
        (await isTaskCancellationRequested(taskId)) &&
        (await findTaskMessage(messageId))?.status === "completed"
      ) {
        await failMessageExecution(taskId, messageId, "Task was terminated by user.", "Terminated");
      }
    }
  };
}
