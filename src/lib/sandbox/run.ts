import "@tanstack/react-start/server-only";
import { type ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { buildOpenCodeConfigContent, ensureOpenCodeConfig } from "@/lib/opencode/config";
import { didGitMetadataGenerationTimeout, generateGitMetadata } from "@/lib/opencode/git-metadata";
import { Sandbox } from "@/lib/sandbox";
import { buildOpenCodePrompt, buildOpenCodeRunCommand } from "@/lib/sandbox/opencode";
import {
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
const escape = (value: string) => value.replace(/'/g, `'\\''`);

const unwrapResult = async <T>(result: ResultAsync<T, Error>): Promise<T> => {
  const res = await result;

  if (res.isErr()) {
    throw res.error;
  }

  return res.value;
};

const updateStage = async (
  taskId: string,
  messageId: string,
  stage: string,
  taskStatus: "queued" | "running" | "succeeded" | "failed" = "running",
) => {
  await Promise.all([
    updateTaskRecord(taskId, {
      completedAt: null,
      error: null,
      stage,
      status: taskStatus,
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

  return response;
};

const parse = async (messageId: string, output: string) => {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed);

      if (event.type !== "text" || !event.part?.text) {
        continue;
      }

      await appendTaskMessageAgentMessage(
        messageId,
        event.part.text,
        event.timestamp ?? Date.now(),
      );
    } catch {}
  }
};

const buildFollowUpCommitMessage = (prompt: string) => {
  const preview = prompt.split("\n")[0]?.replace(/\s+/g, " ").trim().slice(0, 60);

  return preview ? `Follow-up: ${preview}` : "Follow-up changes";
};

const pushFollowUpChanges = async (input: {
  branchName: string;
  messageId: string;
  prompt: string;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) => {
  const changes = await run(
    input.sandbox,
    input.taskId,
    input.messageId,
    "git status --porcelain",
    input.sandboxPath,
    undefined,
    60,
  );

  if (!read(changes.output)) {
    return;
  }

  const commitMessage = buildFollowUpCommitMessage(input.prompt);

  await run(
    input.sandbox,
    input.taskId,
    input.messageId,
    [
      "git add -A",
      "if ! git diff --cached --quiet; then",
      `  git -c core.hooksPath=/dev/null commit --no-verify -m '${escape(commitMessage)}'`,
      `  GIT_TERMINAL_PROMPT=0 git push --porcelain origin '${escape(input.branchName)}'`,
      "fi",
    ].join("\n"),
    input.sandboxPath,
    undefined,
    900,
  );
};

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

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  await updateTaskRecord(taskId, {
    repoName: repo.fullName,
    repoUrl: repo.htmlUrl,
    status: "running",
  });

  const enableStagehandTools = Sandbox.isFrontendTaskPrompt(messageRecord.prompt);

  const prepared = await SandboxWorkspace.prepare({
    authenticatedRemoteUrl,
    branch: taskRecord.branchName?.trim() || repo.defaultBranch,
    enableStagehandTools,
    githubAccessToken,
    messageId,
    provider: Sandbox.getProvider(),
    repoName: repo.name,
    repoOwnerLogin: repo.ownerLogin,
    repoUrl: repo.cloneUrl,
    run,
    setupTools: enableStagehandTools ? Sandbox.getSetupToolsCommand() : undefined,
    taskId,
    viewer,
  });

  await updateStage(taskId, messageId, "Running OpenCode task");

  const prompt = buildOpenCodePrompt(messageRecord.prompt, {
    enableStagehandTools,
    sandboxId: prepared.sandbox.id,
  });
  const response = await run(
    prepared.sandbox,
    taskId,
    messageId,
    buildOpenCodeRunCommand(openCode.model, prompt, {
      enableStagehandTools,
    }),
    prepared.sandboxPath,
    {
      OPENROUTER_API_KEY: openCode.apiKey,
      OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
    },
    3600,
  );

  await parse(messageId, response.output);
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

  await updateStage(taskId, messageId, "Checking generated changes");

  const changes = await run(
    prepared.sandbox,
    taskId,
    messageId,
    "git status --porcelain",
    prepared.sandboxPath,
    undefined,
    60,
  );

  if (!read(changes.output)) {
    throw new Error("OpenCode finished without producing repository changes.");
  }

  await updateStage(taskId, messageId, "Collecting change summary");

  const [diffSummary, changedFiles] = await Promise.all([
    run(
      prepared.sandbox,
      taskId,
      messageId,
      "git diff --stat --summary",
      prepared.sandboxPath,
      undefined,
      60,
    ),
    run(
      prepared.sandbox,
      taskId,
      messageId,
      "git status --short",
      prepared.sandboxPath,
      undefined,
      60,
    ),
  ]);

  await updateStage(taskId, messageId, "Generating branch, pull request, and comment metadata");

  const started = Date.now();
  const metadata = await generateGitMetadata(
    {
      baseBranch: taskRecord.branchName?.trim() || repo.defaultBranch,
      changedFiles: changedFiles.output,
      diffSummary: diffSummary.output,
      repoFullName: repo.fullName,
      userPrompt: messageRecord.prompt,
    },
    openCode.apiKey,
    openCode.model,
  );

  if (didGitMetadataGenerationTimeout(started)) {
    await appendTaskMessageLog(
      messageId,
      "Git metadata generation timed out; using fallback branch, commit, and PR metadata.\n",
    );
    log.warn("git metadata generation timed out", { taskId });
  }

  await updateTaskRecord(taskId, {
    branchName: metadata.branchName,
  });
  await updateStage(taskId, messageId, "Committing and pushing branch");

  await run(
    prepared.sandbox,
    taskId,
    messageId,
    [
      `git checkout -b '${escape(metadata.branchName)}'`,
      "git add -A",
      `git -c core.hooksPath=/dev/null commit --no-verify -m '${escape(metadata.commitTitle)}'`,
      `GIT_TERMINAL_PROMPT=0 git push --porcelain -u origin '${escape(metadata.branchName)}'`,
    ].join("\n"),
    prepared.sandboxPath,
    undefined,
    900,
  );

  await updateStage(taskId, messageId, "Opening pull request");

  const pr = await unwrapResult<{ number: number; url: string }>(
    Github.createPullRequest({
      base: taskRecord.branchName?.trim() || repo.defaultBranch,
      body: metadata.prBody,
      head: metadata.branchName,
      repoId: taskRecord.repoId ?? "",
      title: metadata.prTitle,
    }),
  );

  if (metadata.prComment.trim()) {
    await updateStage(taskId, messageId, "Posting pull request comment");

    try {
      await unwrapResult<void>(
        Github.createPullRequestComment({
          body: metadata.prComment,
          prNumber: pr.number,
          repoId: taskRecord.repoId ?? "",
        }),
      );
    } catch (error) {
      await appendTaskMessageLog(
        messageId,
        `Failed to post pull request comment: ${Sandbox.getProvider().formatError(error)}\n`,
      );
    }
  }

  await completeMessage(taskId, messageId, "Task completed", {
    branchName: metadata.branchName,
    prNumber: pr.number,
    prUrl: pr.url,
  });
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

  const enableStagehandTools = Sandbox.isFrontendTaskPrompt(messageRecord.prompt);

  const prepared = await SandboxWorkspace.getOrCreateFollowUp({
    authenticatedRemoteUrl,
    enableStagehandTools,
    githubAccessToken,
    messageId,
    provider: Sandbox.getProvider(),
    repo,
    run,
    setupTools: enableStagehandTools ? Sandbox.getSetupToolsCommand() : undefined,
    taskId,
    taskRecord,
    viewer,
  });

  if (!prepared.sandboxPath) {
    throw new Error("No sandbox workspace available for follow-up.");
  }

  await updateStage(taskId, messageId, "Running follow-up task");

  const openCode = ensureOpenCodeConfig();
  const prompt = buildOpenCodePrompt(messageRecord.prompt, {
    enableStagehandTools,
    sandboxId: prepared.sandbox.id,
  });
  const response = await run(
    prepared.sandbox,
    taskId,
    messageId,
    buildOpenCodeRunCommand(openCode.model, prompt, {
      enableStagehandTools,
    }),
    prepared.sandboxPath,
    {
      OPENROUTER_API_KEY: openCode.apiKey,
      OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
    },
    3600,
  );

  await parse(messageId, response.output);
  await assertTaskNotCancelled(taskId);

  if (taskRecord.quickTask) {
    await completeMessage(taskId, messageId, "Follow-up completed");
    return;
  }

  if (taskRecord.branchName) {
    await updateStage(taskId, messageId, "Pushing follow-up changes");
    await pushFollowUpChanges({
      branchName: taskRecord.branchName,
      messageId,
      prompt: messageRecord.prompt,
      sandbox: prepared.sandbox,
      sandboxPath: prepared.sandboxPath,
      taskId,
    });
  }

  await completeMessage(taskId, messageId, "Follow-up completed");
};

export namespace SandboxRun {
  export const processMessage = async (
    taskId: string,
    messageId: string,
    provider: Sandbox.Provider,
    _setupTools?: string,
  ) => {
    const op = log.child({ messageId, taskId });
    const message = await findTaskMessage(messageId);

    if (!message) {
      return;
    }

    try {
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
