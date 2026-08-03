import type { JsonObject } from "@/lib/json";

/**
 * The wire protocol between the OpenCode runtime running inside the sandbox and
 * the app.
 *
 * One shape, two transports. Every event is written to stdout as a single
 * prefixed JSON line — an ordered, durable log the host already polls — and is
 * additionally POSTed to the app when the sandbox can reach it, purely to cut
 * latency. Both transports carry the identical envelope, so the host dedupes on
 * `(runId, seq)` and neither transport needs to know the other exists.
 */
export const RUNTIME_PROTOCOL_VERSION = 1;

/** Marks a stdout line as a protocol event rather than ordinary command output. */
export const RUNTIME_EVENT_PREFIX = "@@diabolo:event@@";

export type RuntimeEventType =
  /** The run reached the model; nothing has been produced yet. */
  | "run_started"
  /** Full current text of one assistant block. Idempotent, keyed by `index`. */
  | "text"
  /**
   * Full current text of one reasoning block. Same shape and idempotency as
   * `text`, but the model's thinking rather than its answer.
   */
  | "reasoning"
  /** A tool call started. */
  | "tool_start"
  /** A tool call settled, successfully or not. */
  | "tool_end"
  /** Running token totals for the current run. Advisory, live display only. */
  | "token_usage"
  /** The run finished; payload carries the authoritative final state. */
  | "run_completed"
  /** The run failed; payload carries the message to surface. */
  | "run_failed";

export type RuntimeEventEnvelope = {
  messageId: string;
  payload: JsonObject;
  runId: string;
  seq: number;
  taskId: string;
  type: RuntimeEventType;
  v: number;
};

/** Payload of a `text` or `reasoning` event. */
export type RuntimeTextPayload = {
  blockId: string;
  index: number;
  text: string;
};

/**
 * Payload of `token_usage` — cumulative totals for the run so far, not the
 * delta for one step. The runtime accumulates them so the host stays stateless.
 */
export type RuntimeTokenUsagePayload = {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  steps: number;
  totalTokens: number;
};

/** Payload of `tool_start` / `tool_end`. */
export type RuntimeToolPayload = {
  args: JsonObject;
  callId: string;
  output: string;
  status: "running" | "completed" | "error";
  title: string;
  tool: string;
};

/** Payload of `run_completed` — the authoritative result of the whole run. */
export type RuntimeRunCompletedPayload = {
  assistantMessageId: string | null;
  /**
   * Every assistant text block in order. The last entry is the agent's final
   * answer; everything before it is intermediate narration.
   */
  blocks: string[];
  sessionId: string;
  userMessageId: string;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const RUNTIME_EVENT_TYPES = new Set<string>([
  "run_started",
  "text",
  "reasoning",
  "tool_start",
  "tool_end",
  "token_usage",
  "run_completed",
  "run_failed",
] satisfies RuntimeEventType[]);

export const isRuntimeEventType = (value: unknown): value is RuntimeEventType =>
  typeof value === "string" && RUNTIME_EVENT_TYPES.has(value);

/**
 * Validates an envelope that arrived over either transport. Returns `null` for
 * anything malformed so a corrupt line can never take a run down.
 */
export const parseRuntimeEventEnvelope = (value: unknown): RuntimeEventEnvelope | null => {
  if (!isJsonObject(value)) {
    return null;
  }

  const { messageId, payload, runId, seq, taskId, type } = value;

  if (
    !isRuntimeEventType(type) ||
    typeof messageId !== "string" ||
    !messageId ||
    typeof taskId !== "string" ||
    !taskId ||
    typeof runId !== "string" ||
    !runId ||
    typeof seq !== "number" ||
    !Number.isFinite(seq)
  ) {
    return null;
  }

  return {
    messageId,
    payload: isJsonObject(payload) ? payload : {},
    runId,
    seq,
    taskId,
    type,
    v: typeof value.v === "number" ? value.v : RUNTIME_PROTOCOL_VERSION,
  };
};

/**
 * Extracts a protocol event from one line of sandbox stdout. Lines without the
 * prefix are ordinary logs and yield `null`.
 */
export const parseRuntimeEventLine = (line: string): RuntimeEventEnvelope | null => {
  const start = line.indexOf(RUNTIME_EVENT_PREFIX);

  if (start === -1) {
    return null;
  }

  const raw = line.slice(start + RUNTIME_EVENT_PREFIX.length).trim();

  if (!raw) {
    return null;
  }

  try {
    return parseRuntimeEventEnvelope(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const isRuntimeEventLine = (line: string) => line.includes(RUNTIME_EVENT_PREFIX);

/**
 * Narrows a validated envelope's payload to running token totals. Returns
 * `null` when nothing has actually been counted yet, so the UI can stay quiet
 * rather than render a row of zeros.
 */
export const readTokenUsagePayload = (payload: JsonObject): RuntimeTokenUsagePayload | null => {
  const asCount = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

  const usage: RuntimeTokenUsagePayload = {
    cacheReadTokens: asCount(payload.cacheReadTokens),
    cacheWriteTokens: asCount(payload.cacheWriteTokens),
    inputTokens: asCount(payload.inputTokens),
    outputTokens: asCount(payload.outputTokens),
    reasoningTokens: asCount(payload.reasoningTokens),
    steps: asCount(payload.steps),
    totalTokens: asCount(payload.totalTokens),
  };

  return usage.totalTokens > 0 ? usage : null;
};

/** Narrows a validated envelope's payload to the completed-run result. */
export const readRunCompletedPayload = (payload: JsonObject): RuntimeRunCompletedPayload | null => {
  const blocks = Array.isArray(payload.blocks)
    ? payload.blocks.filter((block): block is string => typeof block === "string")
    : null;

  if (!blocks || typeof payload.sessionId !== "string") {
    return null;
  }

  return {
    assistantMessageId:
      typeof payload.assistantMessageId === "string" ? payload.assistantMessageId : null,
    blocks,
    sessionId: payload.sessionId,
    userMessageId: typeof payload.userMessageId === "string" ? payload.userMessageId : "",
  };
};
