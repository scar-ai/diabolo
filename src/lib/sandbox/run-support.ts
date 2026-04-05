import { Buffer } from "node:buffer";

import { type ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import type { JsonObject } from "@/lib/json";
import { buildOpenCodeConfigContent } from "@/lib/opencode/config";
import { Sandbox } from "@/lib/sandbox";
import { SandboxEvents } from "@/lib/sandbox/events";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import {
  appendTaskAgentMessage,
  appendTaskMessageAgentMessage,
  appendTaskMessageLog,
  findTaskMessage,
  isTaskCancellationRequested,
  updateTaskMessageRecord,
  updateTaskRecord,
  type TaskRecord,
} from "@/lib/sandbox/store";

const read = (value: string) => value.trim();

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
) => {
  await SandboxRuntimeState.touchHeartbeat(taskId);
  const response = await sandbox.executeCommand(command, {
    cwd,
    envVars,
    timeoutSeconds: timeout,
  });

  if (response.output) {
    await appendTaskMessageLog(messageId, `${response.output}\n`);
  }

  if (response.exitCode !== 0) {
    throw new Error(read(response.output) || `Command failed with exit code ${response.exitCode}.`);
  }

  await assertTaskNotCancelled(taskId);
  await SandboxRuntimeState.touchHeartbeat(taskId);

  return response;
};

const detectArtifacts = async (taskId: string, messageId: string, payload: JsonObject) => {
  const url =
    (typeof payload.url === "string" && payload.url) ||
    (typeof payload.prUrl === "string" && payload.prUrl) ||
    (typeof payload.previewUrl === "string" && payload.previewUrl) ||
    (typeof payload.screenshotUrl === "string" && payload.screenshotUrl);

  if (!url) {
    return;
  }

  const type =
    (typeof payload.type === "string" && payload.type) ||
    (url.includes("/pull/")
      ? "pull_request"
      : url.match(/\.(png|jpg|jpeg|webp)$/i)
        ? "screenshot"
        : "link");

  await SandboxEvents.publishArtifact({
    messageId,
    metadata: payload,
    taskId,
    type,
    url,
  });
};

const normalizeEvent = (event: JsonObject) => {
  const rawType = typeof event.type === "string" ? event.type : "unknown";
  const part = typeof event.part === "object" && event.part ? (event.part as JsonObject) : null;

  if (rawType === "text" && typeof part?.text === "string") {
    return {
      payload: {
        text: part.text,
        timestamp: event.timestamp ?? Date.now(),
      },
      type: "text",
    } as const;
  }

  if (rawType.includes("tool")) {
    return {
      payload: {
        ...event,
      },
      type: rawType.includes("result") || rawType.includes("output") ? "tool_result" : "tool_call",
    } as const;
  }

  if (rawType.includes("error")) {
    return {
      payload: {
        ...event,
      },
      type: "error",
    } as const;
  }

  if (rawType.includes("complete") || rawType.includes("finish")) {
    return {
      payload: {
        ...event,
      },
      type: "execution_complete",
    } as const;
  }

  return {
    payload: {
      ...event,
    },
    type: "tool_result",
  } as const;
};

export const parseAgentOutput = async (taskId: string, messageId: string, output: string) => {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed) as JsonObject;
      const normalized = normalizeEvent(event);

      if (normalized.type === "text" && typeof normalized.payload.text === "string") {
        const timestamp = Number(normalized.payload.timestamp ?? Date.now());

        await appendTaskMessageAgentMessage(messageId, normalized.payload.text, timestamp);

        const message = await findTaskMessage(messageId);

        if (message?.kind === "initial" || message?.sequence === 0) {
          await appendTaskAgentMessage(taskId, normalized.payload.text, timestamp);
        }
      }

      await SandboxEvents.publish({
        messageId,
        payload: normalized.payload,
        taskId,
        type: normalized.type,
      });
      await detectArtifacts(taskId, messageId, normalized.payload);
    } catch {}
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

export const buildOpenCodeEnvironment = (input: {
  apiKey: string;
  apiKeyEnvVar: string;
  baseUrl: string | null;
  defaultBranch: string;
  githubToken: string;
  model: string;
  providerId: string;
  projectEnvVars?: Record<string, string>;
  repoFullName: string;
  sandboxPath: string;
  taskId: string;
  viewer: { email: string; name: string };
}) => ({
  [input.apiKeyEnvVar]: input.apiKey,
  OPENCODE_CONFIG_CONTENT_B64: Buffer.from(
    buildOpenCodeConfigContent({
      apiKey: input.apiKey,
      apiKeyEnvVar: input.apiKeyEnvVar,
      baseUrl: input.baseUrl,
      model: input.model,
      providerId: input.providerId,
    }),
    "utf8",
  ).toString("base64"),
  OPENCODE_GITHUB_DEFAULT_BRANCH: input.defaultBranch,
  OPENCODE_GITHUB_REPO_FULL_NAME: input.repoFullName,
  OPENCODE_GITHUB_TOKEN: input.githubToken,
  OPENCODE_GIT_AUTHOR_EMAIL: input.viewer.email,
  OPENCODE_GIT_AUTHOR_NAME: input.viewer.name,
  OPENCODE_REPO_PATH: input.sandboxPath,
  ...(input.projectEnvVars ?? {}),
  ...Sandbox.getSpawnTaskEnvironment(input.taskId),
});
