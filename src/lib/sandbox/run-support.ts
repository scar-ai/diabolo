import { type ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import type { JsonObject } from "@/lib/json";
import { Log } from "@/lib/log";
import { Sandbox } from "@/lib/sandbox";
import { SandboxEvents } from "@/lib/sandbox/events";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import {
  appendTaskMessageLog,
  findTaskMessage,
  isTaskCancellationRequested,
  setTaskAgentResponse,
  setTaskMessageAgentResponse,
  updateTaskMessageRecord,
  updateTaskRecord,
  type TaskRecord,
} from "@/lib/sandbox/store";
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

export const recordRuntimeAgentEvent = async (input: {
  messageId: string;
  payload: JsonObject;
  taskId: string;
  type: string;
}) => {
  const timestamp =
    typeof input.payload.timestamp === "number" ? input.payload.timestamp : Date.now();

  if (input.type === "token" && typeof input.payload.text === "string") {
    await setTaskMessageAgentResponse(input.messageId, input.payload.text, timestamp);

    const message = await findTaskMessage(input.messageId);
    if (message?.kind === "initial" || message?.sequence === 0) {
      await setTaskAgentResponse(input.taskId, input.payload.text, timestamp);
    }
  }

  await SandboxEvents.publish({
    messageId: input.messageId,
    payload: input.payload,
    taskId: input.taskId,
    type: input.type,
  });
  await detectArtifacts(input.taskId, input.messageId, input.payload);
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
