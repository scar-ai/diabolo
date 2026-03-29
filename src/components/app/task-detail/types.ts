import type { TaskDetailResult } from "@/lib/project/queries";

import type { UserInfo } from "./user-bubble";

export type TaskData = TaskDetailResult;

export type ParsedAgentMessage = TaskData["parsedAgentMessages"][number];

export type ParsedFollowUp = TaskData["parsedFollowUpHistory"][number];

export type { UserInfo };

export type CollaboratorMap = Map<string, UserInfo>;
