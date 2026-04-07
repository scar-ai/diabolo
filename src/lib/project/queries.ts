import { queryOptions } from "@tanstack/react-query";

import type { Project } from "@/lib/project";

import {
  $getMyProjectInvites,
  $getProject,
  $getProjectCollaborators,
  $getProjectInvites,
  $getServerTime,
  $listScheduledTasks,
  $getTaskById,
  $listAllUserTaskSummaries,
  $listAllUserTasks,
  $listProjects,
} from "./functions";
import { selectParsedTaskDetail, type TaskDetailResult } from "./task-detail-selector";
import { selectTaskSummaries, type TaskSummaryResult } from "./task-summary-selector";

export type { ParsedTaskArtifact, TaskDetailResult } from "./task-detail-selector";
export type { TaskSummaryResult } from "./task-summary-selector";
export type AllUserTasksResult = Awaited<ReturnType<typeof $listAllUserTasks>>;
export type AllUserTaskSummariesResult = Awaited<ReturnType<typeof $listAllUserTaskSummaries>>;
export type ProjectsResult = Awaited<ReturnType<typeof $listProjects>>;
export type ProjectDetailResult = Awaited<ReturnType<typeof $getProject>>;
export type ServerTimeResult = Awaited<ReturnType<typeof $getServerTime>>;

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  list: (userId: string) => [...projectKeys.all, "list", userId] as const,
};

export const scheduledTaskKeys = {
  all: ["scheduled-tasks"] as const,
  list: (projectId: string) => [...scheduledTaskKeys.all, "list", projectId] as const,
};

export const serverTimeKeys = {
  all: ["server-time"] as const,
};

export const taskKeys = {
  all: ["tasks"] as const,
  detail: (taskId: string) => [...taskKeys.all, "detail", taskId] as const,
  list: (userId: string) => [...taskKeys.all, "list", userId] as const,
  summaryList: (userId: string) => [...taskKeys.all, "summary-list", userId] as const,
};

export const projectsQueryOptions = (userId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $listProjects({ signal }),
    queryKey: projectKeys.list(userId),
    staleTime: 30_000,
  });

export const projectDetailQueryOptions = (projectId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $getProject({ data: { projectId }, signal }),
    queryKey: projectKeys.detail(projectId),
    staleTime: 30_000,
  });

export const projectScheduledTasksQueryOptions = (projectId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $listScheduledTasks({ data: { projectId }, signal }),
    queryKey: scheduledTaskKeys.list(projectId),
    staleTime: 5_000,
  });

export const serverTimeQueryOptions = () =>
  queryOptions({
    queryFn: ({ signal }) => $getServerTime({ signal }),
    queryKey: serverTimeKeys.all,
    staleTime: 0,
  });

export const allUserTasksQueryOptions = (userId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $listAllUserTasks({ signal }),
    queryKey: taskKeys.list(userId),
    staleTime: 5_000,
  });

export const allUserTaskSummariesQueryOptions = (userId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $listAllUserTaskSummaries({ signal }),
    queryKey: taskKeys.summaryList(userId),
    select: selectTaskSummaries,
    staleTime: 5_000,
  });

export const taskDetailQueryOptions = (taskId: string) =>
  queryOptions({
    queryFn: ({ signal }) =>
      $getTaskById({ data: { taskId }, signal }) as Promise<Project.TaskDetailRecord>,
    queryKey: taskKeys.detail(taskId),
    select: (task) => (task ? selectParsedTaskDetail(task) : task),
    staleTime: 2_000,
  });

export const collaboratorKeys = {
  all: ["collaborators"] as const,
  forProject: (projectId: string) => [...collaboratorKeys.all, "project", projectId] as const,
  invitesForProject: (projectId: string) =>
    [...collaboratorKeys.all, "invites", projectId] as const,
  myInvites: (userId: string) => [...collaboratorKeys.all, "my-invites", userId] as const,
};

export type ProjectCollaboratorsResult = Awaited<ReturnType<typeof $getProjectCollaborators>>;
export type ProjectInvitesResult = Awaited<ReturnType<typeof $getProjectInvites>>;
export type MyProjectInvitesResult = Awaited<ReturnType<typeof $getMyProjectInvites>>;

export const projectCollaboratorsQueryOptions = (projectId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $getProjectCollaborators({ data: { projectId }, signal }),
    queryKey: collaboratorKeys.forProject(projectId),
    staleTime: 30_000,
  });

export const projectInvitesQueryOptions = (projectId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $getProjectInvites({ data: { projectId }, signal }),
    queryKey: collaboratorKeys.invitesForProject(projectId),
    staleTime: 30_000,
  });

export const myProjectInvitesQueryOptions = (userId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $getMyProjectInvites({ signal }),
    queryKey: collaboratorKeys.myInvites(userId),
    staleTime: 30_000,
  });
