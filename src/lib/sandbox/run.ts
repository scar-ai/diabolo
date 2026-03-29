import "@tanstack/react-start/server-only";
import { Buffer } from "node:buffer";

import { type ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import type { JsonObject } from "@/lib/json";
import { Log } from "@/lib/log";
import { buildOpenCodeConfigContent, ensureOpenCodeConfig } from "@/lib/opencode/config";
import { Sandbox } from "@/lib/sandbox";
import { SandboxEvents } from "@/lib/sandbox/events";
import { buildOpenCodePrompt, buildOpenCodeRunCommand } from "@/lib/sandbox/opencode";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
import {
  appendTaskAgentMessage,
  appendTaskMessageAgentMessage,
  appendTaskMessageLog,
  findTaskMessage,
  findTaskRecord,
  type TaskRecord,
  isTaskCancellationRequested,
  updateTaskMessageRecord,
  updateTaskRecord,
} from "@/lib/sandbox/store";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";

const log = Log.create({ ns: "sandbox.run" });

const read = (value: string) => value.trim();

const unwrapResult = async <T>(result: ResultAsync<T, Error>): Promise<T> => {
  const res = await result;

  if (res.isErr()) {
    throw res.error;
  }

  return res.value;
};

const getTaskProjectEnvVars = (value: string | null | undefined): Record<string, string> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {}
  return {};
};

const updateStage = async (
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

const failMessage = async (
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

const completeMessage = async (
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

const assertTaskNotCancelled = async (taskId: string) => {
  const cancelRequestedAt = await isTaskCancellationRequested(taskId);

  if (cancelRequestedAt) {
    throw new Error("Task was terminated by user.");
  }
};

const run = async (
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

const parse = async (taskId: string, messageId: string, output: string) => {
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

const syncGitHandoffState = async (input: {
  messageId: string;
  repoDefaultBranch: string;
  repoId: string | null;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) => {
  const branch = await run(
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

const buildOpenCodeEnvironment = (input: {
  apiKey: string;
  defaultBranch: string;
  githubToken: string;
  model: string;
  projectEnvVars?: Record<string, string>;
  repoFullName: string;
  sandboxPath: string;
  taskId: string;
  viewer: { email: string; name: string };
}) => ({
  OPENROUTER_API_KEY: input.apiKey,
  OPENCODE_CONFIG_CONTENT_B64: Buffer.from(
    buildOpenCodeConfigContent(input.model),
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

const runInitialMessage = async (taskId: string, messageId: string) => {
  const [taskRecord, messageRecord] = await Promise.all([
    findTaskRecord(taskId),
    findTaskMessage(messageId),
  ]);

  if (!taskRecord || !messageRecord) {
    return;
  }

  const [repo, githubAccessToken, viewer, authenticatedRemoteUrl] = await Promise.all([
    unwrapResult<Github.Repo | null>(Github.getRepo(taskRecord.repoId ?? "")),
    unwrapResult<string>(Github.getAccessToken()),
    unwrapResult<{ email: string; login: string; name: string }>(Github.getViewer()),
    unwrapResult<string>(Github.getAuthenticatedRemoteUrl(taskRecord.repoId ?? "")),
  ]);
  const openCode = ensureOpenCodeConfig();
  const model = taskRecord.opencodeModel?.trim() || openCode.model;

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  await updateTaskRecord(taskId, {
    repoName: repo.fullName,
    repoUrl: repo.htmlUrl,
    sandboxStatus: "pending",
    status: "running",
  });

  const taskProjectEnvVars = getTaskProjectEnvVars(taskRecord.envVars);
  const prepared = await SandboxWorkspace.prepare({
    authenticatedRemoteUrl,
    branch: taskRecord.branchName?.trim() || repo.defaultBranch,
    envVars: taskProjectEnvVars,
    githubAccessToken,
    messageId,
    provider: Sandbox.getProvider(),
    repoName: repo.name,
    repoOwnerLogin: repo.ownerLogin,
    repoUrl: repo.cloneUrl,
    run,
    taskId,
    viewer,
  });

  await updateStage(taskId, messageId, "Running task");

  const prompt = buildOpenCodePrompt(messageRecord.prompt, {
    envVarKeys: taskProjectEnvVars ? Object.keys(taskProjectEnvVars) : undefined,
    sandboxId: prepared.sandbox.id,
  });
  const response = await run(
    prepared.sandbox,
    taskId,
    messageId,
    buildOpenCodeRunCommand(model, prompt),
    prepared.sandboxPath,
    buildOpenCodeEnvironment({
      apiKey: openCode.apiKey,
      defaultBranch: repo.defaultBranch,
      githubToken: githubAccessToken,
      model,
      projectEnvVars: taskProjectEnvVars,
      repoFullName: repo.fullName,
      sandboxPath: prepared.sandboxPath,
      taskId,
      viewer,
    }),
    3600,
  );

  await parse(taskId, messageId, response.output);
  await assertTaskNotCancelled(taskId);

  if (taskRecord.quickTask) {
    await completeMessage(taskId, messageId, "Task completed");

    try {
      await SandboxWorkspace.destroy(Sandbox.getProvider(), taskId, {
        stage: "Quick task completed; sandbox destroyed",
      });
    } catch (error) {
      await appendTaskMessageLog(
        messageId,
        `Failed to destroy quick task sandbox: ${Sandbox.getProvider().formatError(error)}\n`,
      );
    }

    return;
  }

  const changes = await run(
    prepared.sandbox,
    taskId,
    messageId,
    "git status --porcelain",
    prepared.sandboxPath,
    undefined,
    60,
  );
  const handoffState = await syncGitHandoffState({
    messageId,
    repoDefaultBranch: repo.defaultBranch,
    repoId: taskRecord.repoId ?? null,
    sandbox: prepared.sandbox,
    sandboxPath: prepared.sandboxPath,
    taskId,
  });

  await completeMessage(
    taskId,
    messageId,
    read(changes.output)
      ? handoffState.prUrl
        ? "Task completed with pushed changes and PR"
        : "Task completed with workspace changes and no PR"
      : "Task completed",
    {
      branchName: handoffState.branchName,
      prNumber: handoffState.prNumber,
      prUrl: handoffState.prUrl,
      sandboxStatus: "ready",
    },
  );
};

const runFollowUpMessage = async (taskId: string, messageId: string) => {
  const [taskRecord, messageRecord] = await Promise.all([
    findTaskRecord(taskId),
    findTaskMessage(messageId),
  ]);

  if (!taskRecord || !messageRecord) {
    return;
  }

  const [viewer, githubAccessToken, repo, authenticatedRemoteUrl] = await Promise.all([
    unwrapResult<{ email: string; login: string; name: string }>(Github.getViewer()),
    unwrapResult<string>(Github.getAccessToken()),
    unwrapResult<Github.Repo | null>(Github.getRepo(taskRecord.repoId ?? "")),
    unwrapResult<string>(Github.getAuthenticatedRemoteUrl(taskRecord.repoId ?? "")),
  ]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  const model = taskRecord.opencodeModel?.trim() || ensureOpenCodeConfig().model;

  const prepared = await SandboxWorkspace.getOrCreateFollowUp({
    authenticatedRemoteUrl,
    envVars: getTaskProjectEnvVars(taskRecord.envVars),
    githubAccessToken,
    messageId,
    provider: Sandbox.getProvider(),
    repo,
    run,
    taskId,
    taskRecord,
    viewer,
  });

  if (!prepared.sandboxPath) {
    throw new Error("No sandbox workspace available for follow-up.");
  }

  await updateStage(taskId, messageId, "Running OpenCode task");

  const openCode = ensureOpenCodeConfig();
  const taskProjectEnvVars = getTaskProjectEnvVars(taskRecord.envVars);
  const prompt = buildOpenCodePrompt(messageRecord.prompt, {
    envVarKeys: taskProjectEnvVars ? Object.keys(taskProjectEnvVars) : undefined,
    sandboxId: prepared.sandbox.id,
  });
  const response = await run(
    prepared.sandbox,
    taskId,
    messageId,
    buildOpenCodeRunCommand(model, prompt),
    prepared.sandboxPath,
    buildOpenCodeEnvironment({
      apiKey: openCode.apiKey,
      defaultBranch: repo.defaultBranch,
      githubToken: githubAccessToken,
      model,
      projectEnvVars: taskProjectEnvVars,
      repoFullName: repo.fullName,
      sandboxPath: prepared.sandboxPath,
      taskId,
      viewer,
    }),
    3600,
  );

  await parse(taskId, messageId, response.output);
  await assertTaskNotCancelled(taskId);

  if (taskRecord.quickTask) {
    await completeMessage(taskId, messageId, "Follow-up completed");
    return;
  }

  const changes = await run(
    prepared.sandbox,
    taskId,
    messageId,
    "git status --porcelain",
    prepared.sandboxPath,
    undefined,
    60,
  );
  const handoffState = await syncGitHandoffState({
    messageId,
    repoDefaultBranch: repo.defaultBranch,
    repoId: taskRecord.repoId ?? null,
    sandbox: prepared.sandbox,
    sandboxPath: prepared.sandboxPath,
    taskId,
  });

  await completeMessage(
    taskId,
    messageId,
    read(changes.output)
      ? handoffState.prUrl
        ? "Follow-up completed with pushed changes and PR"
        : "Follow-up completed with workspace changes and no PR"
      : "Follow-up completed",
    {
      branchName: handoffState.branchName,
      prNumber: handoffState.prNumber,
      prUrl: handoffState.prUrl,
      sandboxStatus: "ready",
    },
  );
};

export namespace SandboxRun {
  export const processMessage = async (
    taskId: string,
    messageId: string,
    provider: Sandbox.Provider,
  ) => {
    const op = log.child({ messageId, taskId });
    const message = await findTaskMessage(messageId);

    if (!message) {
      return;
    }

    try {
      await SandboxRuntimeState.setSandboxStatus(taskId, "running");
      if (message.kind === "initial" || message.sequence === 0) {
        await runInitialMessage(taskId, messageId);
      } else {
        await runFollowUpMessage(taskId, messageId);
      }

      op.info("message completed");
    } catch (error) {
      const formattedError = provider.formatError(error);
      await failMessage(
        taskId,
        messageId,
        formattedError,
        message.sequence === 0 ? "Task failed" : "Follow-up failed",
      );
      op.error("message failed", { error });
    } finally {
      if (
        (await isTaskCancellationRequested(taskId)) &&
        (await findTaskMessage(messageId))?.status === "completed"
      ) {
        await failMessage(taskId, messageId, "Task was terminated by user.", "Terminated");
      }
    }
  };
}
