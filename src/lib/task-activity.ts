const getStringArg = (args: unknown, keys: string[]) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return "";
  }

  const record = args as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }

  return "";
};

const shorten = (value: string, maxLength = 56) =>
  value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

export const formatTaskStage = (stage: string) => {
  const normalized = stage.trim().toLowerCase();

  if (/sandbox/.test(normalized) && /creat|getting|recreat/.test(normalized)) {
    return "Preparing sandbox";
  }
  if (/resolv.*sandbox/.test(normalized)) return "Resolving sandbox workspace";
  if (/clon.*repositor/.test(normalized)) return "Cloning repository";
  if (/git branch|agent runtime/.test(normalized)) return "Configuring agent workspace";
  if (/sync.*(project|config|environment|skill)/.test(normalized)) {
    return "Syncing project configuration";
  }
  if (/start.*agent/.test(normalized)) return "Starting agent";
  if (/running|agent is working|opencode task/.test(normalized)) return "Agent is working";
  if (/review.*result/.test(normalized)) return "Reviewing agent results";
  if (/handoff|pull request|finaliz/.test(normalized)) return "Preparing task handoff";

  return stage.trim() || "Working on task";
};

export const formatToolActivity = (payload: Record<string, unknown>) => {
  const tool = typeof payload.tool === "string" ? payload.tool.toLowerCase() : "";
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const args = payload.args;
  const filePath = getStringArg(args, ["filePath", "filepath", "path", "file", "target"]);

  if (/read|view/.test(tool)) {
    return filePath ? `Reading ${shorten(filePath)}` : title || "Reading project files";
  }
  if (/grep|search/.test(tool)) return title || "Searching the codebase";
  if (/glob|list/.test(tool)) return title || "Finding relevant files";
  if (/edit|patch|write/.test(tool)) {
    return filePath ? `Editing ${shorten(filePath)}` : title || "Editing the implementation";
  }
  if (/bash|shell|terminal|command/.test(tool)) {
    const command = getStringArg(args, ["command", "cmd"]).toLowerCase();
    if (/\b(lint|eslint|oxlint)\b/.test(command)) return "Running lint checks";
    if (/\b(test|vitest|jest|playwright)\b/.test(command)) return "Running tests";
    if (/\bbuild\b/.test(command)) return "Building the project";
    if (/git\s+status/.test(command)) return "Checking repository changes";
    if (/git\s+diff/.test(command)) return "Reviewing code changes";
    if (/(npm|pnpm|yarn|bun)\s+(install|add)/.test(command)) return "Installing dependencies";
    return title || "Running a project command";
  }
  if (/browser/.test(tool)) return title || "Inspecting the app in the browser";
  if (/spawn|task/.test(tool)) return title || "Delegating a sub-task";
  if (/git|github/.test(tool)) return title || "Updating repository changes";

  return title || (tool ? `Using ${tool}` : "Working on the task");
};
