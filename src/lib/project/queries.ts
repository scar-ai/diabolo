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

const formatTaskSummaryDate = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const getTaskPromptPreview = (prompt: string, maxLength: number) =>
  prompt.split("\n")[0]?.slice(0, maxLength) ?? "";

const createTaskSummaryLine = ({
  branchName,
  repoName,
  stage,
  status,
}: {
  branchName: string | null;
  repoName: string | null;
  stage: string;
  status: string;
}) => {
  const parts = [repoName, branchName].filter(Boolean);

  if ((status === "queued" || status === "running") && stage) {
    parts.push(stage);
  }

  return parts.join(" · ");
};

type ParsedAgentMessage = { text: string; timestamp: number };

type ParsedConversationMessage = {
  completedAt?: Date | string | null;
  error?: string | null;
  id: string;
  kind: string;
  logs?: string | null;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  sequence: number;
  stage: string;
  startedAt: Date | string;
  status: string;
};

type ParsedLegacyFollowUp = {
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
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseFollowUpHistory = (raw: string | null | undefined): ParsedLegacyFollowUp[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ParsedLegacyFollowUp =>
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
  const conversation: ParsedConversationMessage[] =
    task.messages.length > 0
      ? task.messages.map((message) => ({
          completedAt: message.completedAt,
          error: message.error,
          id: message.id,
          kind: message.kind,
          logs: message.logs,
          prompt: message.prompt,
          responseMessages: parseAgentMessages(message.responseMessages),
          sequence: message.sequence,
          stage: message.stage,
          startedAt: message.startedAt,
          status: message.status,
        }))
      : [];

  const initialMessage = conversation[0] ?? null;
  const parsedAgentMessages =
    initialMessage?.responseMessages ?? parseAgentMessages(task.agentMessages);
  const followUps =
    conversation.length > 0
      ? conversation.slice(1)
      : parseFollowUpHistory(task.followUpHistory).map((entry, index) => ({
          completedAt: entry.completedAt,
          error: entry.error,
          id: entry.id,
          kind: "follow_up",
          logs: entry.logs,
          prompt: entry.prompt,
          responseMessages: entry.responseMessages,
          sequence: index + 1,
          stage: entry.stage,
          startedAt: entry.startedAt,
          status: entry.status,
        }));

  return {
    ...task,
    combinedAgentText: parsedAgentMessages
      .map((message) => message.text)
      .join("\n\n")
      .trim(),
    logs: initialMessage?.logs ?? task.logs ?? null,
    parsedAgentMessages,
    parsedConversation: conversation,
    parsedFollowUpHistory: followUps,
  };
};

export type TaskDetailResult = ReturnType<typeof selectParsedTaskDetail>;

const selectTaskSummaries = (tasks: AllUserTaskSummariesResult) =>
  tasks.map((task) => ({
    ...task,
    promptPreview: getTaskPromptPreview(task.prompt, 80),
    runningSummaryLine: `${task.repoName ?? "-"} · ${task.stage}`,
    sessionSummaryLine: createTaskSummaryLine(task),
    startedAtLabel: formatTaskSummaryDate(task.startedAt),
  }));

export type TaskSummaryResult = ReturnType<typeof selectTaskSummaries>[number];

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
    select: selectTaskSummaries,
    staleTime: 5_000,
  });

export const taskDetailQueryOptions = (taskId: string) =>
  queryOptions({
    queryKey: taskKeys.detail(taskId),
    queryFn: ({ signal }) => $getTaskById({ data: { taskId }, signal }),
    select: (task) => (task ? selectParsedTaskDetail(task) : task),
    staleTime: 2_000,
  });
