import "@tanstack/react-start/server-only";
import { getSignedInGithubRepo } from "@/lib/github/server";
import { ensureOpenCodeConfig } from "@/lib/opencode/config";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { SandboxRun } from "@/lib/sandbox/run";
import { jobs, requireJob, updateJob } from "@/lib/sandbox/state";
import type { SandboxTaskInput, SandboxTaskJob } from "@/lib/sandbox/task";
const sandboxProvider = getSandboxProvider();
const makeJobId = () => `tk-${crypto.randomUUID()}`;
const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

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
) => SandboxRun.destroy(jobId, sandboxProvider, options?.stage, options?.userId);

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
    void SandboxRun.task(
      jobId,
      {
        prompt,
        quickTask: input.quickTask,
        repoId: input.repoId,
        sourceBranch: input.sourceBranch,
      },
      sandboxProvider,
      buildDaytonaCustomToolSetupCommand(),
    );
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
  return SandboxRun.followUp(
    jobId,
    prompt,
    sandboxProvider,
    buildDaytonaCustomToolSetupCommand(),
    userId,
  );
};
