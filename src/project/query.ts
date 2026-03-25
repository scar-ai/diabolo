import { queryOptions } from "@tanstack/react-query";

import { ProjectServer } from "@/project/server";

export namespace ProjectQuery {
  export type AllUserTasksResult = Awaited<ReturnType<typeof ProjectServer.$listAllUserTasks>>;
  export type AllUserTaskSummariesResult = Awaited<
    ReturnType<typeof ProjectServer.$listAllUserTaskSummaries>
  >;
  export type ProjectsResult = Awaited<ReturnType<typeof ProjectServer.$listProjects>>;
  export type ProjectDetailResult = Awaited<ReturnType<typeof ProjectServer.$getProject>>;

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

  const selectParsedTaskDetail = (
    task: NonNullable<Awaited<ReturnType<typeof ProjectServer.$getTaskById>>>,
  ) => {
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

  export const keys = {
    all: ["projects"] as const,
    detail: (projectId: string) => ["projects", "detail", projectId] as const,
    list: (userId: string) => ["projects", "list", userId] as const,
  };

  export const taskKeys = {
    all: ["tasks"] as const,
    detail: (taskId: string) => ["tasks", "detail", taskId] as const,
    list: (userId: string) => ["tasks", "list", userId] as const,
    summaryList: (userId: string) => ["tasks", "summary-list", userId] as const,
  };

  export const projects = (userId: string) =>
    queryOptions({
      queryKey: keys.list(userId),
      queryFn: ({ signal }) => ProjectServer.$listProjects({ signal }),
      staleTime: 30_000,
    });

  export const projectDetail = (projectId: string) =>
    queryOptions({
      queryKey: keys.detail(projectId),
      queryFn: ({ signal }) => ProjectServer.$getProject({ data: { projectId }, signal }),
      staleTime: 30_000,
    });

  export const allUserTasks = (userId: string) =>
    queryOptions({
      queryKey: taskKeys.list(userId),
      queryFn: ({ signal }) => ProjectServer.$listAllUserTasks({ signal }),
      staleTime: 5_000,
    });

  export const allUserTaskSummaries = (userId: string) =>
    queryOptions({
      queryKey: taskKeys.summaryList(userId),
      queryFn: ({ signal }) => ProjectServer.$listAllUserTaskSummaries({ signal }),
      select: selectTaskSummaries,
      staleTime: 5_000,
    });

  export const taskDetail = (taskId: string) =>
    queryOptions({
      queryKey: taskKeys.detail(taskId),
      queryFn: ({ signal }) => ProjectServer.$getTaskById({ data: { taskId }, signal }),
      select: (task) => (task ? selectParsedTaskDetail(task) : task),
      staleTime: 2_000,
    });
}

export type AllUserTasksResult = ProjectQuery.AllUserTasksResult;
export type AllUserTaskSummariesResult = ProjectQuery.AllUserTaskSummariesResult;
export type ProjectsResult = ProjectQuery.ProjectsResult;
export type ProjectDetailResult = ProjectQuery.ProjectDetailResult;
export type TaskDetailResult = ProjectQuery.TaskDetailResult;
export type TaskSummaryResult = ProjectQuery.TaskSummaryResult;
export const projectKeys = ProjectQuery.keys;
export const taskKeys = ProjectQuery.taskKeys;
export const projectsQueryOptions = ProjectQuery.projects;
export const projectDetailQueryOptions = ProjectQuery.projectDetail;
export const allUserTasksQueryOptions = ProjectQuery.allUserTasks;
export const allUserTaskSummariesQueryOptions = ProjectQuery.allUserTaskSummaries;
export const taskDetailQueryOptions = ProjectQuery.taskDetail;
