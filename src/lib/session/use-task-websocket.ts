import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { env } from "@/env/client";
import { taskKeys } from "@/lib/project/queries";
import type { ServerMessage } from "@/lib/session/types";

const RECONNECT_DELAY_MS = 1_500;

const resolveWebSocketUrl = () => {
  const configuredUrl = env.VITE_TASK_WEBSOCKET_URL?.trim();

  if (configuredUrl) {
    return new URL(configuredUrl, window.location.origin);
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return new URL("/api/ws/tasks", `${protocol}//${window.location.host}`);
};

export function useTaskWebSocket(taskId: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!taskId || !enabled) {
      return;
    }

    let disposed = false;

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
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;

          if (message.type === "error") {
            console.error("Task websocket error:", message.error);
            return;
          }

          queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
          queryClient.invalidateQueries({ queryKey: taskKeys.all });
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

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
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
