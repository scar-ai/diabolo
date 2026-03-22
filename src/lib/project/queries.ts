import { queryOptions } from "@tanstack/react-query";

import {
  $getProject,
  $getTaskById,
  $listAllUserTaskSummaries,
  $listAllUserTasks,
  $listProjects,
} from "./functions";

export type AllUserTasksResult = Awaited<ReturnType<typeof $listAllUserTasks>>;
export type AllUserTaskSummariesResult = Awaited<ReturnType<typeof $listAllUserTaskSummaries>>;
export type ProjectsResult = Awaited<ReturnType<typeof $listProjects>>;
export type ProjectDetailResult = Awaited<ReturnType<typeof $getProject>>;

type ParsedAgentMessage = { text: string; timestamp: number };

type ParsedFollowUp = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  stage: string;
  startedAt: string;
  status: string;
};

const parseAgentMessages = (raw: string | null | undefined): ParsedAgentMessage[] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseFollowUpHistory = (raw: string | null | undefined): ParsedFollowUp[] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ParsedFollowUp =>
            typeof entry?.id === "string" &&
            typeof entry?.prompt === "string" &&
            typeof entry?.stage === "string" &&
            typeof entry?.startedAt === "string" &&
            Array.isArray(entry?.responseMessages) &&
            typeof entry?.status === "string",
        )
      : [];
  } catch {
    return [];
  }
};

const selectParsedTaskDetail = (task: NonNullable<Awaited<ReturnType<typeof $getTaskById>>>) => {
  const parsedAgentMessages = parseAgentMessages(task.agentMessages);
  const parsedFollowUpHistory = parseFollowUpHistory(task.followUpHistory);

  return {
    ...task,
    combinedAgentText: parsedAgentMessages
      .map((message) => message.text)
      .join("\n\n")
      .trim(),
    parsedAgentMessages,
    parsedFollowUpHistory,
  };
};

export type TaskDetailResult = ReturnType<typeof selectParsedTaskDetail>;

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  list: (userId: string) => [...projectKeys.all, "list", userId] as const,
};

export const taskKeys = {
  all: ["tasks"] as const,
  detail: (taskId: string) => [...taskKeys.all, "detail", taskId] as const,
  list: (userId: string) => [...taskKeys.all, "list", userId] as const,
  summaryList: (userId: string) => [...taskKeys.all, "summary-list", userId] as const,
};

export const projectsQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: projectKeys.list(userId),
    queryFn: ({ signal }) => $listProjects({ signal }),
    staleTime: 30_000,
  });

export const projectDetailQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: projectKeys.detail(projectId),
    queryFn: ({ signal }) => $getProject({ data: { projectId }, signal }),
    staleTime: 30_000,
  });

export const allUserTasksQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: taskKeys.list(userId),
    queryFn: ({ signal }) => $listAllUserTasks({ signal }),
    staleTime: 5_000,
  });

export const allUserTaskSummariesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: taskKeys.summaryList(userId),
    queryFn: ({ signal }) => $listAllUserTaskSummaries({ signal }),
    staleTime: 5_000,
  });

export const taskDetailQueryOptions = (taskId: string) =>
  queryOptions({
    queryKey: taskKeys.detail(taskId),
    queryFn: ({ signal }) => $getTaskById({ data: { taskId }, signal }),
    select: (task) => (task ? selectParsedTaskDetail(task) : task),
    staleTime: 2_000,
  });
