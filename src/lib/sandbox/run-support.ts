import { type ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import type { JsonObject } from "@/lib/json";
import { Log } from "@/lib/log";
import {
  isRuntimeEventLine,
  parseRuntimeEventLine,
  type RuntimeEventEnvelope,
  type RuntimeRunCompletedPayload,
} from "@/lib/opencode/protocol";
import { Sandbox } from "@/lib/sandbox";
import { AgentStream } from "@/lib/sandbox/agent-stream";
import { SandboxEvents } from "@/lib/sandbox/events";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import {
  appendTaskMessageLog,
  findTaskMessage,
  isTaskCancellationRequested,
  updateTaskMessageRecord,
  updateTaskRecord,
  type TaskRecord,
} from "@/lib/sandbox/store";
import { formatToolActivity } from "@/lib/task-activity";
import { buildTaskScreenshotMetadata, TASK_SCREENSHOT_ARTIFACT_TYPE } from "@/lib/task-artifacts";

const read = (value: string) => value.trim();
const log = Log.create({ ns: "sandbox.command" });

const extractStructuredCommandError = (output: string) =>
  output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as { error?: unknown; success?: unknown }];
      } catch {
        return [];
      }
    })
    .find(
      (entry) =>
        entry &&
        entry.success === false &&
        typeof entry.error === "string" &&
        entry.error.trim().length > 0,
    )?.error as string | undefined;

export const unwrapResult = async <T>(result: ResultAsync<T, Error>): Promise<T> => {
  const res = await result;

  if (res.isErr()) {
    throw res.error;
  }

  return res.value;
};

export const getTaskProjectEnvVars = (value: string | null | undefined): Record<string, string> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {}
  return {};
};

export const updateMessageStage = async (
  taskId: string,
  messageId: string,
  stage: string,
  taskStatus: "queued" | "running" | "succeeded" | "failed" = "running",
) => {
  await Promise.all([
    SandboxRuntimeState.setTaskStage({
      messageId,
      stage,
      status: taskStatus,
      taskId,
    }),
    updateTaskMessageRecord(messageId, {
      stage,
    }),
  ]);
};

export const failMessageExecution = async (
  taskId: string,
  messageId: string,
  errorMessage: string,
  stage: string,
) => {
  const currentMessage = await findTaskMessage(messageId);

  if (!currentMessage || currentMessage.status !== "processing") {
    return;
  }

  // Keep whatever text the agent had produced before it failed.
  await AgentStream.finalize(messageId);

  const completedAt = new Date();

  await Promise.all([
    updateTaskRecord(taskId, {
      completedAt,
      error: errorMessage,
      lastHeartbeatAt: completedAt,
      sandboxStatus: "failed",
      stage,
      status: "failed",
    }),
    updateTaskMessageRecord(messageId, {
      completedAt,
      executionTimeoutAt: null,
      error: errorMessage,
      stage,
      status: "failed",
    }),
  ]);
  await SandboxEvents.publish({
    messageId,
    payload: {
      error: errorMessage,
      stage,
    },
    taskId,
    type: "error",
  });
  await SandboxEvents.publish({
    messageId,
    payload: {
      status: "failed",
    },
    taskId,
    type: "execution_complete",
  });
  await SandboxRuntimeState.publishChildSnapshot(taskId);
};

export const completeMessageExecution = async (
  taskId: string,
  messageId: string,
  stage: string,
  taskPatch?: Partial<TaskRecord>,
) => {
  const currentMessage = await findTaskMessage(messageId);

  if (!currentMessage || currentMessage.status !== "processing") {
    return;
  }

  await AgentStream.finalize(messageId);

  const completedAt = new Date();

  await Promise.all([
    updateTaskRecord(taskId, {
      completedAt,
      error: null,
      lastHeartbeatAt: completedAt,
      stage,
      status: "succeeded",
      ...(taskPatch ?? {}),
    }),
    updateTaskMessageRecord(messageId, {
      completedAt,
      executionTimeoutAt: null,
      error: null,
      stage,
      status: "completed",
    }),
  ]);
  await SandboxEvents.publish({
    messageId,
    payload: {
      branchName: taskPatch?.branchName ?? null,
      prNumber: taskPatch?.prNumber ?? null,
      prUrl: taskPatch?.prUrl ?? null,
      sandboxStatus: taskPatch?.sandboxStatus ?? null,
      stage,
      status: "succeeded",
    },
    taskId,
    type: "execution_complete",
  });
  await SandboxRuntimeState.publishChildSnapshot(taskId);
};

export const assertTaskNotCancelled = async (taskId: string) => {
  const cancelRequestedAt = await isTaskCancellationRequested(taskId);

  if (cancelRequestedAt) {
    throw new Error("Task was terminated by user.");
  }
};

export const runSandboxCommand = async (
  sandbox: Sandbox.Session,
  taskId: string,
  messageId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout = 0,
  label = "sandbox command",
) => {
  const startedAt = Date.now();
  let streamedOutput = false;
  const heartbeatIntervalMs = 20_000;
  const op = log.child({
    label,
    messageId,
    sandboxId: sandbox.id,
    taskId,
  });

  await SandboxRuntimeState.touchHeartbeat(taskId);
  let handledFailure = false;
  const heartbeatTimer = setInterval(() => {
    void SandboxRuntimeState.touchHeartbeat(taskId);
  }, heartbeatIntervalMs);
  const publishLogChunk = async (chunk: string, stream: "stdout" | "stderr" | "output") => {
    await appendTaskMessageLog(messageId, chunk);
    await SandboxEvents.publish({
      messageId,
      payload: {
        chunk,
        stream,
      },
      taskId,
      type: "log",
    });
    await SandboxRuntimeState.touchHeartbeat(taskId);
  };

  try {
    const response = await sandbox.executeCommand(command, {
      cwd,
      envVars,
      onStderrChunk: async (chunk) => {
        if (!chunk) {
          return;
        }

        streamedOutput = true;
        await publishLogChunk(chunk, "stderr");
      },
      onStdoutChunk: async (chunk) => {
        if (!chunk) {
          return;
        }

        streamedOutput = true;
        await publishLogChunk(chunk, "stdout");
      },
      timeoutSeconds: timeout,
    });

    if (response.output && !streamedOutput) {
      await publishLogChunk(`${response.output}\n`, "output");
    }

    if (response.exitCode !== 0) {
      handledFailure = true;
      const structuredError = extractStructuredCommandError(response.output);
      op.warn("sandbox command failed", {
        durationMs: Date.now() - startedAt,
        exitCode: response.exitCode,
        outputChars: response.output.length,
      });
      throw new Error(
        structuredError ||
          read(response.output) ||
          `Command failed with exit code ${response.exitCode}.`,
      );
    }

    await assertTaskNotCancelled(taskId);
    await SandboxRuntimeState.touchHeartbeat(taskId);

    op.info("sandbox command completed", {
      durationMs: Date.now() - startedAt,
      exitCode: response.exitCode,
      outputChars: response.output.length,
    });

    return response;
  } catch (error) {
    if (!handledFailure) {
      op.error("sandbox command errored", {
        durationMs: Date.now() - startedAt,
        error,
      });
    }

    throw error;
  } finally {
    clearInterval(heartbeatTimer);
  }
};

export const runSandboxBackgroundCommand = async (
  sandbox: Sandbox.Session,
  taskId: string,
  messageId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout = 0,
  label = "sandbox background command",
) => {
  const startedAt = Date.now();
  const pollIntervalMs = 2_000;
  const op = log.child({
    label,
    messageId,
    sandboxId: sandbox.id,
    taskId,
  });
  let backgroundCommand: Sandbox.BackgroundCommand | null = null;
  let handledFailure = false;
  let lastOutput = "";
  let pendingLine = "";
  // Captured as the run's `run_completed` event streams past, so callers get the
  // agent's result directly instead of re-parsing the command's whole output.
  let runResult: RuntimeRunCompletedPayload | null = null;

  // stdout is the runtime's authoritative event channel: it is ordered, it
  // survives an unreachable app, and the host already polls it. Separate the
  // protocol lines from ordinary output so the UI advances during the run rather
  // than only once the command exits.
  const drainRuntimeEvents = async (chunk: string) => {
    const lines = (pendingLine + chunk).split("\n");
    pendingLine = lines.pop() ?? "";
    const logLines: string[] = [];

    for (const line of lines) {
      if (!isRuntimeEventLine(line)) {
        logLines.push(line);
        continue;
      }

      const envelope = parseRuntimeEventLine(line);

      if (!envelope) {
        op.warn("discarded malformed runtime event line");
        continue;
      }

      const outcome = await ingestRuntimeEvent(envelope);

      if (outcome?.result) {
        runResult = outcome.result;
      }
    }

    return logLines.length > 0 ? `${logLines.join("\n")}\n` : "";
  };

  const publishLog = async (chunk: string) => {
    if (!chunk) {
      return;
    }

    await appendTaskMessageLog(messageId, chunk);
    await SandboxEvents.publish({
      messageId,
      payload: {
        chunk,
        stream: "output",
      },
      taskId,
      type: "log",
    });
  };

  const publishOutput = async (output: string) => {
    // A poll that came back empty failed to read the logs; it does not mean the
    // command produced nothing. Taking it at face value would rewind the cursor
    // and republish the whole run's output on the next successful read.
    if (!output || output === lastOutput) {
      return;
    }

    const rawChunk = output.startsWith(lastOutput) ? output.slice(lastOutput.length) : output;
    lastOutput = output;

    if (!rawChunk) {
      return;
    }

    await publishLog(await drainRuntimeEvents(rawChunk));
  };

  // Output that never ended in a newline is still held back in the line buffer,
  // so flush it once the command is done rather than dropping it.
  const flushPendingOutput = async () => {
    if (!pendingLine) {
      return;
    }

    await publishLog(await drainRuntimeEvents("\n"));
  };

  await SandboxRuntimeState.touchHeartbeat(taskId);

  try {
    backgroundCommand = await sandbox.startBackgroundCommand(command, {
      cwd,
      envVars,
      timeoutSeconds: timeout,
    });

    for (;;) {
      await assertTaskNotCancelled(taskId);

      if (timeout > 0 && Date.now() - startedAt >= timeout * 1_000) {
        throw new Error(`Background command timed out after ${timeout} seconds.`);
      }

      const state = await sandbox.getBackgroundCommand(backgroundCommand);
      await publishOutput(state.output);
      await SandboxRuntimeState.touchHeartbeat(taskId);

      if (typeof state.exitCode === "number") {
        await flushPendingOutput();

        if (state.exitCode !== 0) {
          handledFailure = true;
          const structuredError = extractStructuredCommandError(state.output);
          op.warn("sandbox background command failed", {
            durationMs: Date.now() - startedAt,
            exitCode: state.exitCode,
            outputChars: state.output.length,
          });
          throw new Error(
            structuredError ||
              read(state.output) ||
              `Command failed with exit code ${state.exitCode}.`,
          );
        }

        op.info("sandbox background command completed", {
          durationMs: Date.now() - startedAt,
          exitCode: state.exitCode,
          outputChars: state.output.length,
          hasRunResult: Boolean(runResult),
        });

        return {
          exitCode: state.exitCode,
          output: state.output,
          runResult,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } catch (error) {
    if (!handledFailure) {
      op.error("sandbox background command errored", {
        durationMs: Date.now() - startedAt,
        error,
      });
    }
    throw error;
  } finally {
    if (backgroundCommand) {
      await sandbox.stopBackgroundCommand(backgroundCommand);
    }
  }
};

/**
 * Applies one protocol event from the sandbox runtime.
 *
 * The runtime delivers every event twice on purpose — once on stdout, which is
 * ordered and always readable, and once over HTTP where the sandbox can reach
 * the app — so this is idempotent by design and safe to call for both copies.
 */
export const ingestRuntimeEvent = async (envelope: RuntimeEventEnvelope) => {
  const outcome = await AgentStream.ingest(envelope);

  if (!outcome) {
    return null;
  }

  switch (envelope.type) {
    case "run_started": {
      await updateMessageStage(envelope.taskId, envelope.messageId, "Agent is working");
      break;
    }

    case "tool_start": {
      await updateMessageStage(
        envelope.taskId,
        envelope.messageId,
        formatToolActivity(envelope.payload),
      );
      await SandboxEvents.publish({
        messageId: envelope.messageId,
        payload: envelope.payload,
        taskId: envelope.taskId,
        type: "tool_call",
      });
      break;
    }

    case "token_usage": {
      // Broadcast only. The authoritative, billable usage is reconciled from
      // the usage log the runtime writes when the run finishes.
      SandboxEvents.broadcast({
        messageId: envelope.messageId,
        payload: envelope.payload,
        taskId: envelope.taskId,
        type: "token_usage",
      });
      break;
    }

    case "tool_end": {
      await SandboxEvents.publish({
        messageId: envelope.messageId,
        payload: envelope.payload,
        taskId: envelope.taskId,
        type: "tool_result",
      });
      await detectArtifacts(envelope.taskId, envelope.messageId, envelope.payload);
      break;
    }

    default:
      break;
  }

  return outcome;
};

const detectArtifacts = async (taskId: string, messageId: string, payload: JsonObject) => {
  const parseEmbeddedPayload = (value: unknown): JsonObject | null => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonObject;
    }

    if (typeof value !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : null;
    } catch {
      return null;
    }
  };

  const state =
    typeof payload.part === "object" && payload.part
      ? ((payload.part as JsonObject).state as JsonObject | undefined)
      : undefined;

  const candidates = [
    payload,
    parseEmbeddedPayload(state?.output),
    parseEmbeddedPayload(
      typeof state?.metadata === "object" && state.metadata
        ? (state.metadata as JsonObject).output
        : null,
    ),
  ].filter((value): value is JsonObject => Boolean(value));

  for (const candidate of candidates) {
    const screenshotPath = typeof candidate.path === "string" ? candidate.path.trim() : "";
    const url =
      (typeof candidate.url === "string" && candidate.url) ||
      (typeof candidate.prUrl === "string" && candidate.prUrl) ||
      (typeof candidate.previewUrl === "string" && candidate.previewUrl) ||
      (typeof candidate.screenshotUrl === "string" && candidate.screenshotUrl);

    if (screenshotPath && /\.(png|jpe?g|webp)$/i.test(screenshotPath)) {
      const artifactId = crypto.randomUUID();

      await SandboxEvents.publishArtifact({
        id: artifactId,
        messageId,
        metadata: buildTaskScreenshotMetadata(screenshotPath, candidate),
        taskId,
        type: TASK_SCREENSHOT_ARTIFACT_TYPE,
        url: `/api/tasks/${taskId}/artifacts/${artifactId}`,
      });
      continue;
    }

    if (!url) {
      continue;
    }

    const type =
      (typeof candidate.type === "string" && candidate.type) ||
      (url.includes("/pull/")
        ? "pull_request"
        : url.match(/\.(png|jpg|jpeg|webp)$/i)
          ? TASK_SCREENSHOT_ARTIFACT_TYPE
          : "link");

    await SandboxEvents.publishArtifact({
      messageId,
      metadata: candidate,
      taskId,
      type,
      url,
    });
  }
};

export const syncGitHandoffState = async (input: {
  messageId: string;
  repoDefaultBranch: string;
  repoId: string | null;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) => {
  const branch = await runSandboxCommand(
    input.sandbox,
    input.taskId,
    input.messageId,
    "git branch --show-current",
    input.sandboxPath,
    undefined,
    30,
    "detect current branch",
  );
  const branchName = read(branch.output) || null;

  let pr: { number: number; url: string } | null = null;

  if (branchName && input.repoId && branchName !== input.repoDefaultBranch) {
    pr = await Github.findOpenPullRequestForBranch({
      branch: branchName,
      repoId: input.repoId,
    }).match(
      (value) => value,
      () => null,
    );
  }

  await updateTaskRecord(input.taskId, {
    branchName,
    prNumber: pr?.number ?? null,
    prUrl: pr?.url ?? null,
  });

  if (branchName) {
    await SandboxEvents.publishArtifact({
      metadata: { branchName },
      taskId: input.taskId,
      type: "branch",
      url: branchName,
    });
  }

  if (pr) {
    await SandboxEvents.publishArtifact({
      metadata: {
        branchName,
        prNumber: pr.number,
        prUrl: pr.url,
      },
      taskId: input.taskId,
      type: "pull_request",
      url: pr.url,
    });
  }

  return {
    branchName,
    prNumber: pr?.number ?? null,
    prUrl: pr?.url ?? null,
  };
};
