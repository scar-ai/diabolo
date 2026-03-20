import "@tanstack/react-start/server-only";
import {
  CodeLanguage,
  type CreateSandboxBaseParams,
  type CreateSandboxFromImageParams,
  Daytona,
} from "@daytonaio/sdk";
import * as z from "zod";

import { env } from "@/env/server";
import {
  createPullRequestForSignedInGithubRepo,
  getGithubAuthenticatedRemoteUrl,
  getSignedInGithubAccessToken,
  getSignedInGithubRepo,
  getSignedInGithubViewer,
} from "@/lib/github/server";

type RepoTaskInput = {
  prompt: string;
  repoId: string;
  sourceBranch: string;
};

type RepoTaskJobStatus = "queued" | "running" | "succeeded" | "failed";

export type RepoTaskJob = {
  branchName?: string;
  clonePath?: string;
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prNumber?: number;
  prUrl?: string;
  prompt: string;
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

const generatedGitMetadataSchema = z.object({
  branchName: z.string().min(1),
  commitTitle: z.string().min(1),
  prTitle: z.string().min(1),
  prBody: z.string().min(1),
});

type GeneratedGitMetadata = z.infer<typeof generatedGitMetadataSchema>;

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

const buildGitMetadataPrompt = (input: {
  defaultBranch: string;
  diff: string;
  repoFullName: string;
  userPrompt: string;
}) =>
  [
    "You are generating git metadata for a completed code change.",
    "Return JSON only. Do not use markdown fences. Do not add commentary.",
    'The JSON object must match this shape exactly: {"branchName":"...","commitTitle":"...","prTitle":"...","prBody":"..."}',
    "Requirements:",
    `- branchName must be a descriptive git branch name prefixed with "diabolo/" and use lowercase kebab-case path segments only.`,
    "- branchName must be at most 80 characters.",
    "- commitTitle must be a concise imperative git commit title at most 72 characters.",
    "- prTitle must be concise, specific, and user-facing.",
    "- prBody must be plain text, readable in GitHub, and include short sections named Summary, Testing, and Context.",
    `- The base branch is "${input.defaultBranch}".`,
    `- The repository is "${input.repoFullName}".`,
    "",
    "Original user task:",
    input.userPrompt.trim(),
    "",
    "Unified diff:",
    input.diff.trim(),
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

const extractJsonObject = (value: string) => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || value.trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
};

const normalizeBranchName = (value: string, fallbackPrompt: string) => {
  const normalized =
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-")
      .replace(/\/{2,}/g, "/")
      .replace(/-{2,}/g, "-")
      .replace(/(^[/-]+|[/-]+$)/g, "") || makeFallbackBranchName(fallbackPrompt);

  const prefixed = normalized.startsWith("diabolo/") ? normalized : `diabolo/${normalized}`;
  const limited = prefixed.slice(0, 80).replace(/[/-]+$/g, "");

  return limited || makeFallbackBranchName(fallbackPrompt);
};

const normalizeTitle = (value: string, fallbackPrompt: string) =>
  value.trim().replace(/\s+/g, " ").slice(0, 72) || makeFallbackTitle(fallbackPrompt);

const normalizePrBody = (value: string, fallbackPrompt: string) =>
  value.trim() || makeFallbackPrBody(fallbackPrompt);

const generateGitMetadata = async (input: {
  clonePath: string;
  defaultBranch: string;
  jobId: string;
  openCodeApiKey: string;
  openCodeModel: string;
  repoFullName: string;
  sandbox: Awaited<ReturnType<Daytona["create"]>>;
  userPrompt: string;
}) => {
  const diffResponse = await runSandboxCommand(
    input.sandbox,
    input.jobId,
    "git diff -- . ':(exclude)pnpm-lock.yaml'",
    input.clonePath,
    undefined,
    120,
  );
  const diff = readCommandOutput(diffResponse.result);

  if (!diff) {
    throw new Error("Unable to generate git metadata because no diff was available.");
  }

  const prompt = buildGitMetadataPrompt({
    defaultBranch: input.defaultBranch,
    diff,
    repoFullName: input.repoFullName,
    userPrompt: input.userPrompt,
  });
  const metadataResponse = await runSandboxCommand(
    input.sandbox,
    input.jobId,
    `opencode run --model '${escapeForSingleQuotedShell(input.openCodeModel)}' "$(cat <<'EOF'\n${prompt}\nEOF\n)"`,
    input.clonePath,
    {
      OPENROUTER_API_KEY: input.openCodeApiKey,
      OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(input.openCodeModel),
    },
    900,
  );
  const parsed = generatedGitMetadataSchema.safeParse(
    extractJsonObject(metadataResponse.result || ""),
  );

  if (!parsed.success) {
    return {
      branchName: makeFallbackBranchName(input.userPrompt),
      commitTitle: makeFallbackTitle(input.userPrompt),
      prBody: makeFallbackPrBody(input.userPrompt),
      prTitle: makeFallbackTitle(input.userPrompt),
    };
  }

  return {
    branchName: normalizeBranchName(parsed.data.branchName, input.userPrompt),
    commitTitle: normalizeTitle(parsed.data.commitTitle, input.userPrompt),
    prBody: normalizePrBody(parsed.data.prBody, input.userPrompt),
    prTitle: normalizeTitle(parsed.data.prTitle, input.userPrompt),
  } satisfies GeneratedGitMetadata;
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
      stage: "Booting Daytona sandbox",
      status: "running",
    });

    sandbox = await createSandbox(repo.name);

    const sandboxId = sandbox.id;
    const sandboxName = sandbox.name;

    updateJob(jobId, {
      sandboxId,
      sandboxName,
      stage: "Resolving sandbox workspace",
    });

    const workDir = (await sandbox.getWorkDir()) ?? (await sandbox.getUserHomeDir()) ?? ".";
    const clonePath = `${workDir.replace(/\/$/, "")}/${repo.name}`;
    const sourceBranch = input.sourceBranch.trim() || repo.defaultBranch;
    updateJob(jobId, {
      clonePath,
      stage: "Cloning repository into sandbox",
    });

    await sandbox.git.clone(
      repo.cloneUrl,
      clonePath,
      sourceBranch,
      undefined,
      repo.ownerLogin,
      githubAccessToken,
    );

    const authenticatedRemoteUrl = await getGithubAuthenticatedRemoteUrl(input.repoId);

    updateJob(jobId, {
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

    updateJob(jobId, {
      stage: "Running OpenCode task",
    });

    const openCodePrompt = buildOpenCodePrompt(input.prompt);
    await runSandboxCommand(
      sandbox,
      jobId,
      `opencode run --model '${escapeForSingleQuotedShell(openCode.model)}' "$(cat <<'EOF'\n${openCodePrompt}\nEOF\n)"`,
      clonePath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model),
      },
      3600,
    );

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
      stage: "Generating branch and pull request metadata",
    });

    const metadata = await generateGitMetadata({
      clonePath,
      defaultBranch: sourceBranch,
      jobId,
      openCodeApiKey: openCode.apiKey,
      openCodeModel: openCode.model,
      repoFullName: repo.fullName,
      sandbox,
      userPrompt: input.prompt,
    });

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
        `git commit -m '${escapeForSingleQuotedShell(metadata.commitTitle)}'`,
        `git push -u origin '${escapeForSingleQuotedShell(metadata.branchName)}'`,
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
    if (sandbox) {
      updateJob(jobId, {
        stage: "Destroying sandbox",
      });

      try {
        await sandbox.stop(120);
      } catch {}

      try {
        await sandbox.delete(120);
      } catch {}
    }

    const current = jobs.get(jobId);

    if (current && current.status !== "failed" && current.status !== "succeeded") {
      updateJob(jobId, {
        completedAt: new Date().toISOString(),
        stage: "Sandbox cleaned up",
        status: "succeeded",
      });
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
    id: jobId,
    prompt,
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
