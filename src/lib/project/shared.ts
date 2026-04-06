import { task, taskMessage } from "./project.sql";

export type ProjectId = string & { __brand: "ProjectId" };
export type TaskId = string & { __brand: "TaskId" };

export type TaskRecord = typeof task.$inferSelect;
export type TaskMessageRecord = typeof taskMessage.$inferSelect;

export const MAX_CHILD_DEPTH = 2;
export const MAX_ACTIVE_CHILDREN = 5;
export const MAX_TOTAL_CHILDREN = 15;
export const ACTIVE_TASK_STATUSES = new Set(["queued", "running"]);
export const RUNNING_TASK_STATUSES = new Set(["queued", "running"]);
export const SPAWNABLE_PARENT_STATUSES = new Set(["queued", "running", "succeeded"]);

export const buildTaskTitle = (prompt: string) =>
  prompt.split("\n")[0]?.trim().slice(0, 120) || null;

export const taskSummarySelection = {
  branchName: task.branchName,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  createdByUserId: task.createdByUserId,
  id: task.id,
  lastHeartbeatAt: task.lastHeartbeatAt,
  parentTaskId: task.parentTaskId,
  projectId: task.projectId,
  prompt: task.prompt,
  repoName: task.repoName,
  scheduledTaskId: task.scheduledTaskId,
  sandboxId: task.sandboxId,
  sandboxStatus: task.sandboxStatus,
  spawnDepth: task.spawnDepth,
  spawnSource: task.spawnSource,
  stage: task.stage,
  startedAt: task.startedAt,
  status: task.status,
  title: task.title,
  updatedAt: task.updatedAt,
} as const;

export type TaskSummaryKey = keyof typeof taskSummarySelection;
export type TaskSummaryRecord = Pick<TaskRecord, TaskSummaryKey>;

export const pickTaskSummary = (value: TaskRecord): TaskSummaryRecord => ({
  branchName: value.branchName,
  completedAt: value.completedAt,
  createdAt: value.createdAt,
  createdByUserId: value.createdByUserId,
  id: value.id,
  lastHeartbeatAt: value.lastHeartbeatAt,
  parentTaskId: value.parentTaskId,
  projectId: value.projectId,
  prompt: value.prompt,
  repoName: value.repoName,
  scheduledTaskId: value.scheduledTaskId,
  sandboxId: value.sandboxId,
  sandboxStatus: value.sandboxStatus,
  spawnDepth: value.spawnDepth,
  spawnSource: value.spawnSource,
  stage: value.stage,
  startedAt: value.startedAt,
  status: value.status,
  title: value.title,
  updatedAt: value.updatedAt,
});
