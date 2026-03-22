import type { TaskDetailResult } from "@/lib/project/queries";

export type TaskData = TaskDetailResult;

export type ParsedAgentMessage = TaskData["parsedAgentMessages"][number];

export type ParsedFollowUp = TaskData["parsedFollowUpHistory"][number];
