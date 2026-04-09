import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { taskKeys } from "@/lib/project/queries";

const TASK_STREAM_EVENT_TYPES = [
  "artifact",
  "branch",
  "child_task_update",
  "error",
  "execution_complete",
  "log",
  "pull_request",
  "sandbox_status",
  "task_stage",
  "text",
  "tool_result",
  "usage",
  "user_message",
] as const;

export function useTaskStream(taskId: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!taskId || !enabled) {
      return;
    }

    const streamUrl = new URL(`/api/tasks/${taskId}/stream`, window.location.origin);
    const source = new EventSource(streamUrl.toString(), { withCredentials: true });

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    };

    source.onmessage = invalidate;
    for (const eventType of TASK_STREAM_EVENT_TYPES) {
      source.addEventListener(eventType, invalidate);
    }
    source.onerror = () => {
      invalidate();
      source.close();
    };

    return () => {
      source.close();
    };
  }, [enabled, queryClient, taskId]);
}
