import type { TaskDetailResult } from "@/project/query";

export type TaskData = TaskDetailResult;

export type ParsedAgentMessage = TaskData["parsedAgentMessages"][number];

export type ParsedFollowUp = TaskData["parsedFollowUpHistory"][number];
