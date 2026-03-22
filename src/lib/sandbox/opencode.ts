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

export const buildOpenCodeRunCommand = (
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
