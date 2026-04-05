import path from "node:path";

import { Github } from "@/lib/github";
import { normalizeOpenCodeModelForProvider, resolveOpenCodeConfig } from "@/lib/opencode/config";
import { findTaskWithProject } from "@/lib/project/data";
import { parseStoredProjectSkills } from "@/lib/project/skills";
import { Sandbox } from "@/lib/sandbox";
import { buildOpenCodePrompt, buildOpenCodeRunCommand } from "@/lib/sandbox/opencode";
import {
  findTaskMessage,
  findTaskRecord,
  getTaskConversation,
  listTaskArtifactsByMessageId,
  updateTaskRecord,
} from "@/lib/sandbox/store";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";
import {
  isTaskAttachmentMetadata,
  resolveTaskAttachmentPath,
  TASK_ATTACHMENT_ARTIFACT_TYPE,
} from "@/lib/task-attachments";
import { findUserLlmProvider, listUserLlmProviders } from "@/lib/user/data";

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

const prepareMessageAttachments = async (input: {
  messageId: string;
  prepared: { sandbox: Sandbox.Session; sandboxPath: string };
}) => {
  const artifacts = await listTaskArtifactsByMessageId(input.messageId);
  const attachmentArtifacts = artifacts.flatMap((artifact) => {
    if (
      artifact.type !== TASK_ATTACHMENT_ARTIFACT_TYPE ||
      !isTaskAttachmentMetadata(artifact.parsedMetadata)
    ) {
      return [];
    }

    return [
      {
        artifact,
        metadata: artifact.parsedMetadata,
      },
    ];
  });

  if (attachmentArtifacts.length === 0) {
    return [];
  }

  const attachments: Array<{ fileName: string; mediaType: string; sandboxPath: string }> = [];

  for (const attachmentArtifact of attachmentArtifacts) {
    const { metadata } = attachmentArtifact;
    const sandboxPath = path.posix.join(
      input.prepared.sandboxPath,
      ".diabolo",
      "attachments",
      input.messageId,
      metadata.fileName,
    );

    await input.prepared.sandbox.uploadFile(
      resolveTaskAttachmentPath(metadata.storageKey),
      sandboxPath,
      180,
    );

    attachments.push({
      fileName: metadata.originalName,
      mediaType: metadata.mediaType,
      sandboxPath,
    });
  }

  return attachments;
};

const loadTaskExecutionContext = async (taskId: string, messageId: string) => {
  const [taskRecord, messageRecord, taskWithProject] = await Promise.all([
    findTaskRecord(taskId),
    findTaskMessage(messageId),
    findTaskWithProject(taskId),
  ]);

  if (!taskRecord || !messageRecord || !taskWithProject) {
    return null;
  }

  const executionUserId = taskRecord.createdByUserId ?? taskWithProject.project.userId;

  const [repo, githubAccessToken, viewer, authenticatedRemoteUrl, llmProvider, userLlmProviders] =
    await Promise.all([
      unwrapResult(Github.getRepoForUser(taskRecord.repoId ?? "", executionUserId)),
      unwrapResult(Github.getAccessTokenForUser(executionUserId)),
      unwrapResult(Github.getViewerForUser(executionUserId)),
      unwrapResult(
        Github.getAuthenticatedRemoteUrlForUser(taskRecord.repoId ?? "", executionUserId),
      ),
      taskRecord.opencodeProviderId
        ? findUserLlmProvider(executionUserId, taskRecord.opencodeProviderId)
        : Promise.resolve(null),
      listUserLlmProviders(executionUserId),
    ]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  if (taskRecord.opencodeProviderId && !llmProvider) {
    throw new Error("The provider selected for this task no longer exists.");
  }

  const matchedProvider =
    llmProvider ??
    (taskRecord.opencodeModel?.trim()
      ? (userLlmProviders.find(
          (provider) =>
            normalizeOpenCodeModelForProvider(provider.providerModel, provider.providerId) ===
            taskRecord.opencodeModel,
        ) ?? null)
      : null);

  if (!matchedProvider) {
    throw new Error("No saved provider is available for this task.");
  }

  return {
    authenticatedRemoteUrl,
    githubAccessToken,
    llmProvider: matchedProvider,
    messageRecord,
    repo,
    taskProjectSkills: parseStoredProjectSkills(taskWithProject.project.agentSkills),
    taskProjectEnvVars: getTaskProjectEnvVars(taskRecord.envVars),
    taskRecord,
    viewer,
  };
};

const runOpenCodeMessage = async (input: {
  defaultCompletionStage: string;
  messageId: string;
  messagePromptOptions?: Parameters<typeof buildOpenCodePrompt>[1];
  prepared: { sandbox: Sandbox.Session; sandboxPath: string };
  repo: Github.Repo;
  taskId: string;
  taskProjectEnvVars: Record<string, string>;
  taskRecord: Awaited<ReturnType<typeof findTaskRecord>>;
  viewer: Viewer;
  githubAccessToken: string;
  llmProvider: NonNullable<Awaited<ReturnType<typeof findUserLlmProvider>>>;
  messagePrompt: string;
}) => {
  const openCode = resolveOpenCodeConfig({
    model: input.taskRecord?.opencodeModel?.trim() || null,
    provider: input.llmProvider,
  });
  const model = openCode.model;
  const attachments = await prepareMessageAttachments({
    messageId: input.messageId,
    prepared: input.prepared,
  });
  const prompt = buildOpenCodePrompt(input.messagePrompt, {
    attachments,
    ...input.messagePromptOptions,
    envVarKeys: Object.keys(input.taskProjectEnvVars),
    sandboxId: input.prepared.sandbox.id,
  });
  const response = await runSandboxCommand(
    input.prepared.sandbox,
    input.taskId,
    input.messageId,
    buildOpenCodeRunCommand(model, prompt, attachments),
    input.prepared.sandboxPath,
    buildOpenCodeEnvironment({
      apiKey: openCode.apiKey,
      apiKeyEnvVar: openCode.apiKeyEnvVar,
      baseUrl: openCode.baseUrl,
      defaultBranch: input.repo.defaultBranch,
      githubToken: input.githubAccessToken,
      model,
      providerId: openCode.providerId,
      providerName: openCode.providerName,
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
    skills: context.taskProjectSkills,
    taskId,
    viewer: context.viewer,
  });

  await updateMessageStage(taskId, messageId, "Running task");

  await runOpenCodeMessage({
    defaultCompletionStage: "Task completed",
    githubAccessToken: context.githubAccessToken,
    messageId,
    llmProvider: context.llmProvider,
    messagePrompt: context.messageRecord.prompt,
    prepared,
    repo: context.repo,
    taskId,
    taskProjectEnvVars: context.taskProjectEnvVars,
    taskRecord: context.taskRecord,
    viewer: context.viewer,
  });
};

export const runFollowUpMessage = async (taskId: string, messageId: string) => {
  const context = await loadTaskExecutionContext(taskId, messageId);

  if (!context) {
    return;
  }

  const previousConversation: NonNullable<
    Parameters<typeof buildOpenCodePrompt>[1]
  >["conversationHistory"] = (await getTaskConversation(taskId))
    .filter((message) => message.sequence < context.messageRecord.sequence)
    .map((message) => ({
      error: message.error,
      kind: message.kind === "initial" ? "initial" : "follow_up",
      prompt: message.prompt,
      responseMessages: message.parsedResponseMessages,
      sequence: message.sequence,
      status: message.status,
    }));

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
    skills: context.taskProjectSkills,
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
    llmProvider: context.llmProvider,
    messagePrompt: context.messageRecord.prompt,
    messagePromptOptions: {
      conversationHistory: previousConversation,
    },
    prepared,
    repo: context.repo,
    taskId,
    taskProjectEnvVars: context.taskProjectEnvVars,
    taskRecord: context.taskRecord,
    viewer: context.viewer,
  });
};
