import { buildSpawnTaskOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  "if ! command -v opencode >/dev/null 2>&1; then npm install -g opencode-ai; fi",
  "opencode --version",
  buildSpawnTaskOpenCodeSetupCommand(),
].join("\n");

export const buildOpenCodePrompt = (
  userPrompt: string,
  options?: {
    enableBrowserTools?: boolean;
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
    ...(options?.enableBrowserTools
      ? [
          "",
          "Browser validation instructions:",
          "Use the local browser tools for browser automation, screenshots, and interactive verification when the task touches frontend behavior.",
          "If the user explicitly asks for computer use, the browser, screenshots, clicking, typing, localhost pages, or similar interactive actions, you must use the browser tools instead of relying only on shell inspection.",
          options.sandboxId
            ? `The current Daytona sandbox id is ${options.sandboxId}. Run browser automation inside this sandbox and keep browser activity local to it.`
            : "Use the current sandbox for local browser actions whenever possible.",
          "Key tools available include browser_open_url, browser_snapshot, browser_click, browser_fill, browser_type, browser_keyboard_type, browser_press, browser_wait, browser_screenshot, browser_evaluate, and browser_close.",
          "Preferred workflow: open the page, take a browser_snapshot to get refs like @e1, interact using those refs, then capture a browser_screenshot before finishing when visual verification matters.",
        ]
      : []),
    "",
    "User task:",
    userPrompt.trim(),
  ].join("\n");

export const buildOpenCodeRunCommand = (
  model: string,
  prompt: string,
  _options?: {
    enableBrowserTools?: boolean;
  },
) =>
  [
    SANDBOX_TOOL_PATH_EXPORT,
    'printf \'%s\' "$OPENCODE_CONFIG_CONTENT" > "$PWD/../.opencode.generated.json"',
    'export OPENCODE_CONFIG="$PWD/../.opencode.generated.json"',
    `opencode run --format json --model '${escapeForSingleQuotedShell(model)}' "$(cat <<'EOF'\n${prompt}\nEOF\n)"`,
  ].join("\n");
