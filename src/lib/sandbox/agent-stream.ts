import "@tanstack/react-start/server-only";
import { Log } from "@/lib/log";
import type { RuntimeEventEnvelope, RuntimeRunCompletedPayload } from "@/lib/opencode/protocol";
import { readRunCompletedPayload } from "@/lib/opencode/protocol";
import {
  applyTextBlock,
  createTextBlockState,
  readTextBlocks,
  setTextBlocks,
  type TextBlockState,
} from "@/lib/opencode/text-blocks";
import { SandboxEvents } from "@/lib/sandbox/events";
import {
  findTaskMessage,
  setTaskAgentResponse,
  setTaskMessageAgentResponse,
} from "@/lib/sandbox/store";

const log = Log.create({ ns: "sandbox.agent_stream" });

/**
 * How long text updates are batched before being written to the database. The
 * websocket carries every update immediately, so this only controls how much
 * durability lag a reader who reloads mid-run can see.
 */
const PERSIST_INTERVAL_MS = 500;

type RunState = {
  blocks: TextBlockState;
  finalized: boolean;
  /**
   * The model's thinking. Deliberately never persisted: it is large, it is
   * superseded the moment the answer lands, and its only job is to show the
   * user what is happening right now.
   */
  reasoning: TextBlockState;
  flushTimer: ReturnType<typeof setTimeout> | null;
  lastPersisted: string;
  pendingFlush: Promise<void>;
  runId: string;
  seen: Set<number>;
  taskId: string;
};

const runs = new Map<string, RunState>();

const getBlocks = (state: RunState) => readTextBlocks(state.blocks);

/**
 * A run is identified by `runId`, so a retry of the same message starts from a
 * clean slate instead of appending to the previous attempt's blocks.
 */
const getRunState = (messageId: string, envelope: RuntimeEventEnvelope) => {
  const existing = runs.get(messageId);

  if (existing && existing.runId === envelope.runId) {
    return existing;
  }

  if (existing?.flushTimer) {
    clearTimeout(existing.flushTimer);
  }

  const state: RunState = {
    blocks: createTextBlockState(),
    finalized: false,
    flushTimer: null,
    lastPersisted: "",
    pendingFlush: Promise.resolve(),
    reasoning: createTextBlockState(),
    runId: envelope.runId,
    seen: new Set(),
    taskId: envelope.taskId,
  };

  runs.set(messageId, state);
  return state;
};

const persistBlocks = async (messageId: string, state: RunState) => {
  const blocks = getBlocks(state);
  const signature = JSON.stringify(blocks);

  if (!blocks.length || signature === state.lastPersisted) {
    return;
  }

  state.lastPersisted = signature;
  const timestamp = Date.now();

  await setTaskMessageAgentResponse(messageId, blocks, timestamp);

  // The task-level summary mirrors the first exchange so task lists can show the
  // agent's answer without loading the whole conversation.
  const message = await findTaskMessage(messageId);

  if (message?.kind === "initial" || message?.sequence === 0) {
    await setTaskAgentResponse(state.taskId, blocks.at(-1) ?? "", timestamp);
  }
};

const scheduleFlush = (messageId: string, state: RunState) => {
  if (state.flushTimer) {
    return;
  }

  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    state.pendingFlush = state.pendingFlush
      .then(() => persistBlocks(messageId, state))
      .catch((error: unknown) => {
        log.warn("failed to persist agent text", { error, messageId });
      });
  }, PERSIST_INTERVAL_MS);
};

const flushNow = async (messageId: string, state: RunState) => {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  state.pendingFlush = state.pendingFlush.then(() => persistBlocks(messageId, state));
  await state.pendingFlush;
};

const applyText = (messageId: string, state: RunState, envelope: RuntimeEventEnvelope) => {
  const { index, text } = envelope.payload;

  if (typeof index !== "number" || typeof text !== "string") {
    return null;
  }

  if (!applyTextBlock(state.blocks, { index, seq: envelope.seq, text })) {
    return null;
  }

  scheduleFlush(messageId, state);

  return getBlocks(state);
};

const applyCompletion = async (messageId: string, state: RunState, blocks: string[]) => {
  setTextBlocks(state.blocks, blocks);
  state.finalized = true;
  await flushNow(messageId, state);
};

/**
 * `null` means the envelope was a duplicate and every side effect for it has
 * already run. Callers must treat that as "do nothing further".
 */
export type AgentStreamOutcome = {
  result: RuntimeRunCompletedPayload | null;
};

export const AgentStream = {
  /**
   * Applies one runtime event from the sandbox. Safe to call more than once with
   * the same envelope: delivery over stdout and HTTP is deliberately redundant.
   */
  ingest: async (envelope: RuntimeEventEnvelope): Promise<AgentStreamOutcome | null> => {
    const { messageId } = envelope;
    const state = getRunState(messageId, envelope);

    if (state.seen.has(envelope.seq)) {
      return null;
    }

    state.seen.add(envelope.seq);

    if (envelope.type === "text") {
      const blocks = applyText(messageId, state, envelope);

      // Broadcast instead of persisting an event row: text changes thousands of
      // times per run and its durable home is the message record.
      if (blocks) {
        SandboxEvents.broadcast({
          messageId,
          payload: { blocks, isFinal: false },
          taskId: envelope.taskId,
          type: "agent_text",
        });
      }

      return { result: null };
    }

    if (envelope.type === "reasoning") {
      const { index, text } = envelope.payload;

      if (
        typeof index === "number" &&
        typeof text === "string" &&
        applyTextBlock(state.reasoning, { index, seq: envelope.seq, text })
      ) {
        SandboxEvents.broadcast({
          messageId,
          payload: { blocks: readTextBlocks(state.reasoning) },
          taskId: envelope.taskId,
          type: "agent_reasoning",
        });
      }

      return { result: null };
    }

    if (envelope.type === "run_completed") {
      const result = readRunCompletedPayload(envelope.payload);

      if (!result) {
        return { result: null };
      }

      await applyCompletion(messageId, state, result.blocks);

      SandboxEvents.broadcast({
        messageId,
        payload: { blocks: result.blocks, isFinal: true },
        taskId: envelope.taskId,
        type: "agent_text",
      });

      return { result };
    }

    return { result: null };
  },

  /**
   * Writes out anything still batched and releases the run's state. Called when
   * a message finishes for any reason, so a failed run keeps the partial text it
   * had produced.
   */
  finalize: async (messageId: string) => {
    const state = runs.get(messageId);

    if (!state) {
      return;
    }

    runs.delete(messageId);

    if (!state.finalized) {
      await flushNow(messageId, state).catch((error: unknown) => {
        log.warn("failed to flush agent text on finalize", { error, messageId });
      });
    }
  },
};
