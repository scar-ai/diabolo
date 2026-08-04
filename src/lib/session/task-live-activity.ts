import type { QueryClient } from "@tanstack/react-query";

import { taskKeys } from "@/lib/project/queries";
import type { SandboxEvent } from "@/lib/session/types";

/**
 * Live-only task state.
 *
 * Everything here is pushed by the websocket and never fetched: reasoning is
 * deliberately not persisted anywhere, and token totals are advisory until the
 * run's usage is reconciled. A reload therefore starts this empty, which is the
 * intended behaviour — it describes what is happening *now*.
 */
export type TaskLiveActivity = {
  reasoning: {
    blocks: string[];
    messageId: string | null;
    updatedAt: number;
  } | null;
  usage: {
    inputTokens: number;
    /**
     * The run these totals belong to. Counting restarts per run, so without
     * this a follow-up's tokens would be shown against the earlier answer.
     */
    messageId: string | null;
    outputTokens: number;
    reasoningTokens: number;
    steps: number;
    totalTokens: number;
  } | null;
};

export const EMPTY_TASK_LIVE_ACTIVITY: TaskLiveActivity = {
  reasoning: null,
  usage: null,
};

const readNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

const readBlocks = (value: unknown) =>
  Array.isArray(value) ? value.filter((block): block is string => typeof block === "string") : null;

const setLiveActivity = (
  queryClient: QueryClient,
  taskId: string,
  update: (current: TaskLiveActivity) => TaskLiveActivity,
) => {
  queryClient.setQueryData<TaskLiveActivity>(taskKeys.live(taskId), (current) =>
    update(current ?? EMPTY_TASK_LIVE_ACTIVITY),
  );
};

/**
 * Routes a broadcast-only event into the live cache. Returns whether the event
 * was consumed, so the caller knows not to also schedule a refetch for it —
 * none of this state exists on the server.
 */
export const applyLiveActivityEvent = (
  queryClient: QueryClient,
  taskId: string,
  event: SandboxEvent,
) => {
  if (event.type === "agent_reasoning") {
    const blocks = readBlocks(event.data.blocks);

    if (blocks?.length) {
      setLiveActivity(queryClient, taskId, (current) => ({
        ...current,
        reasoning: {
          blocks,
          messageId: event.messageId,
          updatedAt: event.timestamp,
        },
      }));
    }

    return true;
  }

  if (event.type === "token_usage") {
    const totalTokens = readNumber(event.data.totalTokens);

    if (totalTokens > 0) {
      setLiveActivity(queryClient, taskId, (current) => ({
        ...current,
        usage: {
          inputTokens: readNumber(event.data.inputTokens),
          messageId: event.messageId,
          outputTokens: readNumber(event.data.outputTokens),
          reasoningTokens: readNumber(event.data.reasoningTokens),
          steps: readNumber(event.data.steps),
          totalTokens,
        },
      }));
    }

    return true;
  }

  return false;
};

/**
 * Clears live state when a run ends, so a finished task never shows stale
 * thinking from the run that just completed.
 */
export const clearLiveReasoning = (queryClient: QueryClient, taskId: string) => {
  setLiveActivity(queryClient, taskId, (current) => ({ ...current, reasoning: null }));
};
