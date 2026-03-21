import type { TaskDetailResult } from "@/lib/project/queries";

export type TaskData = TaskDetailResult;

export type ParsedAgentMessage = { text: string; timestamp: number };

export type ParsedFollowUp = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  stage: string;
  startedAt: string;
  status: TaskData["status"];
};
