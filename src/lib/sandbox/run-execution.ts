import path from "node:path";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { type OpenCodeConfig } from "@/lib/opencode/config";
import { findTaskWithProject } from "@/lib/project/data";
import { parseStoredProjectSkills } from "@/lib/project/skills";
import { resolveTaskTitle } from "@/lib/project/title";
import { Sandbox } from "@/lib/sandbox";
import {
  buildOpenCodeRuntimeEnvironment,
  ensureOpenCodeServer,
  getOpenCodeRuntimeFingerprint,
  type OpenCodePromptResult,
  parseOpenCodeSessionMetadataResult,
  parseOpenCodePromptResult,
  readOpenCodeSessionMetadata,
  readOpenCodeUsageLog,
  runOpenCodePrompt,
} from "@/lib/sandbox/opencode-host";
import {
  findTaskMessage,
  findTaskRecord,
  listCompletedMessagesBeforeSequence,
  listTaskArtifactsByMessageId,
  updateTaskMessageRecord,
  updateTaskRecord,
} from "@/lib/sandbox/store";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";
import { buildSandboxGitExcludeCommand } from "@/lib/sandbox/workspace";
import {
  isTaskAttachmentMetadata,
  resolveTaskAttachmentPath,
  TASK_ATTACHMENT_ARTIFACT_TYPE,
} from "@/lib/task-attachments";
import { type UserLlmProviderRecord } from "@/lib/user/data";
import { resolveUserProvider } from "@/lib/user/provider-resolution";
import { parseProviderUsageLog, recordProviderUsageEvents } from "@/lib/user/provider-usage";

import {
  assertTaskNotCancelled,
  completeMessageExecution,
  getTaskProjectEnvVars,
  recordRuntimeAgentEvent,
  runSandboxCommand,
  syncGitHandoffState,
  unwrapResult,
  updateMessageStage,
} from "./run-support";

type Viewer = { email: string; login: string; name: string };
const log = Log.create({ ns: "sandbox.run_execution" });

const buildReplayMessageText = (input: {
  prompt: string;
  responseText?: string | null;
  sequence: number;
}) =>
  [
    "Recovered prior task exchange for follow-up continuity.",
    `Exchange sequence: ${input.sequence}`,
    "",
    "User task:",
    input.prompt.trim(),
    ...(input.responseText?.trim()
      ? ["", "Final assistant response:", input.responseText.trim()]
      : []),
  ].join("\n");

const buildReplayMessages = async (taskId: string, sequence: number) => {
  const completedMessages = await listCompletedMessagesBeforeSequence(taskId, sequence);

  return completedMessages.map((message) => ({
    messageId:
      message.opencodeUserMessageId?.trim() ||
      `replay_${message.sequence.toString().padStart(4, "0")}`,
    text: buildReplayMessageText({
      prompt: message.prompt,
      responseText: message.parsedResponseMessages.at(-1)?.text ?? null,
      sequence: message.sequence,
    }),
  }));
};

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
  const resolvedProvider = await resolveUserProvider({
    model: taskRecord.opencodeModel ?? null,
    providerRecordId: taskRecord.opencodeProviderId ?? null,
    userId: executionUserId,
  }).match(
    (value) => value,
    (error) => {
      throw error;
    },
  );

  const [repo, githubAccessToken, viewer, authenticatedRemoteUrl] = await Promise.all([
    unwrapResult(Github.getRepoForUser(taskRecord.repoId ?? "", executionUserId)),
    unwrapResult(Github.getAccessTokenForUser(executionUserId)),
    unwrapResult(Github.getViewerForUser(executionUserId)),
    unwrapResult(Github.getAuthenticatedRemoteUrlForUser(taskRecord.repoId ?? "", executionUserId)),
  ]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  return {
    authenticatedRemoteUrl,
    githubAccessToken,
    llmProvider: resolvedProvider.provider,
    messageRecord,
    openCodeConfig: resolvedProvider.openCodeConfig,
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
  messageRecord: NonNullable<Awaited<ReturnType<typeof findTaskMessage>>>;
  prepared: { sandbox: Sandbox.Session; sandboxPath: string };
  repo: Github.Repo;
  taskId: string;
  taskProjectEnvVars: Record<string, string>;
  taskRecord: Awaited<ReturnType<typeof findTaskRecord>>;
  viewer: Viewer;
  githubAccessToken: string;
  llmProvider: UserLlmProviderRecord;
  openCodeConfig: OpenCodeConfig;
  messagePrompt: string;
  requiresSessionRecovery?: boolean;
}) => {
  const op = log.child({ messageId: input.messageId, taskId: input.taskId });
  const runStartedAt = Date.now();
  const openCode = input.openCodeConfig;
  const model = openCode.model;
  const runtimeFingerprint = getOpenCodeRuntimeFingerprint(openCode);
  // Rehydrate follow-ups from recorded history instead of reusing a live OpenCode
  // session. The persisted-session path can hang without producing runtime events.
  const shouldPreferReplayRecovery = input.messageRecord.sequence > 0;
  const shouldRecoverSession =
    shouldPreferReplayRecovery ||
    Boolean(input.requiresSessionRecovery) ||
    (!!input.taskRecord?.opencodeSessionId &&
      !!input.taskRecord?.opencodeRuntimeFingerprint &&
      input.taskRecord.opencodeRuntimeFingerprint !== runtimeFingerprint);
  const replayMessages =
    input.messageRecord.sequence > 0 && shouldRecoverSession
      ? await buildReplayMessages(input.taskId, input.messageRecord.sequence)
      : [];
  const attachments = await prepareMessageAttachments({
    messageId: input.messageId,
    prepared: input.prepared,
  });
  const buildRuntimeEnvironment = (
    sessionId?: string | null,
    replayMessagesForRun = replayMessages,
  ) =>
    buildOpenCodeRuntimeEnvironment({
      apiKey: openCode.runtimeApiKey ?? openCode.apiKey,
      apiKeyEnvVar: openCode.apiKeyEnvVar,
      attachments,
      defaultBranch: input.repo.defaultBranch,
      githubToken: input.githubAccessToken,
      messageId: input.messageId,
      model,
      projectEnvVars: input.taskProjectEnvVars,
      providerId: openCode.providerId,
      providerKind: openCode.providerKind,
      providerName: openCode.providerName,
      reasoningEffort: input.messageRecord.reasoningEffort ?? null,
      repoFullName: input.repo.fullName,
      runtimeBaseUrl: openCode.runtimeBaseUrl ?? openCode.baseUrl,
      sandboxId: input.prepared.sandbox.id,
      sandboxPath: input.prepared.sandboxPath,
      replayMessages: replayMessagesForRun,
      sessionId,
      taskId: input.taskId,
      upstreamBaseUrl: openCode.baseUrl,
      userPrompt: input.messagePrompt,
      viewer: input.viewer,
    });
  const persistedSessionId =
    shouldRecoverSession || input.taskRecord?.opencodeRuntimeFingerprint !== runtimeFingerprint
      ? null
      : (input.taskRecord?.opencodeSessionId ?? null);
  const openCodeEnvironment = buildRuntimeEnvironment(persistedSessionId);
  await updateMessageStage(input.taskId, input.messageId, "Starting agent");
  await runSandboxCommand(
    input.prepared.sandbox,
    input.taskId,
    input.messageId,
    buildSandboxGitExcludeCommand(),
    input.prepared.sandboxPath,
    undefined,
    60,
    "refresh git exclude",
  );
  await ensureOpenCodeServer({
    environment: openCodeEnvironment,
    messageId: input.messageId,
    run: runSandboxCommand,
    sandbox: input.prepared.sandbox,
    sandboxPath: input.prepared.sandboxPath,
    taskId: input.taskId,
  });
  op.info("starting OpenCode run", {
    attachmentCount: attachments.length,
    model,
    sandboxId: input.prepared.sandbox.id,
  });
  const openCodeStartedAt = Date.now();
  let response: Awaited<ReturnType<typeof runOpenCodePrompt>>;
  let runtimeResult: OpenCodePromptResult | null = null;

  try {
    await updateMessageStage(input.taskId, input.messageId, "Agent is working");
    response = await runOpenCodePrompt({
      environment: openCodeEnvironment,
      messageId: input.messageId,
      run: runSandboxCommand,
      sandbox: input.prepared.sandbox,
      sandboxPath: input.prepared.sandboxPath,
      taskId: input.taskId,
    });
    runtimeResult = parseOpenCodePromptResult(response.output);
  } catch (error) {
    if (
      input.messageRecord.sequence > 0 &&
      !shouldRecoverSession &&
      input.taskRecord?.opencodeSessionId
    ) {
      op.warn("opencode session unavailable; retrying with recovered context", {
        error,
        sessionId: input.taskRecord.opencodeSessionId,
      });
      const recoveredReplayMessages = await buildReplayMessages(
        input.taskId,
        input.messageRecord.sequence,
      );
      const recoveredEnvironment = buildRuntimeEnvironment(null, recoveredReplayMessages);

      response = await runOpenCodePrompt({
        environment: recoveredEnvironment,
        messageId: input.messageId,
        run: runSandboxCommand,
        sandbox: input.prepared.sandbox,
        sandboxPath: input.prepared.sandboxPath,
        taskId: input.taskId,
      });
      runtimeResult = parseOpenCodePromptResult(response.output);
      await updateTaskMessageRecord(input.messageId, {
        replayStrategy: "replayed_history",
        replayedAt: new Date(),
      });
    } else {
      throw error;
    }
  }
  op.info("OpenCode run completed", {
    durationMs: Date.now() - openCodeStartedAt,
    outputChars: response.output.length,
  });
  if (!runtimeResult) {
    throw new Error("OpenCode prompt completed without a parseable runtime result.");
  }

  await updateMessageStage(input.taskId, input.messageId, "Reviewing agent results");

  await updateTaskRecord(input.taskId, {
    opencodeRuntimeFingerprint: runtimeFingerprint,
    opencodeSessionId: runtimeResult.sessionId?.trim() || null,
  });

  const sessionMetadataEnvironment = buildRuntimeEnvironment(runtimeResult.sessionId ?? null, []);
  const sessionMetadata = parseOpenCodeSessionMetadataResult(
    (
      await readOpenCodeSessionMetadata({
        environment: sessionMetadataEnvironment,
        messageId: input.messageId,
        run: runSandboxCommand,
        sandbox: input.prepared.sandbox,
        sandboxPath: input.prepared.sandboxPath,
        taskId: input.taskId,
      })
    ).output,
  );
  const resolvedTitle = resolveTaskTitle(input.taskRecord.prompt, sessionMetadata?.title ?? null);

  await updateTaskRecord(input.taskId, {
    title: resolvedTitle,
  });

  await updateTaskMessageRecord(input.messageId, {
    opencodeAssistantMessageId: runtimeResult.assistantMessageId?.trim() || null,
    opencodeUserMessageId: runtimeResult.userMessageId?.trim() || null,
    replayStrategy: replayMessages.length > 0 ? "replayed_history" : null,
    replayedAt: replayMessages.length > 0 ? new Date() : null,
  });

  if (runtimeResult?.text?.trim()) {
    await recordRuntimeAgentEvent({
      messageId: input.messageId,
      payload: {
        text: runtimeResult.text.trim(),
        timestamp: Date.now(),
      },
      taskId: input.taskId,
      type: "token",
    });
  }

  const usageLog = await readOpenCodeUsageLog({
    messageId: input.messageId,
    run: runSandboxCommand,
    sandbox: input.prepared.sandbox,
    sandboxPath: input.prepared.sandboxPath,
    taskId: input.taskId,
  });
  const usageEvents = parseProviderUsageLog(usageLog.output);

  await recordProviderUsageEvents({
    messageId: input.messageId,
    model,
    provider: {
      id: input.llmProvider.id,
      name: input.llmProvider.name,
      orgId: input.llmProvider.orgId,
      providerKind: input.llmProvider.providerKind,
      userId: input.llmProvider.userId,
    },
    taskId: input.taskId,
    usageEvents,
  });
  await assertTaskNotCancelled(input.taskId);

  await updateMessageStage(input.taskId, input.messageId, "Preparing task handoff");

  const changes = await runSandboxCommand(
    input.prepared.sandbox,
    input.taskId,
    input.messageId,
    "git status --porcelain",
    input.prepared.sandboxPath,
    undefined,
    60,
    "inspect git status",
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

  op.info("message execution finalized", {
    durationMs: Date.now() - runStartedAt,
    hasWorkspaceChanges: Boolean(changes.output.trim()),
    prNumber: handoffState.prNumber,
    usageEventCount: usageEvents.length,
  });
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

  await runOpenCodeMessage({
    defaultCompletionStage: "Task completed",
    githubAccessToken: context.githubAccessToken,
    messageId,
    messageRecord: context.messageRecord,
    llmProvider: context.llmProvider,
    messagePrompt: context.messageRecord.prompt,
    openCodeConfig: context.openCodeConfig,
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

  await runOpenCodeMessage({
    defaultCompletionStage: "Follow-up completed",
    githubAccessToken: context.githubAccessToken,
    messageId,
    messageRecord: context.messageRecord,
    llmProvider: context.llmProvider,
    messagePrompt: context.messageRecord.prompt,
    openCodeConfig: context.openCodeConfig,
    prepared,
    repo: context.repo,
    requiresSessionRecovery:
      !prepared.reused ||
      !context.taskRecord.opencodeSessionId ||
      !context.taskRecord.opencodeRuntimeFingerprint,
    taskId,
    taskProjectEnvVars: context.taskProjectEnvVars,
    taskRecord: context.taskRecord,
    viewer: context.viewer,
  });
};
