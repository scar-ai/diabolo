import "@tanstack/react-start/server-only";
import {
  CodeLanguage,
  type CreateSandboxBaseParams,
  type CreateSandboxFromImageParams,
  Daytona,
} from "@daytonaio/sdk";

import { env } from "@/env/server";
import {
  createPullRequestCommentForSignedInGithubRepo,
  createPullRequestForSignedInGithubRepo,
  getGithubAuthenticatedRemoteUrl,
  getSignedInGithubAccessToken,
  getSignedInGithubRepo,
  getSignedInGithubViewer,
} from "@/lib/github/server";

type RepoTaskInput = {
  prompt: string;
  quickTask: boolean;
  repoId: string;
  sourceBranch: string;
};

type RepoTaskJobStatus = "queued" | "running" | "succeeded" | "failed";

export type AgentMessage = {
  text: string;
  timestamp: number;
};

export type RepoTaskJob = {
  agentMessages: AgentMessage[];
  branchName?: string;
  clonePath?: string;
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prNumber?: number;
  prUrl?: string;
  prompt: string;
  quickTask: boolean;
  repoId: string;
  repoName?: string;
  repoUrl?: string;
  userId: string;
  sandboxId?: string;
  sandboxName?: string;
  stage: string;
  startedAt: string;
  status: RepoTaskJobStatus;
};

const jobs = new Map<string, RepoTaskJob>();
const MAX_LOG_LENGTH = 16_000;
const OPENCODE_INSTALL_COMMAND = [
  'export PATH="$(npm config get prefix)/bin:$PATH"',
  "if ! command -v opencode >/dev/null 2>&1; then npm install -g opencode-ai; fi",
  "opencode --version",
].join("\n");
const DEFAULT_OPENCODE_MODEL = "openrouter/openai/gpt-5-codex";
const KNOWN_NON_OPENROUTER_PROVIDERS = new Set([
  "amazon-bedrock",
  "anthropic",
  "azure",
  "azure-openai",
  "cerebras",
  "deepseek",
  "fireworks",
  "google",
  "google-vertex",
  "groq",
  "lmstudio",
  "ollama",
  "openai",
  "openrouter",
  "opencode",
  "together",
  "xai",
]);
const LEGACY_UNSUPPORTED_IMAGES = new Set(["daytonaio/workspace", "daytonaio/workspace:latest"]);

const getDaytonaClient = () => {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is not configured.");
  }

  return new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL || undefined,
    target: env.DAYTONA_TARGET || undefined,
  });
};

const readCommandOutput = (value: string) => value.trim();

const getConfiguredDaytonaImage = () => {
  const image = env.DAYTONA_DEFAULT_IMAGE?.trim();

  if (!image) {
    return undefined;
  }

  if (LEGACY_UNSUPPORTED_IMAGES.has(image)) {
    return undefined;
  }

  return image;
};

const normalizeOpenRouterModel = (value: string) => {
  const model = value.trim();

  if (!model) {
    return DEFAULT_OPENCODE_MODEL;
  }

  if (model.startsWith("openrouter/")) {
    return model;
  }

  const providerPrefix = model.split("/", 1)[0];

  if (!providerPrefix || !KNOWN_NON_OPENROUTER_PROVIDERS.has(providerPrefix)) {
    return `openrouter/${model}`;
  }

  if (providerPrefix === "openrouter") {
    return model;
  }

  return model;
};

const getConfiguredOpenCodeModel = () =>
  normalizeOpenRouterModel(env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL);

const ensureOpenCodeConfig = () => {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  return {
    apiKey: env.OPENROUTER_API_KEY,
    model: getConfiguredOpenCodeModel(),
  };
};

const makeJobId = () => `repo-task-${crypto.randomUUID()}`;

const sanitizeNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "repo";

const makeSandboxName = (repoName: string) =>
  `task-${sanitizeNamePart(repoName)}-${Date.now().toString(36)}`;

const makeFallbackTitle = (prompt: string) =>
  prompt
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 72) || "Apply requested changes";

const makeFallbackBranchName = (prompt: string) =>
  `diabolo/${sanitizeNamePart(makeFallbackTitle(prompt))}-${Date.now().toString(36)}`;

const makeFallbackPrBody = (prompt: string) =>
  ["Summary", "- Applies the requested repository changes.", "", "Context", prompt.trim()].join(
    "\n",
  );

const GIT_METADATA_TIMEOUT_MS = 20_000;

type GeneratedGitMetadata = {
  branchName: string;
  commitTitle: string;
  prTitle: string;
  prBody: string;
  prComment: string;
};

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

const updateJob = (jobId: string, patch: Partial<RepoTaskJob>) => {
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
  sandbox: Awaited<ReturnType<Daytona["create"]>>,
  jobId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout = 0,
) => {
  const response = await sandbox.process.executeCommand(command, cwd, envVars, timeout);
  const output = response.result || "";

  if (output) {
    appendJobLog(jobId, `${output}\n`);
  }

  if (response.exitCode !== 0) {
    throw new Error(
      readCommandOutput(output) || `Command failed with exit code ${response.exitCode}.`,
    );
  }

  return response;
};

const parseOpenCodeJsonOutput = (jobId: string, output: string) => {
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const event = JSON.parse(trimmed);

      if (event.type === "text" && event.part?.text) {
        appendAgentMessage(jobId, event.part.text, event.timestamp ?? Date.now());
      }
    } catch {
      // Not a JSON line
    }
  }
};

const buildOpenCodePrompt = (userPrompt: string) =>
  [
    "You are working inside a cloned GitHub repository.",
    "Complete the user's task fully before you stop.",
    "Inspect the codebase first, make the required changes, and run the relevant verification commands.",
    "Fix any issues you find during verification before finishing.",
    "Do not create commits, branches, or pull requests yourself.",
    "Leave the repository with uncommitted file changes only.",
    "",
    "User task:",
    userPrompt.trim(),
  ].join("\n");

const getProviderScopedModelId = (model: string) => {
  if (model.startsWith("openrouter/")) {
    return model.slice("openrouter/".length);
  }

  return model;
};

const buildOpenCodeConfigContent = (model: string) => {
  const providerScopedModelId = getProviderScopedModelId(model);

  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model,
    permission: {
      bash: {
        "*": "allow",
      },
      edit: "allow",
      webfetch: "allow",
    },
    provider: {
      openrouter: {
        models: {
          [providerScopedModelId]: {},
        },
        options: {},
      },
    },
  });
};

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

type GitMetadataContext = {
  baseBranch: string;
  changedFiles: string;
  diffSummary: string;
  repoFullName: string;
  userPrompt: string;
};

const makeFallbackPrComment = (prompt: string) =>
  ["Implemented the requested changes for this PR.", "", "Request context", prompt.trim()].join(
    "\n",
  );

const getFallbackGitMetadata = (userPrompt: string): GeneratedGitMetadata => ({
  branchName: makeFallbackBranchName(userPrompt),
  commitTitle: makeFallbackTitle(userPrompt),
  prBody: makeFallbackPrBody(userPrompt),
  prComment: makeFallbackPrComment(userPrompt),
  prTitle: makeFallbackTitle(userPrompt),
});

const tryParseJsonObject = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch {}

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(normalized.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const sanitizeGeneratedBranchName = (value: string, userPrompt: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^-+|-+$/g, "")
    .replace(/\/-+|-+\//g, "/")
    .slice(0, 80);

  return normalized || makeFallbackBranchName(userPrompt);
};

const generateGitMetadata = async (
  context: GitMetadataContext,
  apiKey: string,
  model: string,
): Promise<GeneratedGitMetadata> => {
  const fallback = getFallbackGitMetadata(context.userPrompt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GIT_METADATA_TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: [
              "You generate Git metadata for an automated coding task.",
              "Return strict JSON only.",
              "The JSON must include string fields: branchName, commitTitle, prTitle, prBody, prComment.",
              "branchName must be lowercase and use only letters, numbers, slashes, and hyphens.",
              "commitTitle must be a concise imperative git commit title under 72 characters.",
              "prTitle must be concise and descriptive under 80 characters.",
              "prBody must be valid markdown with a short summary and key changes.",
              "prComment must be a custom PR thread comment in markdown, concise and specific to the request.",
              "Do not mention that you are an AI or include code fences.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Repository: ${context.repoFullName}`,
              `Base branch: ${context.baseBranch}`,
              "",
              "User request:",
              context.userPrompt.trim(),
              "",
              "Diff summary:",
              context.diffSummary.trim() || "No diff summary available.",
              "",
              "Changed files:",
              context.changedFiles.trim() || "No changed files listed.",
            ].join("\n"),
          },
        ],
        model: getProviderScopedModelId(model),
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content;
    const parsed = content ? tryParseJsonObject(content) : null;

    if (!parsed) {
      return fallback;
    }

    const branchName =
      typeof parsed.branchName === "string"
        ? sanitizeGeneratedBranchName(parsed.branchName, context.userPrompt)
        : fallback.branchName;
    const commitTitle =
      typeof parsed.commitTitle === "string" && parsed.commitTitle.trim()
        ? parsed.commitTitle.trim().slice(0, 72)
        : fallback.commitTitle;
    const prTitle =
      typeof parsed.prTitle === "string" && parsed.prTitle.trim()
        ? parsed.prTitle.trim().slice(0, 80)
        : fallback.prTitle;
    const prBody =
      typeof parsed.prBody === "string" && parsed.prBody.trim()
        ? parsed.prBody.trim()
        : fallback.prBody;
    const prComment =
      typeof parsed.prComment === "string" && parsed.prComment.trim()
        ? parsed.prComment.trim()
        : fallback.prComment;

    return {
      branchName,
      commitTitle,
      prBody,
      prComment,
      prTitle,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
};

const getDaytonaErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected Daytona error.";

  if (
    message.toLowerCase().includes("unprocessable entity") &&
    message.toLowerCase().includes("pull access denied")
  ) {
    const configuredImage = env.DAYTONA_DEFAULT_IMAGE?.trim();

    if (configuredImage) {
      return `Daytona could not pull the configured image "${configuredImage}". Clear DAYTONA_DEFAULT_IMAGE to use Daytona's default sandbox image, or set it to a valid image your Daytona target can access.`;
    }

    return "Daytona could not start the sandbox because the resolved image was not accessible. Set a valid DAYTONA_DEFAULT_IMAGE for your Daytona target, or leave it unset to use Daytona's default sandbox image.";
  }

  return message;
};

const createSandbox = async (repoName: string) => {
  const daytona = getDaytonaClient();
  const baseParams: CreateSandboxBaseParams = {
    autoDeleteInterval: 0,
    autoStopInterval: 30,
    language: CodeLanguage.TYPESCRIPT,
    name: makeSandboxName(repoName),
  };
  const configuredImage = getConfiguredDaytonaImage();

  if (configuredImage) {
    const imageParams: CreateSandboxFromImageParams = {
      ...baseParams,
      image: configuredImage,
    };

    return daytona.create(imageParams, { timeout: 120 });
  }

  return daytona.create(baseParams, { timeout: 120 });
};

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

  const daytona = getDaytonaClient();

  try {
    const sandbox = await daytona.get(job.sandboxId);

    try {
      await sandbox.stop(120);
    } catch {}

    try {
      await sandbox.delete(120);
    } catch {}
  } catch {}

  updateJob(jobId, {
    clonePath: undefined,
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

  const sandbox = await createSandbox(repoName);
  const sandboxId = sandbox.id;
  const sandboxName = sandbox.name;

  updateJob(jobId, {
    sandboxId,
    sandboxName,
    stage: "Resolving sandbox workspace",
  });

  const workDir = (await sandbox.getWorkDir()) ?? (await sandbox.getUserHomeDir()) ?? ".";
  const clonePath = `${workDir.replace(/\/$/, "")}/${repoName}`;

  updateJob(jobId, {
    clonePath,
    stage: "Cloning repository into sandbox",
  });

  await sandbox.git.clone(repoUrl, clonePath, branch, undefined, repoOwnerLogin, githubAccessToken);

  const authenticatedRemoteUrl = await getGithubAuthenticatedRemoteUrl(repoId);

  updateJob(jobId, {
    clonePath,
    stage: "Preparing git branch and OpenCode runtime",
  });

  await runSandboxCommand(
    sandbox,
    jobId,
    [
      `git remote set-url origin '${escapeForSingleQuotedShell(authenticatedRemoteUrl)}'`,
      `git config user.name '${escapeForSingleQuotedShell(viewer.name)}'`,
      `git config user.email '${escapeForSingleQuotedShell(viewer.email)}'`,
      OPENCODE_INSTALL_COMMAND,
    ].join("\n"),
    clonePath,
    undefined,
    900,
  );

  return {
    clonePath,
    sandbox,
    sandboxId,
    sandboxName,
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

const runRepoTaskJob = async (jobId: string, input: RepoTaskInput) => {
  let sandbox: Awaited<ReturnType<Daytona["create"]>> | undefined;

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

    const sourceBranch = input.sourceBranch.trim() || repo.defaultBranch;
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
    const clonePath = prepared.clonePath;

    updateJob(jobId, {
      stage: "Running OpenCode task",
    });

    const openCodePrompt = buildOpenCodePrompt(input.prompt);
    const openCodeResponse = await runSandboxCommand(
      sandbox,
      jobId,
      `opencode run --format json --model '${escapeForSingleQuotedShell(openCode.model)}' "$(cat <<'EOF'\n${openCodePrompt}\nEOF\n)"`,
      clonePath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
      },
      3600,
    );

    parseOpenCodeJsonOutput(jobId, openCodeResponse.result || "");

    updateJob(jobId, {
      stage: "Checking generated changes",
    });

    const changeCheck = await runSandboxCommand(
      sandbox,
      jobId,
      "git status --porcelain",
      clonePath,
      undefined,
      60,
    );

    if (!readCommandOutput(changeCheck.result)) {
      throw new Error("OpenCode finished without producing repository changes.");
    }

    updateJob(jobId, {
      stage: "Collecting change summary",
    });

    const [diffSummaryResult, changedFilesResult] = await Promise.all([
      runSandboxCommand(sandbox, jobId, "git diff --stat --summary", clonePath, undefined, 60),
      runSandboxCommand(sandbox, jobId, "git status --short", clonePath, undefined, 60),
    ]);

    updateJob(jobId, {
      stage: "Generating branch, pull request, and comment metadata",
    });

    const metadataStartedAt = Date.now();
    const metadata = await generateGitMetadata(
      {
        baseBranch: sourceBranch,
        changedFiles: changedFilesResult.result || "",
        diffSummary: diffSummaryResult.result || "",
        repoFullName: repo.fullName,
        userPrompt: input.prompt,
      },
      openCode.apiKey,
      openCode.model,
    );

    if (Date.now() - metadataStartedAt >= GIT_METADATA_TIMEOUT_MS) {
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
      clonePath,
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
          `Failed to post pull request comment: ${getDaytonaErrorMessage(error)}\n`,
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
      error: getDaytonaErrorMessage(error),
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
          `Failed to destroy quick task sandbox: ${getDaytonaErrorMessage(error)}\n`,
        );
      }
    }
  }
};

export const startRepoTaskJob = async (input: RepoTaskInput, userId: string) => {
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
  const job: RepoTaskJob = {
    agentMessages: [],
    id: jobId,
    prompt,
    quickTask: input.quickTask,
    repoId: input.repoId,
    stage: "Queued",
    startedAt,
    status: "queued",
    userId,
  };

  jobs.set(jobId, job);

  queueMicrotask(() => {
    void runRepoTaskJob(jobId, {
      prompt,
      quickTask: input.quickTask,
      repoId: input.repoId,
      sourceBranch: input.sourceBranch,
    });
  });

  return job;
};

export const getRepoTaskJob = async (jobId: string, userId?: string) => requireJob(jobId, userId);

export const terminateRepoTaskJob = async (jobId: string) => {
  const job = jobs.get(jobId);
  if (!job) return;

  updateJob(jobId, {
    completedAt: new Date().toISOString(),
    error: "Task was terminated by user.",
    stage: "Terminated",
    status: "failed",
  });
};

export const destroyRepoTaskSandbox = async (jobId: string, userId?: string) => {
  await destroySandboxResources(jobId, { stage: "Sandbox stopped", userId });
};

export const runFollowUpOnSandbox = async (jobId: string, prompt: string, userId?: string) => {
  const openCode = ensureOpenCodeConfig();
  updateJob(jobId, {
    completedAt: undefined,
    error: undefined,
    stage: "Running follow-up task",
    status: "running",
  });

  try {
    const job = requireJob(jobId, userId);
    const [viewer, githubAccessToken, followUpTarget] = await Promise.all([
      getSignedInGithubViewer(),
      getSignedInGithubAccessToken(),
      getFollowUpBranch(job.repoId, job.branchName),
    ]);
    let sandbox: Awaited<ReturnType<Daytona["create"]>>;
    let clonePath = job.clonePath;

    if (job.sandboxId && job.clonePath) {
      try {
        const daytona = getDaytonaClient();
        sandbox = await daytona.get(job.sandboxId);
      } catch {
        updateJob(jobId, {
          stage: "Recreating sandbox for follow-up",
        });

        const prepared = await prepareSandboxWorkspace({
          branch: followUpTarget.branch,
          githubAccessToken,
          jobId,
          repoId: job.repoId,
          repoName: followUpTarget.repo.name,
          repoOwnerLogin: followUpTarget.repo.ownerLogin,
          repoUrl: followUpTarget.repo.cloneUrl,
          viewer,
        });

        sandbox = prepared.sandbox;
        clonePath = prepared.clonePath;
      }
    } else {
      updateJob(jobId, {
        stage: "Recreating sandbox for follow-up",
      });

      const prepared = await prepareSandboxWorkspace({
        branch: followUpTarget.branch,
        githubAccessToken,
        jobId,
        repoId: job.repoId,
        repoName: followUpTarget.repo.name,
        repoOwnerLogin: followUpTarget.repo.ownerLogin,
        repoUrl: followUpTarget.repo.cloneUrl,
        viewer,
      });

      sandbox = prepared.sandbox;
      clonePath = prepared.clonePath;
    }

    if (!clonePath) {
      throw new Error("No sandbox workspace available for follow-up.");
    }

    updateJob(jobId, {
      stage: "Running follow-up task",
    });

    const openCodePrompt = buildOpenCodePrompt(prompt);
    const followUpResponse = await runSandboxCommand(
      sandbox,
      jobId,
      `opencode run --format json --model '${escapeForSingleQuotedShell(openCode.model)}' "$(cat <<'EOF'\n${openCodePrompt}\nEOF\n)"`,
      clonePath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
      },
      3600,
    );

    parseOpenCodeJsonOutput(jobId, followUpResponse.result || "");

    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      stage: "Follow-up completed",
      status: "succeeded",
    });
  } catch (error) {
    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      error: getDaytonaErrorMessage(error),
      stage: "Follow-up failed",
      status: "failed",
    });
  }
};
