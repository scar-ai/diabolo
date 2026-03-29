import { Github } from "@/lib/github";
import { ensureOpenCodeConfig } from "@/lib/opencode/config";
import { Sandbox } from "@/lib/sandbox";
import { buildOpenCodePrompt, buildOpenCodeRunCommand } from "@/lib/sandbox/opencode";
import {
  appendTaskMessageLog,
  findTaskMessage,
  findTaskRecord,
  updateTaskRecord,
} from "@/lib/sandbox/store";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";

import {
  assertTaskNotCancelled,
  buildOpenCodeEnvironment,
  completeMessageExecution,
  getTaskProjectEnvVars,
  parseAgentOutput,
  runSandboxCommand,
  syncGitHandoffState,
  unwrapResult,
  updateMessageStage,
} from "./run-support";

type Viewer = { email: string; login: string; name: string };

const loadTaskExecutionContext = async (taskId: string, messageId: string) => {
  const [taskRecord, messageRecord] = await Promise.all([
    findTaskRecord(taskId),
    findTaskMessage(messageId),
  ]);

  if (!taskRecord || !messageRecord) {
    return null;
  }

  const [repo, githubAccessToken, viewer, authenticatedRemoteUrl] = await Promise.all([
    unwrapResult(Github.getRepo(taskRecord.repoId ?? "")),
    unwrapResult(Github.getAccessToken()),
    unwrapResult(Github.getViewer()),
    unwrapResult(Github.getAuthenticatedRemoteUrl(taskRecord.repoId ?? "")),
  ]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  return {
    authenticatedRemoteUrl,
    githubAccessToken,
    messageRecord,
    repo,
    taskProjectEnvVars: getTaskProjectEnvVars(taskRecord.envVars),
    taskRecord,
    viewer,
  };
};

const runOpenCodeMessage = async (input: {
  defaultCompletionStage: string;
  messageId: string;
  prepared: { sandbox: Sandbox.Session; sandboxPath: string };
  repo: Github.Repo;
  taskId: string;
  taskProjectEnvVars: Record<string, string>;
  taskRecord: Awaited<ReturnType<typeof findTaskRecord>>;
  viewer: Viewer;
  githubAccessToken: string;
  messagePrompt: string;
}) => {
  const openCode = ensureOpenCodeConfig();
  const model = input.taskRecord?.opencodeModel?.trim() || openCode.model;
  const prompt = buildOpenCodePrompt(input.messagePrompt, {
    envVarKeys: Object.keys(input.taskProjectEnvVars),
    sandboxId: input.prepared.sandbox.id,
  });
  const response = await runSandboxCommand(
    input.prepared.sandbox,
    input.taskId,
    input.messageId,
    buildOpenCodeRunCommand(model, prompt),
    input.prepared.sandboxPath,
    buildOpenCodeEnvironment({
      apiKey: openCode.apiKey,
      defaultBranch: input.repo.defaultBranch,
      githubToken: input.githubAccessToken,
      model,
      projectEnvVars: input.taskProjectEnvVars,
      repoFullName: input.repo.fullName,
      sandboxPath: input.prepared.sandboxPath,
      taskId: input.taskId,
      viewer: input.viewer,
    }),
    3600,
  );

  await parseAgentOutput(input.taskId, input.messageId, response.output);
  await assertTaskNotCancelled(input.taskId);

  if (input.taskRecord?.quickTask) {
    await completeMessageExecution(input.taskId, input.messageId, input.defaultCompletionStage);
    return;
  }

  const changes = await runSandboxCommand(
    input.prepared.sandbox,
    input.taskId,
    input.messageId,
    "git status --porcelain",
    input.prepared.sandboxPath,
    undefined,
    60,
  );
  const handoffState = await syncGitHandoffState({
    messageId: input.messageId,
    repoDefaultBranch: input.repo.defaultBranch,
    repoId: input.taskRecord?.repoId ?? null,
    sandbox: input.prepared.sandbox,
    sandboxPath: input.prepared.sandboxPath,
    taskId: input.taskId,
  });

  await completeMessageExecution(
    input.taskId,
    input.messageId,
    changes.output.trim()
      ? handoffState.prUrl
        ? `${input.defaultCompletionStage} with pushed changes and PR`
        : `${input.defaultCompletionStage} with workspace changes and no PR`
      : input.defaultCompletionStage,
    {
      branchName: handoffState.branchName,
      prNumber: handoffState.prNumber,
      prUrl: handoffState.prUrl,
      sandboxStatus: "ready",
    },
  );
};

export const runInitialMessage = async (taskId: string, messageId: string) => {
  const context = await loadTaskExecutionContext(taskId, messageId);

  if (!context) {
    return;
  }

  await updateTaskRecord(taskId, {
    repoName: context.repo.fullName,
    repoUrl: context.repo.htmlUrl,
    sandboxStatus: "pending",
    status: "running",
  });

  const prepared = await SandboxWorkspace.prepare({
    authenticatedRemoteUrl: context.authenticatedRemoteUrl,
    branch: context.taskRecord.branchName?.trim() || context.repo.defaultBranch,
    envVars: context.taskProjectEnvVars,
    githubAccessToken: context.githubAccessToken,
    messageId,
    provider: Sandbox.getProvider(),
    repoName: context.repo.name,
    repoOwnerLogin: context.repo.ownerLogin,
    repoUrl: context.repo.cloneUrl,
    run: runSandboxCommand,
    taskId,
    viewer: context.viewer,
  });

  await updateMessageStage(taskId, messageId, "Running task");

  await runOpenCodeMessage({
    defaultCompletionStage: "Task completed",
    githubAccessToken: context.githubAccessToken,
    messageId,
    messagePrompt: context.messageRecord.prompt,
    prepared,
    repo: context.repo,
    taskId,
    taskProjectEnvVars: context.taskProjectEnvVars,
    taskRecord: context.taskRecord,
    viewer: context.viewer,
  });

  if (context.taskRecord.quickTask) {
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
  }
};

export const runFollowUpMessage = async (taskId: string, messageId: string) => {
  const context = await loadTaskExecutionContext(taskId, messageId);

  if (!context) {
    return;
  }

  const prepared = await SandboxWorkspace.getOrCreateFollowUp({
    authenticatedRemoteUrl: context.authenticatedRemoteUrl,
    envVars: context.taskProjectEnvVars,
    githubAccessToken: context.githubAccessToken,
    messageId,
    provider: Sandbox.getProvider(),
    repo: context.repo,
    run: runSandboxCommand,
    taskId,
    taskRecord: context.taskRecord,
    viewer: context.viewer,
  });

  if (!prepared.sandboxPath) {
    throw new Error("No sandbox workspace available for follow-up.");
  }

  await updateMessageStage(taskId, messageId, "Running OpenCode task");

  await runOpenCodeMessage({
    defaultCompletionStage: "Follow-up completed",
    githubAccessToken: context.githubAccessToken,
    messageId,
    messagePrompt: context.messageRecord.prompt,
    prepared,
    repo: context.repo,
    taskId,
    taskProjectEnvVars: context.taskProjectEnvVars,
    taskRecord: context.taskRecord,
    viewer: context.viewer,
  });
};
