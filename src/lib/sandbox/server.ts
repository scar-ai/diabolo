import "@tanstack/react-start/server-only";
import { env } from "@/env/server";
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
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { buildOpenCodePrompt, buildOpenCodeRunCommand } from "@/lib/sandbox/opencode";
import {
  appendAgentMessage,
  appendFollowUpAgentMessage,
  appendFollowUpLog,
  appendJobLog,
  jobs,
  requireJob,
  updateFollowUp,
  updateJob,
} from "@/lib/sandbox/state";
import {
  isFrontendTaskPrompt,
  type SandboxTaskInput,
  type SandboxTaskJob,
} from "@/lib/sandbox/task";
import type { SandboxSession } from "@/lib/sandbox/types";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";
const sandboxProvider = getSandboxProvider();

const readCommandOutput = (value: string) => value.trim();
const makeJobId = () => `tk-${crypto.randomUUID()}`;
const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';
const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

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

const buildDaytonaCustomToolContent = () =>
  String.raw`import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Daytona } from "@daytonaio/sdk";
import { z } from "zod";

const json = (value: unknown) => JSON.stringify(value, null, 2);

const requireEnv = (envName: string) => {
  const value = process.env[envName]?.trim();

  if (!value) {
    throw new Error(envName + " is not configured for Daytona custom tools.");
  }

  return value;
};

const resolveSandboxId = (value?: string) => {
  const sandboxId = value?.trim() || process.env.DAYTONA_SANDBOX_ID?.trim();

  if (!sandboxId) {
    throw new Error("No Daytona sandbox id was provided.");
  }

  return sandboxId;
};

const getClient = () =>
  new Daytona({
    apiKey: requireEnv("DAYTONA_API_KEY"),
    apiUrl: process.env.DAYTONA_API_URL?.trim() || undefined,
    target: process.env.DAYTONA_TARGET?.trim() || undefined,
  });

const getSandbox = async (sandboxId?: string) => {
  return getClient().get(resolveSandboxId(sandboxId));
};

const quoteShellArg = (value: string) => "'" + value.replaceAll("'", "'\\\\''") + "'";

const normalizeScreenshotExtension = (format?: string) => {
  const normalized = format?.trim().toLowerCase();

  if (!normalized) {
    return "png";
  }

  if (normalized === "jpg") {
    return "jpeg";
  }

  return normalized;
};

const maybePersistScreenshot = async (
  screenshot: Record<string, unknown>,
  context: { directory?: string; worktree?: string },
  format?: string,
) => {
  const worktree = context.worktree || context.directory;

  if (!worktree) {
    return {
      filePath: null,
      screenshot,
    };
  }

  let imageKey: string | undefined;
  let imageValue: string | undefined;

  for (const [key, value] of Object.entries(screenshot)) {
    if (typeof value === "string" && value.length > 1_000) {
      imageKey = key;
      imageValue = value;
      break;
    }
  }

  if (!imageKey || !imageValue) {
    return {
      filePath: null,
      screenshot,
    };
  }

  const artifactDir = path.join(worktree, ".opencode", "artifacts");
  await mkdir(artifactDir, { recursive: true });

  let base64Payload = imageValue;
  let extension = normalizeScreenshotExtension(format);
  const dataUrlMatch = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageValue);

  if (dataUrlMatch) {
    extension = normalizeScreenshotExtension(dataUrlMatch[1]);
    base64Payload = dataUrlMatch[2];
  }

  const filePath = path.join(artifactDir, "daytona-screenshot-" + Date.now() + "." + extension);
  await writeFile(filePath, Buffer.from(base64Payload, "base64"));

  return {
    filePath,
    screenshot: {
      ...screenshot,
      [imageKey]: "saved:" + filePath,
    },
  };
};

const ensureComputerUse = async (sandboxId?: string) => {
  const sandbox = await getSandbox(sandboxId);
  const status = await sandbox.computerUse.getStatus().catch(() => null);

  if (status?.status !== "running") {
    await sandbox.computerUse.start();
  }

  return sandbox;
};

const sandboxIdArg = z
  .string()
  .optional()
  .describe("Optional Daytona sandbox id. Defaults to the current task sandbox.");

const screenRegionArgs = {
  height: z.number().int().positive().optional().describe("Region height in pixels."),
  width: z.number().int().positive().optional().describe("Region width in pixels."),
  x: z.number().int().nonnegative().optional().describe("Left coordinate in pixels."),
  y: z.number().int().nonnegative().optional().describe("Top coordinate in pixels."),
};

export const preview = {
  description: "Get the Daytona preview URL for a port in the current sandbox.",
  args: {
    port: z.number().int().positive().describe("Sandbox port to expose."),
    sandboxId: sandboxIdArg,
  },
  async execute(args: { port: number; sandboxId?: string }) {
    const sandbox = await getSandbox(args.sandboxId);
    return json(await sandbox.getPreviewLink(args.port));
  },
};

export const open_preview = {
  description: "Open a Daytona preview URL in the sandbox desktop browser.",
  args: {
    port: z.number().int().positive().describe("Sandbox port to expose and open."),
    sandboxId: sandboxIdArg,
  },
  async execute(args: { port: number; sandboxId?: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    const preview = await sandbox.getPreviewLink(args.port);
    await sandbox.process.executeCommand("xdg-open " + quoteShellArg(preview.url), undefined, undefined, 60);
    return json(preview);
  },
};

export const open_url = {
  description: "Open a URL in the sandbox desktop browser.",
  args: {
    sandboxId: sandboxIdArg,
    url: z.string().url().describe("URL to open in the sandbox browser."),
  },
  async execute(args: { sandboxId?: string; url: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    await sandbox.process.executeCommand("xdg-open " + quoteShellArg(args.url), undefined, undefined, 60);
    return json({ opened: args.url });
  },
};

export const computer_start = {
  description: "Start Daytona computer-use services for the current sandbox.",
  args: {
    sandboxId: sandboxIdArg,
  },
  async execute(args: { sandboxId?: string }) {
    const sandbox = await getSandbox(args.sandboxId);
    return json(await sandbox.computerUse.start());
  },
};

export const computer_status = {
  description: "Get Daytona computer-use process status for the current sandbox.",
  args: {
    sandboxId: sandboxIdArg,
  },
  async execute(args: { sandboxId?: string }) {
    const sandbox = await getSandbox(args.sandboxId);
    return json(await sandbox.computerUse.getStatus());
  },
};

export const display_info = {
  description: "Get display information for the sandbox desktop.",
  args: {
    sandboxId: sandboxIdArg,
  },
  async execute(args: { sandboxId?: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    return json(await sandbox.computerUse.display.getInfo());
  },
};

export const display_windows = {
  description: "List currently open windows in the sandbox desktop.",
  args: {
    sandboxId: sandboxIdArg,
  },
  async execute(args: { sandboxId?: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    return json(await sandbox.computerUse.display.getWindows());
  },
};

export const screenshot = {
  description: "Capture a Daytona computer-use screenshot and save it under .opencode/artifacts.",
  args: {
    format: z.enum(["png", "jpeg", "webp"]).optional().describe("Optional screenshot format."),
    quality: z.number().int().min(1).max(100).optional().describe("Compression quality when supported."),
    sandboxId: sandboxIdArg,
    scale: z.number().positive().optional().describe("Optional screenshot scaling factor."),
    showCursor: z.boolean().optional().describe("Whether to show the mouse cursor."),
    ...screenRegionArgs,
  },
  async execute(
    args: {
      format?: "jpeg" | "png" | "webp";
      height?: number;
      quality?: number;
      sandboxId?: string;
      scale?: number;
      showCursor?: boolean;
      width?: number;
      x?: number;
      y?: number;
    },
    context: { directory?: string; worktree?: string },
  ) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    const hasRegion =
      typeof args.x === "number" &&
      typeof args.y === "number" &&
      typeof args.width === "number" &&
      typeof args.height === "number";

    const screenshot = hasRegion
      ? args.format || args.quality || args.scale || args.showCursor
        ? await sandbox.computerUse.screenshot.takeCompressedRegion(
            {
              height: args.height,
              width: args.width,
              x: args.x,
              y: args.y,
            },
            {
              format: args.format,
              quality: args.quality,
              scale: args.scale,
              showCursor: args.showCursor,
            },
          )
        : await sandbox.computerUse.screenshot.takeRegion(
            {
              height: args.height,
              width: args.width,
              x: args.x,
              y: args.y,
            },
            args.showCursor,
          )
      : args.format || args.quality || args.scale || args.showCursor
        ? await sandbox.computerUse.screenshot.takeCompressed({
            format: args.format,
            quality: args.quality,
            scale: args.scale,
            showCursor: args.showCursor,
          })
        : await sandbox.computerUse.screenshot.takeFullScreen(args.showCursor);

    const persisted = await maybePersistScreenshot(
      screenshot as Record<string, unknown>,
      context,
      args.format,
    );

    return json({
      filePath: persisted.filePath,
      screenshot: persisted.screenshot,
    });
  },
};

export const mouse_move = {
  description: "Move the mouse cursor in the sandbox desktop.",
  args: {
    sandboxId: sandboxIdArg,
    x: z.number().int().nonnegative().describe("Destination x coordinate."),
    y: z.number().int().nonnegative().describe("Destination y coordinate."),
  },
  async execute(args: { sandboxId?: string; x: number; y: number }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    return json(await sandbox.computerUse.mouse.move(args.x, args.y));
  },
};

export const mouse_click = {
  description: "Click in the sandbox desktop at specific coordinates.",
  args: {
    button: z.enum(["left", "middle", "right"]).optional().describe("Mouse button to use."),
    double: z.boolean().optional().describe("Whether to double-click."),
    sandboxId: sandboxIdArg,
    x: z.number().int().nonnegative().describe("Click x coordinate."),
    y: z.number().int().nonnegative().describe("Click y coordinate."),
  },
  async execute(
    args: {
      button?: "left" | "middle" | "right";
      double?: boolean;
      sandboxId?: string;
      x: number;
      y: number;
    },
  ) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    return json(
      await sandbox.computerUse.mouse.click(args.x, args.y, args.button, args.double),
    );
  },
};

export const mouse_drag = {
  description: "Drag the mouse in the sandbox desktop.",
  args: {
    button: z.enum(["left", "middle", "right"]).optional().describe("Mouse button to hold."),
    endX: z.number().int().nonnegative().describe("Ending x coordinate."),
    endY: z.number().int().nonnegative().describe("Ending y coordinate."),
    sandboxId: sandboxIdArg,
    startX: z.number().int().nonnegative().describe("Starting x coordinate."),
    startY: z.number().int().nonnegative().describe("Starting y coordinate."),
  },
  async execute(
    args: {
      button?: "left" | "middle" | "right";
      endX: number;
      endY: number;
      sandboxId?: string;
      startX: number;
      startY: number;
    },
  ) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    return json(
      await sandbox.computerUse.mouse.drag(
        args.startX,
        args.startY,
        args.endX,
        args.endY,
        args.button,
      ),
    );
  },
};

export const mouse_scroll = {
  description: "Scroll the mouse wheel in the sandbox desktop.",
  args: {
    amount: z.number().int().positive().optional().describe("Scroll amount."),
    direction: z.enum(["down", "up"]).describe("Scroll direction."),
    sandboxId: sandboxIdArg,
    x: z.number().int().nonnegative().describe("Scroll x coordinate."),
    y: z.number().int().nonnegative().describe("Scroll y coordinate."),
  },
  async execute(
    args: {
      amount?: number;
      direction: "down" | "up";
      sandboxId?: string;
      x: number;
      y: number;
    },
  ) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    return json(
      await sandbox.computerUse.mouse.scroll(args.x, args.y, args.direction, args.amount),
    );
  },
};

export const keyboard_type = {
  description: "Type text in the sandbox desktop.",
  args: {
    delay: z.number().int().nonnegative().optional().describe("Delay between characters in milliseconds."),
    sandboxId: sandboxIdArg,
    text: z.string().describe("Text to type."),
  },
  async execute(args: { delay?: number; sandboxId?: string; text: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    await sandbox.computerUse.keyboard.type(args.text, args.delay);
    return json({ typed: args.text.length });
  },
};

export const keyboard_press = {
  description: "Press a key with optional modifiers in the sandbox desktop.",
  args: {
    key: z.string().describe("Key to press."),
    modifiers: z.array(z.string()).optional().describe("Optional modifier keys."),
    sandboxId: sandboxIdArg,
  },
  async execute(args: { key: string; modifiers?: string[]; sandboxId?: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    await sandbox.computerUse.keyboard.press(args.key, args.modifiers);
    return json({ key: args.key, modifiers: args.modifiers || [] });
  },
};

export const keyboard_hotkey = {
  description: "Press a hotkey combination in the sandbox desktop.",
  args: {
    keys: z.string().describe("Hotkey string such as ctrl+l or alt+tab."),
    sandboxId: sandboxIdArg,
  },
  async execute(args: { keys: string; sandboxId?: string }) {
    const sandbox = await ensureComputerUse(args.sandboxId);
    await sandbox.computerUse.keyboard.hotkey(args.keys);
    return json({ keys: args.keys });
  },
};`;

const buildDaytonaCustomToolSetupCommand = () => {
  const toolContent = buildDaytonaCustomToolContent();
  const packageJson = JSON.stringify({
    name: "daytona-opencode-tools",
    private: true,
    type: "module",
  });

  return [
    SANDBOX_TOOL_PATH_EXPORT,
    "mkdir -p .opencode/tools .opencode/artifacts",
    `cat <<'EOF' > .opencode/package.json\n${packageJson}\nEOF`,
    "npm install --prefix .opencode --no-save @daytonaio/sdk zod",
    "mkdir -p .git/info",
    "touch .git/info/exclude",
    "if ! grep -qxF '.opencode/' .git/info/exclude; then printf '\\n.opencode/\\n' >> .git/info/exclude; fi",
    `cat <<'EOF' > .opencode/tools/daytona.ts\n${toolContent}\nEOF`,
  ].join("\n");
};

const destroySandboxResources = async (
  jobId: string,
  options?: {
    stage?: string;
    userId?: string;
  },
) =>
  SandboxWorkspace.destroy(sandboxProvider, requireJob(jobId, options?.userId), updateJob, {
    stage: options?.stage,
  });

const runSandboxTaskJob = async (jobId: string, input: SandboxTaskInput) => {
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
    const enableDaytonaTools = isFrontendTaskPrompt(input.prompt);
    const prepared = await SandboxWorkspace.prepare({
      authenticatedRemoteUrl: await getGithubAuthenticatedRemoteUrl(input.repoId),
      branch: sourceBranch,
      daytonaEnv: {
        DAYTONA_API_KEY: env.DAYTONA_API_KEY || "",
        ...(env.DAYTONA_API_URL ? { DAYTONA_API_URL: env.DAYTONA_API_URL } : {}),
        ...(env.DAYTONA_TARGET ? { DAYTONA_TARGET: env.DAYTONA_TARGET } : {}),
      },
      enableDaytonaTools,
      githubAccessToken,
      jobId,
      provider: sandboxProvider,
      repoName: repo.name,
      repoOwnerLogin: repo.ownerLogin,
      repoUrl: repo.cloneUrl,
      run: runSandboxCommand,
      setupTools: enableDaytonaTools ? buildDaytonaCustomToolSetupCommand() : undefined,
      update: updateJob,
      viewer,
    });
    const activeSandbox = prepared.sandbox;
    const sandboxPath = prepared.sandboxPath;

    updateJob(jobId, {
      stage: "Running OpenCode task",
    });

    const openCodePrompt = buildOpenCodePrompt(input.prompt, {
      enableDaytonaTools,
      sandboxId: activeSandbox.id,
    });
    const openCodeResponse = await runSandboxCommand(
      activeSandbox,
      jobId,
      buildOpenCodeRunCommand(openCode.model, openCodePrompt, {
        agent: enableDaytonaTools ? "frontend" : undefined,
      }),
      sandboxPath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model, {
          enableDaytonaTools,
        }),
        ...(enableDaytonaTools
          ? {
              DAYTONA_API_KEY: env.DAYTONA_API_KEY || "",
              DAYTONA_SANDBOX_ID: activeSandbox.id,
              ...(env.DAYTONA_API_URL ? { DAYTONA_API_URL: env.DAYTONA_API_URL } : {}),
              ...(env.DAYTONA_TARGET ? { DAYTONA_TARGET: env.DAYTONA_TARGET } : {}),
            }
          : {}),
      },
      3600,
    );

    parseOpenCodeJsonOutput(jobId, openCodeResponse.output);

    updateJob(jobId, {
      stage: "Checking generated changes",
    });

    const changeCheck = await runSandboxCommand(
      activeSandbox,
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
      runSandboxCommand(
        activeSandbox,
        jobId,
        "git diff --stat --summary",
        sandboxPath,
        undefined,
        60,
      ),
      runSandboxCommand(activeSandbox, jobId, "git status --short", sandboxPath, undefined, 60),
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
      activeSandbox,
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
  const enableDaytonaTools = isFrontendTaskPrompt(trimmedPrompt);
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
    const [viewer, githubAccessToken, repo, authenticatedRemoteUrl] = await Promise.all([
      getSignedInGithubViewer(),
      getSignedInGithubAccessToken(),
      getSignedInGithubRepo(job.repoId),
      getGithubAuthenticatedRemoteUrl(job.repoId),
    ]);

    if (!repo) {
      throw new Error("Unknown repository selection.");
    }

    const { sandbox, sandboxPath } = await SandboxWorkspace.getOrCreateFollowUp({
      authenticatedRemoteUrl,
      daytonaEnv: {
        DAYTONA_API_KEY: env.DAYTONA_API_KEY || "",
        ...(env.DAYTONA_API_URL ? { DAYTONA_API_URL: env.DAYTONA_API_URL } : {}),
        ...(env.DAYTONA_TARGET ? { DAYTONA_TARGET: env.DAYTONA_TARGET } : {}),
      },
      enableDaytonaTools,
      followUpId,
      githubAccessToken,
      job,
      provider: sandboxProvider,
      repo,
      run: runSandboxCommand,
      setupTools: enableDaytonaTools ? buildDaytonaCustomToolSetupCommand() : undefined,
      update: updateJob,
      updateFollowUp,
      viewer,
    });

    if (!sandboxPath) {
      throw new Error("No sandbox workspace available for follow-up.");
    }

    if (enableDaytonaTools) {
      updateJob(jobId, {
        stage: "Preparing Daytona custom tools",
      });
      updateFollowUp(jobId, followUpId, (entry) => ({
        ...entry,
        stage: "Preparing Daytona custom tools",
      }));

      await runSandboxCommand(
        sandbox,
        jobId,
        buildDaytonaCustomToolSetupCommand(),
        sandboxPath,
        {
          DAYTONA_API_KEY: env.DAYTONA_API_KEY || "",
          ...(env.DAYTONA_API_URL ? { DAYTONA_API_URL: env.DAYTONA_API_URL } : {}),
          ...(env.DAYTONA_TARGET ? { DAYTONA_TARGET: env.DAYTONA_TARGET } : {}),
        },
        900,
        { followUpId },
      );
    }

    updateJob(jobId, {
      stage: "Running follow-up task",
    });
    updateFollowUp(jobId, followUpId, (entry) => ({
      ...entry,
      stage: "Running follow-up task",
    }));

    const openCodePrompt = buildOpenCodePrompt(prompt, {
      enableDaytonaTools,
      sandboxId: sandbox.id,
    });
    const followUpResponse = await runSandboxCommand(
      sandbox,
      jobId,
      buildOpenCodeRunCommand(openCode.model, openCodePrompt, {
        agent: enableDaytonaTools ? "frontend" : undefined,
      }),
      sandboxPath,
      {
        OPENROUTER_API_KEY: openCode.apiKey,
        OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(openCode.model, {
          enableDaytonaTools,
        }),
        ...(enableDaytonaTools
          ? {
              DAYTONA_API_KEY: env.DAYTONA_API_KEY || "",
              DAYTONA_SANDBOX_ID: sandbox.id,
              ...(env.DAYTONA_API_URL ? { DAYTONA_API_URL: env.DAYTONA_API_URL } : {}),
              ...(env.DAYTONA_TARGET ? { DAYTONA_TARGET: env.DAYTONA_TARGET } : {}),
            }
          : {}),
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
    updateFollowUp(jobId, followUpId, (entry) => ({
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
    updateFollowUp(jobId, followUpId, (entry) => ({
      ...entry,
      completedAt: new Date().toISOString(),
      error: sandboxProvider.formatError(error),
      stage: "Follow-up failed",
      status: "failed",
    }));
  }
};
