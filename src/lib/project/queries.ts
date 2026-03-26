import { queryOptions } from "@tanstack/react-query";

import type { JsonObject } from "@/lib/json";
import type { Project } from "@/lib/project";

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
  sandboxStatus,
  stage,
}: {
  branchName: string | null;
  repoName: string | null;
  sandboxStatus: string;
  stage: string;
}) =>
  [repoName, branchName, sandboxStatus !== "ready" ? sandboxStatus : null, stage]
    .filter(Boolean)
    .join(" · ");

type ParsedAgentMessage = { text: string; timestamp: number };
type ParsedTaskEvent = {
  createdAt: Date | string;
  id: string;
  messageId: string | null;
  payload: JsonObject;
  sequence: number;
  type: string;
};
type ParsedTaskArtifact = {
  createdAt: Date | string;
  id: string;
  messageId: string | null;
  metadata: JsonObject | null;
  type: string;
  url: string;
};

type ParsedConversationMessage = {
  artifacts: ParsedTaskArtifact[];
  completedAt?: Date | string | null;
  error?: string | null;
  id: string;
  kind: string;
  logs?: string | null;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  runtimeEvents: ParsedTaskEvent[];
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

const selectParsedTaskDetail = (task: Project.TaskDetailRecord) => {
  const events: ParsedTaskEvent[] = task.events.map((event) => ({
    createdAt: event.createdAt,
    id: event.id,
    messageId: event.messageId,
    payload: event.parsedPayload,
    sequence: event.sequence,
    type: event.type,
  }));
  const artifacts: ParsedTaskArtifact[] = task.artifacts.map((artifact) => ({
    createdAt: artifact.createdAt,
    id: artifact.id,
    messageId: artifact.messageId,
    metadata: artifact.parsedMetadata,
    type: artifact.type,
    url: artifact.url,
  }));

  const textEventsByMessageId = new Map<string, ParsedAgentMessage[]>();

  for (const event of events) {
    if (event.type !== "text" || !event.messageId || typeof event.payload.text !== "string") {
      continue;
    }

    const bucket = textEventsByMessageId.get(event.messageId) ?? [];
    bucket.push({
      text: event.payload.text,
      timestamp: Number(event.payload.timestamp ?? new Date(event.createdAt).getTime()),
    });
    textEventsByMessageId.set(event.messageId, bucket);
  }

  const conversation: ParsedConversationMessage[] =
    task.messages.length > 0
      ? task.messages.map((message) => ({
          artifacts: artifacts.filter((artifact) => artifact.messageId === message.id),
          completedAt: message.completedAt,
          error: message.error,
          id: message.id,
          kind: message.kind,
          logs: message.logs,
          prompt: message.prompt,
          responseMessages:
            textEventsByMessageId.get(message.id) ?? parseAgentMessages(message.responseMessages),
          runtimeEvents: events.filter((event) => event.messageId === message.id),
          sequence: message.sequence,
          stage: message.stage,
          startedAt: message.startedAt,
          status: message.status,
        }))
      : [];

  const initialMessage = conversation[0] ?? null;
  const pullRequestArtifact =
    artifacts.find((artifact) => artifact.type === "pull_request") ?? null;
  const branchArtifact = artifacts.find((artifact) => artifact.type === "branch") ?? null;
  const derivedPrUrl =
    task.prUrl ||
    (typeof pullRequestArtifact?.metadata?.prUrl === "string"
      ? pullRequestArtifact.metadata.prUrl
      : (pullRequestArtifact?.url ?? null));
  const derivedPrNumber =
    task.prNumber ??
    (typeof pullRequestArtifact?.metadata?.prNumber === "number"
      ? pullRequestArtifact.metadata.prNumber
      : null);
  const derivedBranchName =
    task.branchName ||
    (typeof branchArtifact?.metadata?.branchName === "string"
      ? branchArtifact.metadata.branchName
      : (branchArtifact?.url ?? null));
  const parsedAgentMessages = initialMessage?.responseMessages.length
    ? initialMessage.responseMessages
    : parseAgentMessages(task.agentMessages);
  const followUps =
    conversation.length > 0
      ? conversation.slice(1)
      : parseFollowUpHistory(task.followUpHistory).map((entry, index) => ({
          artifacts: [],
          completedAt: entry.completedAt,
          error: entry.error,
          id: entry.id,
          kind: "follow_up",
          logs: entry.logs,
          prompt: entry.prompt,
          responseMessages: entry.responseMessages,
          runtimeEvents: [],
          sequence: index + 1,
          stage: entry.stage,
          startedAt: entry.startedAt,
          status: entry.status,
        }));

  return {
    ...task,
    branchName: derivedBranchName,
    combinedAgentText: parsedAgentMessages
      .map((message) => message.text)
      .join("\n\n")
      .trim(),
    events,
    artifacts,
    logs: initialMessage?.logs ?? task.logs ?? null,
    parsedAgentMessages,
    parsedConversation: conversation,
    parsedFollowUpHistory: followUps,
    prNumber: derivedPrNumber,
    prUrl: derivedPrUrl,
  };
};

export type TaskDetailResult = ReturnType<typeof selectParsedTaskDetail>;

const selectTaskSummaries = (tasks: AllUserTaskSummariesResult) => {
  const childMap = new Map<string, AllUserTaskSummariesResult>();

  for (const summary of tasks) {
    if (!summary.parentTaskId) {
      continue;
    }

    const bucket = childMap.get(summary.parentTaskId) ?? [];
    bucket.push(summary);
    childMap.set(summary.parentTaskId, bucket);
  }

  return tasks.map((task) => {
    const children = childMap.get(task.id) ?? [];
    const activeChildren = children.filter(
      (child) => child.status === "queued" || child.status === "running",
    );

    return {
      ...task,
      activeChildCount: activeChildren.length,
      childCount: children.length,
      hasActiveChildren: activeChildren.length > 0,
      isChildTask: Boolean(task.parentTaskId),
      promptPreview: getTaskPromptPreview(task.title || task.prompt, 80),
      runningSummaryLine: `${task.repoName ?? "-"} · ${task.sandboxStatus} · ${task.stage}`,
      sessionSummaryLine: createTaskSummaryLine(task),
      startedAtLabel: formatTaskSummaryDate(task.startedAt),
    };
  });
};

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
