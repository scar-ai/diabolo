import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { taskKeys } from "@/lib/project/queries";
import { EMPTY_TASK_LIVE_ACTIVITY, type TaskLiveActivity } from "@/lib/session/task-live-activity";

/**
 * Subscribes to the live-only state the task websocket pushes.
 *
 * This reads the query cache directly rather than going through `useQuery`:
 * the entry is written entirely by `useTaskWebSocket` and is never fetched, and
 * a query with no `queryFn` warns on every render.
 */
export function useTaskLiveActivity(taskId: string | null | undefined): TaskLiveActivity {
  const queryClient = useQueryClient();
  const queryKey = taskKeys.live(taskId ?? "");
  const queryHash = JSON.stringify(queryKey);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === queryHash) {
          onStoreChange();
        }
      }),
    [queryClient, queryHash],
  );

  const getSnapshot = useCallback(
    () => queryClient.getQueryData<TaskLiveActivity>(queryKey) ?? EMPTY_TASK_LIVE_ACTIVITY,
    // The key is fully described by its hash, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, queryHash],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_TASK_LIVE_ACTIVITY);
}
