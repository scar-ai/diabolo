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

const getToolName = (payload: Record<string, unknown>) =>
  typeof payload.tool === "string" ? payload.tool.toLowerCase() : "";

export const getProgressSummary = (payload: Record<string, unknown>) => {
  if (!/report[-_]?progress/.test(getToolName(payload))) {
    return null;
  }

  const summary = getStringArg(payload.args, ["summary"])
    .replace(/^[-*#\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();

  return summary ? shorten(summary, 180) : null;
};

export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
};

const TODO_STATUSES = new Set<TodoItem["status"]>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

const isTodoTool = (payload: Record<string, unknown>) => /todo/.test(getToolName(payload));

/**
 * The agent's own checklist, read from its most recent `todowrite` call.
 *
 * Each call carries the whole list rather than a delta, so the latest one is
 * always the current state and earlier calls can be ignored entirely.
 */
export const parseTodoItems = (payload: Record<string, unknown>): TodoItem[] | null => {
  if (!isTodoTool(payload)) {
    return null;
  }

  const args = payload.args;
  const rawTodos =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>).todos
      : null;

  if (!Array.isArray(rawTodos)) {
    return null;
  }

  const todos = rawTodos.flatMap((entry): TodoItem[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    const status = record.status;

    if (!content) {
      return [];
    }

    return [
      {
        content,
        status:
          typeof status === "string" && TODO_STATUSES.has(status as TodoItem["status"])
            ? (status as TodoItem["status"])
            : "pending",
      },
    ];
  });

  return todos.length > 0 ? todos : null;
};

type ToolEventLike = { payload: Record<string, unknown>; type: string };

const isToolEvent = (event: ToolEventLike) =>
  event.type === "tool_call" || event.type === "tool_result";

/**
 * The agent's current plan: the todo list from its most recent `todowrite`
 * call. Every call carries the whole list, so the last one wins outright.
 */
export const readLatestTodos = (events: ToolEventLike[]) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (!isToolEvent(event)) {
      continue;
    }

    const todos = parseTodoItems(event.payload);

    if (todos) {
      return todos;
    }
  }

  return null;
};

/**
 * One line describing what the agent is doing now.
 *
 * Prefers the agent's own `report_progress` summary, then falls back to the
 * todo it has marked in progress — without that fallback the panel goes blank
 * whenever a model simply never calls the progress tool.
 */
export const readCurrentFocus = (events: ToolEventLike[]) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (isToolEvent(event)) {
      const summary = getProgressSummary(event.payload);

      if (summary) {
        return summary;
      }
    }
  }

  const activeTodo = readLatestTodos(events)?.find((todo) => todo.status === "in_progress");

  return activeTodo ? activeTodo.content : null;
};

/**
 * The path a tool call wrote to, or `null` for calls that only read. Used to
 * show which files a run has actually touched so far.
 */
export const getWrittenFilePath = (payload: Record<string, unknown>) => {
  // `todowrite` matches on "write" but touches no file, so it is excluded first.
  if (isTodoTool(payload) || !/edit|patch|write|multiedit/.test(getToolName(payload))) {
    return null;
  }

  return getStringArg(payload.args, ["filePath", "filepath", "path", "file", "target"]) || null;
};

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
  const tool = getToolName(payload);
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const args = payload.args;
  const filePath = getStringArg(args, ["filePath", "filepath", "path", "file", "target"]);
  const progressSummary = getProgressSummary(payload);

  if (progressSummary) return progressSummary;

  // Checked before the write branch below, which "todowrite" would otherwise
  // match and be reported as a file edit.
  if (isTodoTool(payload)) {
    const todos = parseTodoItems(payload);

    if (!todos) return title || "Planning the work";

    const active = todos.find((todo) => todo.status === "in_progress");
    const done = todos.filter((todo) => todo.status === "completed").length;

    return active
      ? `${shorten(active.content, 120)} (${done}/${todos.length})`
      : `Updated the plan (${done}/${todos.length} done)`;
  }

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
