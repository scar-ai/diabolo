import { useTaskWebSocket } from "@/lib/session/use-task-websocket";

export function useTaskStream(taskId: string | null | undefined, enabled = true) {
  return useTaskWebSocket(taskId, enabled);
}
