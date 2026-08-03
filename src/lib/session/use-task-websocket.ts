import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { env } from "@/env/client";
import type { Project } from "@/lib/project";
import { taskKeys } from "@/lib/project/queries";
import { applyLiveActivityEvent, clearLiveReasoning } from "@/lib/session/task-live-activity";
import type { SandboxEvent, ServerMessage } from "@/lib/session/types";

const RECONNECT_DELAY_MS = 1_500;

/**
 * Events other than streamed text change structure (artifacts, stages, status),
 * so they trigger a refetch. Bursts of them — sandbox log lines especially —
 * are coalesced into one.
 */
const REFETCH_DEBOUNCE_MS = 300;

const resolveWebSocketUrl = () => {
  const configuredUrl = env.VITE_TASK_WEBSOCKET_URL?.trim();

  if (configuredUrl) {
    return new URL(configuredUrl, window.location.origin);
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new URL("/api/ws/tasks", `${protocol}//${window.location.host}`);
};

const readTextBlocks = (event: SandboxEvent) =>
  Array.isArray(event.data.blocks)
    ? event.data.blocks.filter((block): block is string => typeof block === "string")
    : null;

/**
 * Writes streamed agent text straight into the cached task.
 *
 * Text arrives many times a second while the agent works; refetching the task
 * for each update would make the conversation lag behind the stream, so the one
 * field that changed is patched in place instead.
 */
const applyAgentText = (queryClient: QueryClient, taskId: string, event: SandboxEvent) => {
  const blocks = readTextBlocks(event);

  if (!blocks || !event.messageId) {
    return;
  }

  queryClient.setQueryData(
    taskKeys.detail(taskId),
    (current: Project.TaskDetailRecord | undefined) => {
      const index = current?.messages.findIndex((message) => message.id === event.messageId) ?? -1;

      if (!current || index === -1) {
        return current;
      }

      const responseMessages = JSON.stringify(
        blocks.map((text) => ({ text, timestamp: event.timestamp })),
      );

      if (current.messages[index].responseMessages === responseMessages) {
        return current;
      }

      const messages = [...current.messages];
      messages[index] = { ...messages[index], responseMessages };

      return { ...current, messages };
    },
  );
};

export function useTaskWebSocket(taskId: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const refetchTimerRef = useRef<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!taskId || !enabled) {
      return;
    }

    let disposed = false;

    const scheduleRefetch = () => {
      if (refetchTimerRef.current !== null) {
        return;
      }

      refetchTimerRef.current = window.setTimeout(() => {
        refetchTimerRef.current = null;

        if (!disposed) {
          void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
        }
      }, REFETCH_DEBOUNCE_MS);
    };

    const handleServerMessage = (message: ServerMessage) => {
      if (message.type === "error") {
        console.error("Task websocket error:", message.error);
        return;
      }

      if (message.type !== "sandbox_event") {
        return;
      }

      if (message.event.type === "agent_text") {
        applyAgentText(queryClient, taskId, message.event);
        return;
      }

      // Live-only state has no server representation, so consuming it must not
      // trigger a refetch — there would be nothing new to fetch.
      if (applyLiveActivityEvent(queryClient, taskId, message.event)) {
        return;
      }

      // Thinking belongs to the run that produced it; once that run ends it is
      // stale, and the agent's actual answer takes over.
      if (message.event.type === "execution_complete" || message.event.type === "error") {
        clearLiveReasoning(queryClient, taskId);
      }

      scheduleRefetch();
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      const wsUrl = resolveWebSocketUrl();
      wsUrl.searchParams.set("taskId", taskId);

      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        ws.send(JSON.stringify({ type: "subscribe" }));
        // A reconnect may have missed events, so resynchronise from the server.
        scheduleRefetch();
      };

      ws.onmessage = (event) => {
        try {
          handleServerMessage(JSON.parse(event.data) as ServerMessage);
        } catch (error) {
          console.error("Failed to parse websocket message:", error);
        }
      };

      ws.onerror = () => {
        setIsConnected(false);
      };

      ws.onclose = () => {
        wsRef.current = null;
        setIsConnected(false);

        if (!disposed) {
          reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    };

    connect();

    return () => {
      disposed = true;

      for (const timer of [reconnectTimerRef, refetchTimerRef]) {
        if (timer.current !== null) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
      }

      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      setIsConnected(false);
    };
  }, [enabled, queryClient, taskId]);

  return {
    isConnected,
  };
}
