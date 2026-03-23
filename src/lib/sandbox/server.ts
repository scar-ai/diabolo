import "@tanstack/react-start/server-only";
import {
  createPullRequestCommentForSignedInGithubRepo,
  createPullRequestForSignedInGithubRepo,
  getGithubAuthenticatedRemoteUrl,
  getSignedInGithubAccessToken,
  getSignedInGithubRepo,
  getSignedInGithubViewer,
} from "@/lib/github/server";
import { buildOpenCodeConfigContent, ensureOpenCodeConfig } from "@/lib/opencode/config";
import { didGitMetadataGenerationTimeout, generateGitMetadata } from "@/lib/opencode/git-metadata";
import {
  buildStagehandOpenCodeExports,
  buildStagehandOpenCodeSetupCommand,
} from "@/lib/opencode/stagehand";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import type { SandboxSession } from "@/lib/sandbox/types";

type SandboxTaskInput = {
  prompt: string;
  quickTask: boolean;
  repoId: string;
  sourceBranch: string;
};

type SandboxTaskStatus = "queued" | "running" | "succeeded" | "failed";

export type AgentMessage = {
  text: string;
  timestamp: number;
};

export type FollowUpEntry = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: AgentMessage[];
  stage: string;
  startedAt: string;
  status: SandboxTaskStatus;
};

export type SandboxTaskJob = {
  agentMessages: AgentMessage[];
  branchName?: string;
  sandboxPath?: string;
  completedAt?: string;
  error?: string;
  followUpHistory: FollowUpEntry[];
  id: string;
  logs?: string;
  prNumber?: number;
  prUrl?: string;
  prompt: string;
  quickTask: boolean;
  repoId: string;
  repoName?: string;
  repoUrl?: string;
  sourceBranch: string;
  userId: string;
  sandboxId?: string;
  sandboxName?: string;
  stage: string;
  startedAt: string;
  status: SandboxTaskStatus;
};

const jobs = new Map<string, SandboxTaskJob>();
const MAX_LOG_LENGTH = 16_000;
const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';
const OPENCODE_INSTALL_COMMAND = [
  SANDBOX_TOOL_PATH_EXPORT,
  "if ! command -v opencode >/dev/null 2>&1; then npm install -g opencode-ai; fi",
  "opencode --version",
].join("\n");
const sandboxProvider = getSandboxProvider();

const readCommandOutput = (value: string) => value.trim();
const makeJobId = () => `tk-${crypto.randomUUID()}`;

const MAX_AGENT_MESSAGES = 200;

const appendJobLog = (jobId: string, chunk: string) => {
  const job = jobs.get(jobId);

  if (!job || !chunk) {
    return;
  }

  const nextLogs = `${job.logs || ""}${chunk}`.slice(-MAX_LOG_LENGTH);
  jobs.set(jobId, {
    ...job,
    logs: nextLogs,
  });
};

const updateFollowUpEntry = (
  jobId: string,
  followUpId: string,
  updater: (entry: FollowUpEntry) => FollowUpEntry,
) => {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  let found = false;
  const followUpHistory = job.followUpHistory.map((entry) => {
    if (entry.id !== followUpId) {
      return entry;
    }

    found = true;
    return updater(entry);
  });

  if (!found) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    followUpHistory,
  });
};

const appendFollowUpLog = (jobId: string, followUpId: string, chunk: string) => {
  if (!chunk) {
    return;
  }

  updateFollowUpEntry(jobId, followUpId, (entry) => ({
    ...entry,
    logs: `${entry.logs || ""}${chunk}`.slice(-MAX_LOG_LENGTH),
  }));
};

const appendAgentMessage = (jobId: string, text: string, timestamp: number) => {
  const job = jobs.get(jobId);

  if (!job || !text.trim()) {
    return;
  }

  const messages = [...job.agentMessages, { text: text.trim(), timestamp }].slice(
    -MAX_AGENT_MESSAGES,
  );
  jobs.set(jobId, { ...job, agentMessages: messages });
};

const appendFollowUpAgentMessage = (
  jobId: string,
  followUpId: string,
  text: string,
  timestamp: number,
) => {
  if (!text.trim()) {
    return;
  }

  updateFollowUpEntry(jobId, followUpId, (entry) => ({
    ...entry,
    responseMessages: [...entry.responseMessages, { text: text.trim(), timestamp }].slice(
      -MAX_AGENT_MESSAGES,
    ),
  }));
};

const updateJob = (jobId: string, patch: Partial<SandboxTaskJob>) => {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    ...patch,
  });
};

const requireJob = (jobId: string, userId?: string) => {
  const job = jobs.get(jobId);

  if (!job || (userId && job.userId !== userId)) {
    throw new Error("Task not found.");
  }

  return job;
};

const runSandboxCommand = async (
  sandbox: SandboxSession,
  jobId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout = 0,
  options?: {
    followUpId?: string;
  },
) => {
  const response = await sandbox.executeCommand(command, {
    cwd,
    envVars,
    timeoutSeconds: timeout,
  });
  const output = response.output;

  if (output) {
    if (options?.followUpId) {
      appendFollowUpLog(jobId, options.followUpId, `${output}\n`);
    } else {
      appendJobLog(jobId, `${output}\n`);
    }
  }

  if (response.exitCode !== 0) {
    throw new Error(
      readCommandOutput(output) || `Command failed with exit code ${response.exitCode}.`,
    );
  }

  return response;
};

const parseOpenCodeJsonOutput = (jobId: string, output: string) => {
  parseOpenCodeJsonOutputForTarget(jobId, output);
};

const parseOpenCodeJsonOutputForTarget = (jobId: string, output: string, followUpId?: string) => {
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed);

      if (event.type === "text" && event.part?.text) {
        if (followUpId) {
          appendFollowUpAgentMessage(
            jobId,
            followUpId,
            event.part.text,
            event.timestamp ?? Date.now(),
          );
        } else {
          appendAgentMessage(jobId, event.part.text, event.timestamp ?? Date.now());
        }
      }
    } catch {
      // Not a JSON line
    }
  }
};

const FRONTEND_TASK_PATTERN =
  /\b(frontend|ui|ux|browser|screenshot|screen shot|visual|css|tailwind|layout|responsive|component|shadcn|page|modal|dialog|dropdown|form|button|input|navbar|sidebar|header|footer|computer use|computer-use|desktop|gui|click|type|typing|keyboard|mouse|preview|stagehand|browser automation|sandbox browser|open the browser|open browser|localhost|127\.0\.0\.1|check out the file)\b/i;

const isFrontendTaskPrompt = (prompt: string) => FRONTEND_TASK_PATTERN.test(prompt);

const buildOpenCodePrompt = (
  userPrompt: string,
  options?: {
    enableStagehandTools?: boolean;
    sandboxId?: string;
  },
) =>
  [
    "You are working inside a cloned GitHub repository.",
    "Complete the user's task fully before you stop.",
    "Inspect the codebase first, make the required changes, and run the relevant verification commands.",
    "Fix any issues you find during verification before finishing.",
    "Do not create commits, branches, or pull requests yourself.",
    "Leave the repository with uncommitted file changes only.",
    ...(options?.enableStagehandTools
      ? [
          "",
          "Frontend validation instructions:",
          "Use the Stagehand local browser tools for browser automation, screenshots, and interactive verification when the task touches frontend behavior.",
          "If the user explicitly asks for computer use, the browser, screenshots, clicking, typing, localhost pages, or similar interactive actions, you must use the Stagehand tools instead of relying only on shell inspection.",
          options.sandboxId
            ? `The current Daytona sandbox id is ${options.sandboxId}. Run the Stagehand browser inside this sandbox and keep browser activity local to it.`
            : "Use the current sandbox for local Stagehand browser actions whenever possible.",
          "Key tools available include stagehand_open_url, stagehand_get_state, stagehand_page_text, stagehand_observe, stagehand_act, stagehand_screenshot, and stagehand_close.",
          "If you need to verify UI behavior, start the app server inside the sandbox, open the local URL with stagehand_open_url, interact through Stagehand, and capture screenshots before finishing.",
        ]
      : []),
    "",
    "User task:",
    userPrompt.trim(),
  ].join("\n");

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

const buildOpenCodeRunCommand = (
  model: string,
  prompt: string,
  options?: {
    enableStagehandTools?: boolean;
  },
) =>
  [
    SANDBOX_TOOL_PATH_EXPORT,
    ...(options?.enableStagehandTools
      ? [buildStagehandOpenCodeSetupCommand(), buildStagehandOpenCodeExports()]
      : []),
    'printf \'%s\' "$OPENCODE_CONFIG_CONTENT" > "$PWD/../.opencode.generated.json"',
    'export OPENCODE_CONFIG="$PWD/../.opencode.generated.json"',
    `opencode run --format json --model '${escapeForSingleQuotedShell(model)}' "$(cat <<'EOF'\n${prompt}\nEOF\n)"`,
  ].join("\n");
const destroySandboxResources = async (
  jobId: string,
  options?: {
    stage?: string;
    userId?: string;
  },
) => {
  const job = requireJob(jobId, options?.userId);

  if (!job.sandboxId) {
    return;
  }

  try {
    await sandboxProvider.destroyWorkspace(job.sandboxId);
  } catch {}

  updateJob(jobId, {
    sandboxPath: undefined,
    sandboxId: undefined,
    sandboxName: undefined,
    stage: options?.stage ?? "Sandbox stopped",
  });
};

const prepareSandboxWorkspace = async ({
  branch,
  githubAccessToken,
  jobId,
  repoId,
  repoName,
  repoOwnerLogin,
  repoUrl,
  viewer,
}: {
  branch: string;
  githubAccessToken: string;
  jobId: string;
  repoId: string;
  repoName: string;
  repoOwnerLogin: string;
  repoUrl: string;
  viewer: Awaited<ReturnType<typeof getSignedInGithubViewer>>;
}) => {
  updateJob(jobId, {
    stage: "Booting Daytona sandbox",
    status: "running",
  });

  const sandbox = await sandboxProvider.createWorkspace(repoName);
  const sandboxId = sandbox.id;
  const sandboxName = sandbox.name;

  updateJob(jobId, {
    sandboxId,
    sandboxName,
    stage: "Resolving sandbox workspace",
  });

  const workDir = await sandbox.getWorkspaceRoot();
  const sandboxPath = `${workDir.replace(/\/$/, "")}/${repoName}`;

  updateJob(jobId, {
    sandboxPath,
    stage: "Cloning repository into sandbox",
  });

  await sandbox.cloneRepository({
    accessToken: githubAccessToken,
    branch,
    ownerLogin: repoOwnerLogin,
    targetPath: sandboxPath,
    url: repoUrl,
  });

  const authenticatedRemoteUrl = await getGithubAuthenticatedRemoteUrl(repoId);
  const setupCommands = [
    `git remote set-url origin '${escapeForSingleQuotedShell(authenticatedRemoteUrl)}'`,
    `git config user.name '${escapeForSingleQuotedShell(viewer.name)}'`,
    `git config user.email '${escapeForSingleQuotedShell(viewer.email)}'`,
    OPENCODE_INSTALL_COMMAND,
  ];

  updateJob(jobId, {
    sandboxPath,
    stage: "Preparing git branch and OpenCode runtime",
  });

  await runSandboxCommand(sandbox, jobId, setupCommands.join("\n"), sandboxPath, undefined, 900);

  return {
    sandbox,
    sandboxId,
    sandboxName,
    sandboxPath,
  };
};

const getFollowUpBranch = async (repoId: string, branchName?: string) => {
  const repo = await getSignedInGithubRepo(repoId);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  return {
    branch: branchName?.trim() || repo.defaultBranch,
    repo,
  };
};

const markFollowUpRecreation = (jobId: string, followUpId: string) => {
  updateJob(jobId, {
    stage: "Recreating sandbox for follow-up",
  });
  updateFollowUpEntry(jobId, followUpId, (entry) => ({
    ...entry,
    stage: "Recreating sandbox for follow-up",
  }));
};

const getOrCreateFollowUpWorkspace = async ({
  followUpId,
  followUpTarget,
  githubAccessToken,
  job,
  viewer,
}: {
  followUpId: string;
  followUpTarget: Awaited<ReturnType<typeof getFollowUpBranch>>;
  githubAccessToken: string;
  job: SandboxTaskJob;
  viewer: Awaited<ReturnType<typeof getSignedInGithubViewer>>;
}) => {
  if (job.sandboxId && job.sandboxPath) {
    try {
      return {
        sandbox: await sandboxProvider.getWorkspace(job.sandboxId),
        sandboxPath: job.sandboxPath,
      };
    } catch {}
  }

  markFollowUpRecreation(job.id, followUpId);

  const prepared = await prepareSandboxWorkspace({
    branch: followUpTarget.branch,
    githubAccessToken,
    jobId: job.id,
    repoId: job.repoId,
    repoName: followUpTarget.repo.name,
    repoOwnerLogin: followUpTarget.repo.ownerLogin,
    repoUrl: followUpTarget.repo.cloneUrl,
    viewer,
  });

  return {
    sandbox: prepared.sandbox,
    sandboxPath: prepared.sandboxPath,
  };
};

const runSandboxTaskJob = async (jobId: string, input: SandboxTaskInput) => {
  let sandbox: SandboxSession | undefined;

  try {
    const [repo, githubAccessToken, viewer] = await Promise.all([
      getSignedInGithubRepo(input.repoId),
      getSignedInGithubAccessToken(),
      getSignedInGithubViewer(),
    ]);
    const openCode = ensureOpenCodeConfig();

    if (!repo) {
      throw new Error("Unknown repository selection.");
    }

    updateJob(jobId, {
      repoName: repo.fullName,
      repoUrl: repo.htmlUrl,
      status: "running",
    });

    const job = jobs.get(jobId);
    const sourceBranch = job?.sourceBranch || input.sourceBranch.trim() || repo.defaultBranch;
    const enableStagehandTools = isFrontendTaskPrompt(input.prompt);
    const prepared = await prepareSandboxWorkspace({
      branch: sourceBranch,
      githubAccessToken,
      jobId,
      repoId: input.repoId,
      repoName: repo.name,
      repoOwnerLogin: repo.ownerLogin,
      repoUrl: repo.cloneUrl,
      viewer,
    });
    sandbox = prepared.sandbox;
    const sandboxPath = prepared.sandboxPath;

    updateJob(jobId, {
      stage: "Running OpenCode task",
    });

    const openCodePrompt = buildOpenCodePrompt(input.prompt, {
      enableStagehandTools,
      sandboxId: sandbox.id,
    });
    const openCodeResponse = await runSandboxCommand(
      sandbox,
      jobId,
      buildOpenCodeRunCommand(openCode.model, openCodePrompt, {
        enableStagehandTools,
      }),
      sandboxPath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
      },
      3600,
    );

    parseOpenCodeJsonOutput(jobId, openCodeResponse.output);

    updateJob(jobId, {
      stage: "Checking generated changes",
    });

    const changeCheck = await runSandboxCommand(
      sandbox,
      jobId,
      "git status --porcelain",
      sandboxPath,
      undefined,
      60,
    );

    if (!readCommandOutput(changeCheck.output)) {
      throw new Error("OpenCode finished without producing repository changes.");
    }

    updateJob(jobId, {
      stage: "Collecting change summary",
    });

    const [diffSummaryResult, changedFilesResult] = await Promise.all([
      runSandboxCommand(sandbox, jobId, "git diff --stat --summary", sandboxPath, undefined, 60),
      runSandboxCommand(sandbox, jobId, "git status --short", sandboxPath, undefined, 60),
    ]);

    updateJob(jobId, {
      stage: "Generating branch, pull request, and comment metadata",
    });

    const metadataStartedAt = Date.now();
    const metadata = await generateGitMetadata(
      {
        baseBranch: sourceBranch,
        changedFiles: changedFilesResult.output,
        diffSummary: diffSummaryResult.output,
        repoFullName: repo.fullName,
        userPrompt: input.prompt,
      },
      openCode.apiKey,
      openCode.model,
    );

    if (didGitMetadataGenerationTimeout(metadataStartedAt)) {
      appendJobLog(
        jobId,
        "Git metadata generation timed out; using fallback branch, commit, and PR metadata.\n",
      );
    }

    updateJob(jobId, {
      branchName: metadata.branchName,
      stage: "Committing and pushing branch",
    });

    await runSandboxCommand(
      sandbox,
      jobId,
      [
        `git checkout -b '${escapeForSingleQuotedShell(metadata.branchName)}'`,
        "git add -A",
        `git -c core.hooksPath=/dev/null commit --no-verify -m '${escapeForSingleQuotedShell(metadata.commitTitle)}'`,
        `GIT_TERMINAL_PROMPT=0 git push --porcelain -u origin '${escapeForSingleQuotedShell(metadata.branchName)}'`,
      ].join("\n"),
      sandboxPath,
      undefined,
      900,
    );

    updateJob(jobId, {
      stage: "Opening pull request",
    });

    const pullRequest = await createPullRequestForSignedInGithubRepo({
      base: sourceBranch,
      body: metadata.prBody,
      head: metadata.branchName,
      repoId: input.repoId,
      title: metadata.prTitle,
    });

    if (metadata.prComment.trim()) {
      updateJob(jobId, {
        stage: "Posting pull request comment",
      });

      try {
        await createPullRequestCommentForSignedInGithubRepo({
          body: metadata.prComment,
          prNumber: pullRequest.number,
          repoId: input.repoId,
        });
      } catch (error) {
        appendJobLog(
          jobId,
          `Failed to post pull request comment: ${sandboxProvider.formatError(error)}\n`,
        );
      }
    }

    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      prNumber: pullRequest.number,
      prUrl: pullRequest.url,
      stage: "Task completed",
      status: "succeeded",
    });
  } catch (error) {
    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      error: sandboxProvider.formatError(error),
      stage: "Task failed",
      status: "failed",
    });
  } finally {
    const current = jobs.get(jobId);

    if (current && current.status !== "failed" && current.status !== "succeeded") {
      updateJob(jobId, {
        completedAt: new Date().toISOString(),
        stage: "Task completed",
        status: "succeeded",
      });
    }

    if (input.quickTask) {
      const terminalJob = jobs.get(jobId);
      const cleanupStage =
        terminalJob?.status === "failed"
          ? "Quick task failed; sandbox destroyed"
          : "Quick task completed; sandbox destroyed";

      try {
        await destroySandboxResources(jobId, { stage: cleanupStage });
      } catch (error) {
        appendJobLog(
          jobId,
          `Failed to destroy quick task sandbox: ${sandboxProvider.formatError(error)}\n`,
        );
      }
    }
  }
};

export const startSandboxTask = async (input: SandboxTaskInput, userId: string) => {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  if (prompt.length < 10) {
    throw new Error("Prompt must be at least 10 characters.");
  }

  const repo = await getSignedInGithubRepo(input.repoId);
  ensureOpenCodeConfig();

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  const jobId = makeJobId();
  const startedAt = new Date().toISOString();
  const sourceBranch = input.sourceBranch.trim() || repo.defaultBranch;
  const job: SandboxTaskJob = {
    agentMessages: [],
    followUpHistory: [],
    id: jobId,
    prompt,
    quickTask: input.quickTask,
    repoId: input.repoId,
    sourceBranch,
    stage: "Queued",
    startedAt,
    status: "queued",
    userId,
  };

  jobs.set(jobId, job);

  queueMicrotask(() => {
    void runSandboxTaskJob(jobId, {
      prompt,
      quickTask: input.quickTask,
      repoId: input.repoId,
      sourceBranch: input.sourceBranch,
    });
  });

  return job;
};

export const getSandboxTask = async (jobId: string, userId?: string) => requireJob(jobId, userId);

export const terminateSandboxTask = async (jobId: string) => {
  const job = jobs.get(jobId);
  if (!job) return;

  updateJob(jobId, {
    completedAt: new Date().toISOString(),
    error: "Task was terminated by user.",
    stage: "Terminated",
    status: "failed",
  });
};

export const destroyTaskSandbox = async (jobId: string, userId?: string) => {
  await destroySandboxResources(jobId, { stage: "Sandbox stopped", userId });
};

export const destroySandbox = async (sandboxId: string) => {
  try {
    await sandboxProvider.destroyWorkspace(sandboxId);
  } catch {}
};

export const runSandboxTaskFollowUp = async (jobId: string, prompt: string, userId?: string) => {
  const openCode = ensureOpenCodeConfig();
  const followUpId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const trimmedPrompt = prompt.trim();
  const enableStagehandTools = isFrontendTaskPrompt(trimmedPrompt);
  const job = requireJob(jobId, userId);

  updateJob(jobId, {
    completedAt: undefined,
    error: undefined,
    followUpHistory: [
      ...job.followUpHistory,
      {
        id: followUpId,
        prompt: trimmedPrompt,
        responseMessages: [],
        stage: "Running follow-up task",
        startedAt,
        status: "running",
      },
    ],
    stage: "Running follow-up task",
    status: "running",
  });

  try {
    const [viewer, githubAccessToken, followUpTarget] = await Promise.all([
      getSignedInGithubViewer(),
      getSignedInGithubAccessToken(),
      getFollowUpBranch(job.repoId, job.branchName),
    ]);
    const { sandbox, sandboxPath } = await getOrCreateFollowUpWorkspace({
      followUpId,
      followUpTarget,
      githubAccessToken,
      job,
      viewer,
    });

    if (!sandboxPath) {
      throw new Error("No sandbox workspace available for follow-up.");
    }

    updateJob(jobId, {
      stage: "Running follow-up task",
    });
    updateFollowUpEntry(jobId, followUpId, (entry) => ({
      ...entry,
      stage: "Running follow-up task",
    }));

    const openCodePrompt = buildOpenCodePrompt(prompt, {
      enableStagehandTools,
      sandboxId: sandbox.id,
    });
    const followUpResponse = await runSandboxCommand(
      sandbox,
      jobId,
      buildOpenCodeRunCommand(openCode.model, openCodePrompt, {
        enableStagehandTools,
      }),
      sandboxPath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
      },
      3600,
      { followUpId },
    );

    parseOpenCodeJsonOutputForTarget(jobId, followUpResponse.output, followUpId);

    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      stage: "Follow-up completed",
      status: "succeeded",
    });
    updateFollowUpEntry(jobId, followUpId, (entry) => ({
      ...entry,
      completedAt: new Date().toISOString(),
      stage: "Follow-up completed",
      status: "succeeded",
    }));
  } catch (error) {
    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      error: sandboxProvider.formatError(error),
      stage: "Follow-up failed",
      status: "failed",
    });
    updateFollowUpEntry(jobId, followUpId, (entry) => ({
      ...entry,
      completedAt: new Date().toISOString(),
      error: sandboxProvider.formatError(error),
      stage: "Follow-up failed",
      status: "failed",
    }));
  }
};
