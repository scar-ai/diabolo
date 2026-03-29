import { buildAgentBrowserOpenCodeSetupCommand } from "@/lib/opencode/agent-browser";
import { buildGitToolsOpenCodeSetupCommand } from "@/lib/opencode/git-tools";
import { buildSpawnTaskOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

const writeGeneratedConfigCommand = [
  "python3 - <<'PY'",
  "import base64",
  "import os",
  "import pathlib",
  "",
  "target = pathlib.Path(os.getcwd()).parent / '.opencode.generated.json'",
  "target.write_text(base64.b64decode(os.environ['OPENCODE_CONFIG_CONTENT_B64']).decode('utf-8'))",
  "PY",
].join("\n");

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  'if ! command -v opencode >/dev/null 2>&1; then echo "OpenCode is missing from the Daytona browser snapshot." >&2; exit 1; fi',
  "opencode --version",
  buildAgentBrowserOpenCodeSetupCommand(),
  buildSpawnTaskOpenCodeSetupCommand(),
  buildGitToolsOpenCodeSetupCommand(),
].join("\n");

export const buildOpenCodePrompt = (
  userPrompt: string,
  options?: {
    envVarKeys?: string[];
    sandboxId?: string;
  },
) =>
  [
    "You are working inside a cloned GitHub repository.",
    "Complete the user's task fully before you stop.",
    "Inspect the codebase first, make the required changes, and run the relevant verification commands.",
    "Fix any issues you find during verification before finishing.",
    "Custom git tools are available: git_status, git_create_branch, git_checkout_branch, git_stage, git_commit, git_push, git_pull, git_create_pr, and git_delete_branch.",
    "Completion rule: if you changed repository files in a meaningful way, do not finish with only local workspace changes. You must create a branch, stage the relevant files, commit the work, push the branch, and open a pull request before you stop unless the user explicitly asked you not to.",
    "Bias strongly toward opening a PR for real implementation work so the result is handoff-ready without extra user steps.",
    "Do not create a branch, commit, push, or PR if you only inspected the repo, debugged, or ran tests without meaningful code changes.",
    "",
    "Browser validation instructions:",
    "Browser/computer-use tools are always available in this sandbox.",
    "Use the local browser tools for browser automation, screenshots, and interactive verification whenever the task touches frontend behavior or the user asks for computer use.",
    "If the user explicitly asks for the browser, screenshots, clicking, typing, localhost pages, or similar interactive actions, you must use the browser tools instead of relying only on shell inspection.",
    options?.sandboxId
      ? `The current Daytona sandbox id is ${options.sandboxId}. Run browser automation inside this sandbox and keep browser activity local to it.`
      : "Use the current sandbox for local browser actions whenever possible.",
    "Key tools available include open_url, snapshot, click, fill, type, keyboard_type, press, wait, screenshot, evaluate, and close.",
    "Preferred workflow: open the page, take a snapshot to get refs like @e1, interact using those refs, then capture a screenshot before finishing when visual verification matters.",
    "",
    ...(options?.envVarKeys?.length
      ? [
          "Project environment variables:",
          `The following environment variables have been injected into this sandbox by the user: ${options.envVarKeys.join(", ")}.`,
          "They are available as process environment variables and are also written to a .env file at the repository root.",
          "Do not tell the user that no environment variables are defined — they are already present in this sandbox.",
          "",
        ]
      : []),
    "User task:",
    userPrompt.trim(),
  ].join("\n");

export const buildOpenCodeRunCommand = (model: string, prompt: string) =>
  [
    SANDBOX_TOOL_PATH_EXPORT,
    writeGeneratedConfigCommand,
    'export OPENCODE_CONFIG="$PWD/../.opencode.generated.json"',
    `opencode run --format json --model '${escapeForSingleQuotedShell(model)}' "$(cat <<'EOF'\n${prompt}\nEOF\n)"`,
  ].join("\n");
