import { queryOptions } from "@tanstack/react-query";

import { $getTaskById, $listAllUserTasks, $listProjects } from "./functions";

export type AllUserTasksResult = Awaited<ReturnType<typeof $listAllUserTasks>>;
export type TaskDetailResult = NonNullable<Awaited<ReturnType<typeof $getTaskById>>>;
export type ProjectsResult = Awaited<ReturnType<typeof $listProjects>>;

export const projectsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["projects", userId],
    queryFn: ({ signal }) => $listProjects({ signal }),
    staleTime: 30_000,
  });

export const allUserTasksQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["all-user-tasks", userId],
    queryFn: ({ signal }) => $listAllUserTasks({ signal }),
    staleTime: 5_000,
  });

export const taskDetailQueryOptions = (taskId: string) =>
  queryOptions({
    queryKey: ["task-detail", taskId],
    queryFn: ({ signal }) => $getTaskById({ data: { taskId }, signal }),
    staleTime: 2_000,
  });
