import { buildAgentBrowserOpenCodeSetupCommand } from "@/lib/opencode/agent-browser";
import { OPENCODE_VERSION } from "@/lib/opencode/constants";
import { buildGitToolsOpenCodeSetupCommand } from "@/lib/opencode/git-tools";
import { buildSpawnTaskOpenCodeSetupCommand } from "@/lib/opencode/spawn-task";

const SANDBOX_TOOL_PATH_EXPORT =
  'export PATH="$HOME/.local/bin:$HOME/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:$(npm config get prefix)/bin:$PATH"';

export const opencodeInstallCommand = [
  SANDBOX_TOOL_PATH_EXPORT,
  'if ! command -v opencode >/dev/null 2>&1; then echo "OpenCode is missing from the Daytona browser snapshot." >&2; exit 1; fi',
  `if [ "$(opencode --version)" != "${OPENCODE_VERSION}" ]; then echo "OpenCode ${OPENCODE_VERSION} is required. Rebuild the Daytona browser snapshot with pnpm daytona:snapshot." >&2; exit 1; fi`,
  buildAgentBrowserOpenCodeSetupCommand(),
  buildGitToolsOpenCodeSetupCommand(),
  buildSpawnTaskOpenCodeSetupCommand(),
].join("\n");
