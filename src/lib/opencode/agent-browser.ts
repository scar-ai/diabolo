import "@tanstack/react-start/server-only";

const doubleQuoteForShell = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const writeFileCommand = (targetPath: string, content: string) =>
  [
    `mkdir -p "$(dirname ${doubleQuoteForShell(targetPath)})"`,
    `cat <<'EOF' > ${doubleQuoteForShell(targetPath)}`,
    content,
    "EOF",
  ].join("\n");

const AGENT_BROWSER_PACKAGE_JSON = JSON.stringify(
  {
    name: "diabolo-opencode-browser",
    private: true,
    type: "module",
    dependencies: {
      "@opencode-ai/plugin": "latest",
      "agent-browser": "^0.21.2",
      zod: "^4.3.6",
    },
  },
  null,
  2,
);

const AGENT_BROWSER_TOOL_CONTENT = String.raw`import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tool } from "@opencode-ai/plugin";

const execFileAsync = promisify(execFile);
const TOOL_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(TOOL_DIRECTORY, "..");
const AGENT_BROWSER_BIN = path.join(
  TOOL_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "agent-browser.cmd" : "agent-browser",
);

const toErrorMessage = (error) => (error instanceof Error ? error.message : String(error));
const resolveUrl = (value) => {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value)) {
    return value;
  }

  if (value.startsWith("localhost") || value.startsWith("127.0.0.1")) {
    return "http://" + value;
  }

  return "https://" + value;
};

const sanitizeFileName = (value) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "browser";

const getScreenshotDir = (context) => {
  const baseDir = context.worktree || context.directory || process.cwd();
  const screenshotDir = path.join(baseDir, ".opencode", "artifacts", "browser");

  mkdirSync(screenshotDir, { recursive: true });

  return screenshotDir;
};

const parseJsonOutput = (rawOutput) => {
  if (!rawOutput) {
    return null;
  }

  try {
    return JSON.parse(rawOutput);
  } catch {
    const trimmed = rawOutput.trim();
    const lastBrace = Math.max(trimmed.lastIndexOf("\n{"), trimmed.lastIndexOf("\n["));

    if (lastBrace !== -1) {
      try {
        return JSON.parse(trimmed.slice(lastBrace + 1));
      } catch {}
    }
  }

  return null;
};

const runAgentBrowser = async (args, options = {}) => {
  const finalArgs = options.json ? [...args, "--json"] : [...args];

  try {
    const result = await execFileAsync(AGENT_BROWSER_BIN, finalArgs, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: options.timeoutMs ?? 30000,
    });
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

    if (!options.json) {
      return rawOutput || "ok";
    }

    const payload = parseJsonOutput(rawOutput);

    if (!payload) {
      throw new Error(rawOutput || "agent-browser returned invalid JSON output");
    }

    if (payload.success === false) {
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : rawOutput || "agent-browser command failed",
      );
    }

    return payload.data ?? payload;
  } catch (error) {
    throw new Error(
      "agent-browser " + args.join(" ") + " failed: " + toErrorMessage(error),
    );
  }
};

const getPageState = async () => {
  const [url, title] = await Promise.all([
    runAgentBrowser(["get", "url"], { json: true }),
    runAgentBrowser(["get", "title"], { json: true }),
  ]);

  return {
    title: typeof title === "string" ? title : title?.value || "",
    url: typeof url === "string" ? url : url?.value || "",
  };
};

const snapshotResult = async (interactive = true, compact = false) => {
  const args = ["snapshot"];

  if (interactive) {
    args.push("-i");
  }

  if (compact) {
    args.push("--compact");
  }

  const data = await runAgentBrowser(args, { json: true, timeoutMs: 45000 });

  return JSON.stringify(data, null, 2);
};

export const open_url = tool({
  description:
    "Open a URL in the sandbox-local browser. Returns the current page state after navigation.",
  args: {
    url: tool.schema.string().min(1).describe("URL to open. http:// is assumed for localhost."),
  },
  async execute(args) {
    await runAgentBrowser(["open", resolveUrl(args.url)], {
      json: true,
      timeoutMs: 45000,
    });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const snapshot = tool({
  description:
    "Capture an accessibility snapshot with element refs like @e1 for follow-up browser actions.",
  args: {
    compact: tool.schema
      .boolean()
      .optional()
      .describe("Return a compact snapshot when you only need the essential structure."),
    interactive: tool.schema
      .boolean()
      .optional()
      .describe("Include interactive refs. Defaults to true."),
  },
  async execute(args) {
    return snapshotResult(args.interactive ?? true, args.compact ?? false);
  },
});

export const get_state = tool({
  description: "Get the current browser URL and page title.",
  args: {},
  async execute() {
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const click = tool({
  description: "Click an element by snapshot ref, selector, text selector, or locator.",
  args: {
    target: tool.schema.string().min(1).describe("Element ref like @e2 or any supported selector."),
  },
  async execute(args) {
    await runAgentBrowser(["click", args.target], { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const hover = tool({
  description: "Hover an element by snapshot ref or selector.",
  args: {
    target: tool.schema.string().min(1).describe("Element ref like @e2 or any supported selector."),
  },
  async execute(args) {
    await runAgentBrowser(["hover", args.target], { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const fill = tool({
  description: "Clear and fill a form control by snapshot ref or selector.",
  args: {
    target: tool.schema.string().min(1).describe("Element ref like @e3 or any supported selector."),
    text: tool.schema.string().describe("Text to fill into the element."),
  },
  async execute(args) {
    await runAgentBrowser(["fill", args.target, args.text], { json: true, timeoutMs: 45000 });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const type = tool({
  description: "Type into an element without clearing the existing value first.",
  args: {
    target: tool.schema.string().min(1).describe("Element ref like @e3 or any supported selector."),
    text: tool.schema.string().describe("Text to type."),
  },
  async execute(args) {
    await runAgentBrowser(["type", args.target, args.text], { json: true, timeoutMs: 45000 });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const keyboard_type = tool({
  description: "Type into the currently focused element using real keyboard input.",
  args: {
    text: tool.schema.string().describe("Text to type with keyboard events."),
  },
  async execute(args) {
    await runAgentBrowser(["keyboard", "type", args.text], {
      json: true,
      timeoutMs: 45000,
    });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const press = tool({
  description: "Press a keyboard key like Enter, Tab, Escape, or Control+a.",
  args: {
    key: tool.schema.string().min(1).describe("Keyboard key or chord to press."),
  },
  async execute(args) {
    await runAgentBrowser(["press", args.key], { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const wait = tool({
  description:
    "Wait for time, a selector, text, a URL pattern, a load state, or a JavaScript condition.",
  args: {
    milliseconds: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("Wait a fixed amount of time in milliseconds."),
    selector: tool.schema
      .string()
      .optional()
      .describe("Wait for a selector or snapshot ref to satisfy the requested state."),
    state: tool.schema
      .enum(["attached", "detached", "hidden", "visible"])
      .optional()
      .describe("Selector wait state. Defaults to visible when selector is used."),
    text: tool.schema.string().optional().describe("Wait until text appears on the page."),
    url: tool.schema.string().optional().describe("Wait until the URL matches the supplied pattern."),
    load: tool.schema
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .describe("Wait for a page load state."),
    fn: tool.schema
      .string()
      .optional()
      .describe("Wait until this JavaScript expression evaluates truthy in the page."),
  },
  async execute(args) {
    const conditions = [args.milliseconds, args.selector, args.text, args.url, args.load, args.fn]
      .filter((value) => value !== undefined).length;

    if (conditions !== 1) {
      throw new Error("Provide exactly one wait condition.");
    }

    const command = ["wait"];

    if (typeof args.milliseconds === "number") {
      command.push(String(args.milliseconds));
    } else if (args.selector) {
      command.push(args.selector);

      if (args.state) {
        command.push("--state", args.state);
      }
    } else if (args.text) {
      command.push("--text", args.text);
    } else if (args.url) {
      command.push("--url", args.url);
    } else if (args.load) {
      command.push("--load", args.load);
    } else if (args.fn) {
      command.push("--fn", args.fn);
    }

    await runAgentBrowser(command, { json: true, timeoutMs: 45000 });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const get_text = tool({
  description: "Get text from a target element by snapshot ref or selector.",
  args: {
    target: tool.schema.string().min(1).describe("Element ref like @e1 or any supported selector."),
  },
  async execute(args) {
    const data = await runAgentBrowser(["get", "text", args.target], { json: true });
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  },
});

export const evaluate = tool({
  description: "Run JavaScript in the current page context and return the result.",
  args: {
    script: tool.schema.string().min(1).describe("JavaScript expression or script to evaluate."),
  },
  async execute(args) {
    const data = await runAgentBrowser(["eval", args.script], {
      json: true,
      timeoutMs: 45000,
    });
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  },
});

export const screenshot = tool({
  description: "Capture a browser screenshot and return the saved file path.",
  args: {
    annotate: tool.schema
      .boolean()
      .optional()
      .describe("Add numbered labels to visible elements in the screenshot."),
    fullPage: tool.schema
      .boolean()
      .optional()
      .describe("Capture the full page instead of only the viewport."),
    name: tool.schema
      .string()
      .optional()
      .describe("Optional filename prefix for the screenshot."),
  },
  async execute(args, context) {
    const screenshotDir = getScreenshotDir(context);
    const fileName = sanitizeFileName(args.name || "browser") + "-" + Date.now() + ".png";
    const filePath = path.join(screenshotDir, fileName);
    const command = ["screenshot", filePath];

    if (args.fullPage ?? true) {
      command.push("--full");
    }

    if (args.annotate) {
      command.push("--annotate");
    }

    await runAgentBrowser(command, { json: true, timeoutMs: 45000 });

    return JSON.stringify(
      {
        ...(await getPageState()),
        path: filePath,
      },
      null,
      2,
    );
  },
});

export const mouse_move = tool({
  description: "Move the mouse cursor to absolute page coordinates.",
  args: {
    x: tool.schema.number().describe("Horizontal coordinate in CSS pixels."),
    y: tool.schema.number().describe("Vertical coordinate in CSS pixels."),
  },
  async execute(args) {
    await runAgentBrowser(["mouse", "move", String(args.x), String(args.y)], { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const mouse_down = tool({
  description: "Press and hold a mouse button.",
  args: {
    button: tool.schema
      .enum(["left", "middle", "right"])
      .optional()
      .describe("Mouse button to press. Defaults to left."),
  },
  async execute(args) {
    const command = ["mouse", "down"];

    if (args.button) {
      command.push(args.button);
    }

    await runAgentBrowser(command, { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const mouse_up = tool({
  description: "Release a pressed mouse button.",
  args: {
    button: tool.schema
      .enum(["left", "middle", "right"])
      .optional()
      .describe("Mouse button to release. Defaults to left."),
  },
  async execute(args) {
    const command = ["mouse", "up"];

    if (args.button) {
      command.push(args.button);
    }

    await runAgentBrowser(command, { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const mouse_wheel = tool({
  description: "Scroll the mouse wheel by a vertical and optional horizontal offset.",
  args: {
    dy: tool.schema.number().describe("Vertical wheel delta in CSS pixels."),
    dx: tool.schema.number().optional().describe("Optional horizontal wheel delta."),
  },
  async execute(args) {
    const command = ["mouse", "wheel", String(args.dy)];

    if (typeof args.dx === "number") {
      command.push(String(args.dx));
    }

    await runAgentBrowser(command, { json: true });
    return JSON.stringify(await getPageState(), null, 2);
  },
});

export const close = tool({
  description: "Close the browser session and stop the local agent-browser daemon.",
  args: {},
  async execute() {
    await runAgentBrowser(["close"], { json: true });
    return "Browser session closed.";
  },
});
`;

export const buildAgentBrowserOpenCodeSetupCommand = () =>
  [
    'OPENCODE_BROWSER_ROOT="${OPENCODE_BROWSER_ROOT:-$HOME/.config/opencode}"',
    'OPENCODE_BROWSER_RUNTIME_DIR="${OPENCODE_BROWSER_RUNTIME_DIR:-$HOME/.cache/opencode-agent-browser}"',
    'OPENCODE_BROWSER_READY_MARKER="${OPENCODE_BROWSER_RUNTIME_DIR}/.agent-browser-ready-v2"',
    'mkdir -p "$OPENCODE_BROWSER_ROOT/tools" "$OPENCODE_BROWSER_RUNTIME_DIR"',
    'if ! command -v pnpm >/dev/null 2>&1; then if command -v corepack >/dev/null 2>&1; then pnpm() { corepack pnpm "$@"; }; else npm install -g pnpm --prefix "$HOME/.local"; export PATH="$HOME/.local/bin:$PATH"; fi; fi',
    "pnpm --version",
    writeFileCommand("$OPENCODE_BROWSER_ROOT/package.json", AGENT_BROWSER_PACKAGE_JSON),
    writeFileCommand("$OPENCODE_BROWSER_ROOT/tools/browser.ts", AGENT_BROWSER_TOOL_CONTENT),
    'if [ ! -d "$OPENCODE_BROWSER_ROOT/node_modules/agent-browser" ] || [ ! -d "$OPENCODE_BROWSER_ROOT/node_modules/@opencode-ai/plugin" ] || [ ! -d "$OPENCODE_BROWSER_ROOT/node_modules/zod" ]; then (cd "$OPENCODE_BROWSER_ROOT" && pnpm install --ignore-scripts); fi',
    "ensure_agent_browser_chrome() {",
    "  if command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then",
    "    return 0",
    "  fi",
    "  if command -v apt-get >/dev/null 2>&1; then",
    "    export DEBIAN_FRONTEND=noninteractive",
    "    if command -v sudo >/dev/null 2>&1; then",
    "      sudo -n apt-get update && sudo -n apt-get install -y chromium && return 0",
    "    fi",
    "    apt-get update && apt-get install -y chromium && return 0",
    "  fi",
    "  return 1",
    "}",
    "link_agent_browser_chrome() {",
    '  mkdir -p "$HOME/.local/bin"',
    "  if ! command -v google-chrome >/dev/null 2>&1; then",
    '    if command -v chromium >/dev/null 2>&1; then ln -sf "$(command -v chromium)" "$HOME/.local/bin/google-chrome"; fi',
    '    if command -v chromium-browser >/dev/null 2>&1; then ln -sf "$(command -v chromium-browser)" "$HOME/.local/bin/google-chrome"; fi',
    '    if command -v google-chrome-stable >/dev/null 2>&1; then ln -sf "$(command -v google-chrome-stable)" "$HOME/.local/bin/google-chrome"; fi',
    "  fi",
    "}",
    'if [ ! -f "$OPENCODE_BROWSER_READY_MARKER" ]; then',
    "  ensure_agent_browser_chrome || true",
    "  if command -v google-chrome >/dev/null 2>&1 || command -v google-chrome-stable >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then",
    "    link_agent_browser_chrome",
    '    touch "$OPENCODE_BROWSER_READY_MARKER"',
    "  else",
    '    (cd "$OPENCODE_BROWSER_ROOT" && (pnpm exec agent-browser install --with-deps || pnpm exec agent-browser install)) && touch "$OPENCODE_BROWSER_READY_MARKER"',
    "  fi",
    "fi",
  ].join("\n");
