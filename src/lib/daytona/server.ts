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
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import type { SandboxSession } from "@/lib/sandbox/types";

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

export type FollowUpEntry = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: AgentMessage[];
  stage: string;
  startedAt: string;
  status: RepoTaskJobStatus;
};

export type RepoTaskJob = {
  agentMessages: AgentMessage[];
  branchName?: string;
  clonePath?: string;
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
  status: RepoTaskJobStatus;
};

const jobs = new Map<string, RepoTaskJob>();
const MAX_LOG_LENGTH = 16_000;
const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';
const OPENCODE_INSTALL_COMMAND = [
  SANDBOX_TOOL_PATH_EXPORT,
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
const sandboxProvider = getSandboxProvider();

const readCommandOutput = (value: string) => value.trim();

const normalizeOpenRouterModel = (value: string) => {
  const model = value.trim();

  if (!model) {
    return DEFAULT_OPENCODE_MODEL;
  }

  if (model.startsWith("openrouter/")) {
    return model;
  }

  return `openrouter/${model}`;
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
  /\b(frontend|ui|ux|browser|screenshot|screen shot|visual|css|tailwind|layout|responsive|component|shadcn|page|modal|dialog|dropdown|form|button|input|navbar|sidebar|header|footer|computer use|computer-use|desktop|gui|click|type|typing|keyboard|mouse|preview|daytona mcp|use daytona|daytona tool|sandbox browser|open the browser|open browser|checkout the file|check out the file)\b/i;

const isFrontendTaskPrompt = (prompt: string) => FRONTEND_TASK_PATTERN.test(prompt);

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

const buildOpenCodePrompt = (
  userPrompt: string,
  options?: {
    enableDaytonaTools?: boolean;
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
    ...(options?.enableDaytonaTools
      ? [
          "",
          "Frontend validation instructions:",
          "Use the Daytona custom tools for preview, browser automation, screenshots, and computer use when the task touches frontend behavior.",
          "If the user explicitly asks for computer use, the desktop, the browser, screenshots, clicking, typing, preview links, or similar interactive actions, you must use the Daytona custom tools instead of relying only on shell inspection.",
          options.sandboxId
            ? `The current Daytona sandbox id is ${options.sandboxId}. Reuse this sandbox for Daytona custom tools instead of creating a different one unless the task requires it.`
            : "Use the current sandbox for preview and computer-use actions whenever possible.",
          "Key tools available include daytona_preview, daytona_open_preview, daytona_open_url, daytona_display_info, daytona_display_windows, daytona_screenshot, daytona_mouse_click, daytona_mouse_drag, daytona_mouse_move, daytona_mouse_scroll, daytona_keyboard_type, daytona_keyboard_press, and daytona_keyboard_hotkey.",
          "If you need to verify UI behavior, start the app server, expose the right port with daytona_open_preview or daytona_preview, interact through Daytona computer use, and capture screenshots before finishing.",
        ]
      : []),
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

const buildOpenCodeConfigContent = (
  model: string,
  options?: {
    enableDaytonaTools?: boolean;
  },
) => {
  const providerScopedModelId = getProviderScopedModelId(model);

  const config: Record<string, unknown> = {
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
  };

  if (options?.enableDaytonaTools) {
    config.tools = {
      "daytona_*": false,
    };
    config.agent = {
      frontend: {
        tools: {
          "daytona_*": true,
        },
      },
    };
  }

  return JSON.stringify(config);
};

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

const buildOpenCodeRunCommand = (
  model: string,
  prompt: string,
  options?: {
    agent?: string;
  },
) =>
  [
    SANDBOX_TOOL_PATH_EXPORT,
    `opencode run --format json --model '${escapeForSingleQuotedShell(model)}'${options?.agent ? ` --agent '${escapeForSingleQuotedShell(options.agent)}'` : ""} "$(cat <<'EOF'\n${prompt}\nEOF\n)"`,
  ].join("\n");

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
    clonePath: undefined,
    sandboxId: undefined,
    sandboxName: undefined,
    stage: options?.stage ?? "Sandbox stopped",
  });
};

const prepareSandboxWorkspace = async ({
  branch,
  enableDaytonaTools,
  githubAccessToken,
  jobId,
  repoId,
  repoName,
  repoOwnerLogin,
  repoUrl,
  viewer,
}: {
  branch: string;
  enableDaytonaTools: boolean;
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
  const clonePath = `${workDir.replace(/\/$/, "")}/${repoName}`;

  updateJob(jobId, {
    clonePath,
    stage: "Cloning repository into sandbox",
  });

  await sandbox.cloneRepository({
    accessToken: githubAccessToken,
    branch,
    ownerLogin: repoOwnerLogin,
    targetPath: clonePath,
    url: repoUrl,
  });

  const authenticatedRemoteUrl = await getGithubAuthenticatedRemoteUrl(repoId);
  const setupCommands = [
    `git remote set-url origin '${escapeForSingleQuotedShell(authenticatedRemoteUrl)}'`,
    `git config user.name '${escapeForSingleQuotedShell(viewer.name)}'`,
    `git config user.email '${escapeForSingleQuotedShell(viewer.email)}'`,
    OPENCODE_INSTALL_COMMAND,
  ];

  if (enableDaytonaTools) {
    setupCommands.push(buildDaytonaCustomToolSetupCommand());
  }

  updateJob(jobId, {
    clonePath,
    stage: "Preparing git branch and OpenCode runtime",
  });

  await runSandboxCommand(
    sandbox,
    jobId,
    setupCommands.join("\n"),
    clonePath,
    enableDaytonaTools
      ? {
          DAYTONA_API_KEY: env.DAYTONA_API_KEY || "",
          ...(env.DAYTONA_API_URL ? { DAYTONA_API_URL: env.DAYTONA_API_URL } : {}),
          ...(env.DAYTONA_TARGET ? { DAYTONA_TARGET: env.DAYTONA_TARGET } : {}),
        }
      : undefined,
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
  enableDaytonaTools,
  followUpId,
  followUpTarget,
  githubAccessToken,
  job,
  viewer,
}: {
  enableDaytonaTools: boolean;
  followUpId: string;
  followUpTarget: Awaited<ReturnType<typeof getFollowUpBranch>>;
  githubAccessToken: string;
  job: RepoTaskJob;
  viewer: Awaited<ReturnType<typeof getSignedInGithubViewer>>;
}) => {
  if (job.sandboxId && job.clonePath) {
    try {
      return {
        clonePath: job.clonePath,
        sandbox: await sandboxProvider.getWorkspace(job.sandboxId),
      };
    } catch {}
  }

  markFollowUpRecreation(job.id, followUpId);

  const prepared = await prepareSandboxWorkspace({
    branch: followUpTarget.branch,
    enableDaytonaTools,
    githubAccessToken,
    jobId: job.id,
    repoId: job.repoId,
    repoName: followUpTarget.repo.name,
    repoOwnerLogin: followUpTarget.repo.ownerLogin,
    repoUrl: followUpTarget.repo.cloneUrl,
    viewer,
  });

  return {
    clonePath: prepared.clonePath,
    sandbox: prepared.sandbox,
  };
};

const runRepoTaskJob = async (jobId: string, input: RepoTaskInput) => {
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
    const enableDaytonaTools = isFrontendTaskPrompt(input.prompt);
    const prepared = await prepareSandboxWorkspace({
      branch: sourceBranch,
      enableDaytonaTools,
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

    const openCodePrompt = buildOpenCodePrompt(input.prompt, {
      enableDaytonaTools,
      sandboxId: sandbox.id,
    });
    const openCodeResponse = await runSandboxCommand(
      sandbox,
      jobId,
      buildOpenCodeRunCommand(openCode.model, openCodePrompt, {
        agent: enableDaytonaTools ? "frontend" : undefined,
      }),
      clonePath,
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
    );

    parseOpenCodeJsonOutput(jobId, openCodeResponse.output);

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

    if (!readCommandOutput(changeCheck.output)) {
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
        changedFiles: changedFilesResult.output,
        diffSummary: diffSummaryResult.output,
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
  const sourceBranch = input.sourceBranch.trim() || repo.defaultBranch;
  const job: RepoTaskJob = {
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

export const destroySandboxById = async (sandboxId: string) => {
  try {
    await sandboxProvider.destroyWorkspace(sandboxId);
  } catch {}
};

export const runFollowUpOnSandbox = async (jobId: string, prompt: string, userId?: string) => {
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
    const [viewer, githubAccessToken, followUpTarget] = await Promise.all([
      getSignedInGithubViewer(),
      getSignedInGithubAccessToken(),
      getFollowUpBranch(job.repoId, job.branchName),
    ]);
    const { clonePath, sandbox } = await getOrCreateFollowUpWorkspace({
      enableDaytonaTools,
      followUpId,
      followUpTarget,
      githubAccessToken,
      job,
      viewer,
    });

    if (!clonePath) {
      throw new Error("No sandbox workspace available for follow-up.");
    }

    if (enableDaytonaTools) {
      updateJob(jobId, {
        stage: "Preparing Daytona custom tools",
      });
      updateFollowUpEntry(jobId, followUpId, (entry) => ({
        ...entry,
        stage: "Preparing Daytona custom tools",
      }));

      await runSandboxCommand(
        sandbox,
        jobId,
        buildDaytonaCustomToolSetupCommand(),
        clonePath,
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
    updateFollowUpEntry(jobId, followUpId, (entry) => ({
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
      clonePath,
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
