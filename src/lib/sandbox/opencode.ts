import {
  buildStagehandOpenCodeExports,
  buildStagehandOpenCodeSetupCommand,
} from "@/lib/opencode/stagehand";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  "if ! command -v opencode >/dev/null 2>&1; then npm install -g opencode-ai; fi",
  "opencode --version",
].join("\n");

export const buildOpenCodePrompt = (
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

export const buildOpenCodeRunCommand = (
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
