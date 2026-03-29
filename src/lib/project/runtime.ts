import { Sandbox } from "@/lib/sandbox";
import { SandboxEvents } from "@/lib/sandbox/events";
import {
  listTaskArtifacts,
  listTaskEventsAfter,
  listTaskMessages,
  type ParsedTaskArtifactRecord,
  type ParsedTaskEventRecord,
} from "@/lib/sandbox/store";

import {
  findParentTaskSummary,
  findTask,
  listChildTaskSummaries,
  updateTask,
  type ProjectRecord,
} from "./data";
import {
  ACTIVE_TASK_STATUSES,
  MAX_ACTIVE_CHILDREN,
  MAX_CHILD_DEPTH,
  MAX_TOTAL_CHILDREN,
  pickTaskSummary,
  RUNNING_TASK_STATUSES,
  SPAWNABLE_PARENT_STATUSES,
  type TaskMessageRecord,
  type TaskRecord,
  type TaskSummaryRecord,
} from "./shared";

export type TaskDetailRecord = TaskRecord & {
  artifacts: ParsedTaskArtifactRecord[];
  children: TaskSummaryRecord[];
  events: ParsedTaskEventRecord[];
  messages: TaskMessageRecord[];
  parentTask: TaskSummaryRecord | null;
};

export const syncTaskRuntime = async (value: TaskRecord) => {
  if (RUNNING_TASK_STATUSES.has(value.status)) {
    await Sandbox.resumeTask(value.id).match(
      () => {},
      () => {},
    );
  }

  return (await findTask(value.id)) ?? value;
};

export const syncTaskSummaryRuntime = async (value: TaskSummaryRecord) => {
  if (RUNNING_TASK_STATUSES.has(value.status)) {
    await Sandbox.resumeTask(value.id).match(
      () => {},
      () => {},
    );
  }

  const latestTask = await findTask(value.id);
  return latestTask ? pickTaskSummary(latestTask) : value;
};

export const buildTaskDetail = async (taskId: string): Promise<TaskDetailRecord> => {
  const taskRecord = await findTask(taskId);

  if (!taskRecord) {
    throw new Error("Task not found.");
  }

  const [messages, events, artifacts, children, parentTask] = await Promise.all([
    listTaskMessages(taskId),
    listTaskEventsAfter(taskId, -1),
    listTaskArtifacts(taskId),
    listChildTaskSummaries(taskId),
    taskRecord.parentTaskId
      ? findParentTaskSummary(taskRecord.parentTaskId)
      : Promise.resolve(null),
  ]);

  return {
    ...taskRecord,
    artifacts,
    children,
    events,
    messages,
    parentTask,
  };
};

export const terminateTaskRecord = async (taskId: string) => {
  await Sandbox.terminateTask(taskId).match(
    () => {},
    () => {},
  );

  return (await findTask(taskId)) ?? (await updateTask(taskId, {}));
};

export const assertParentCanSpawn = async (
  parentTask: TaskRecord,
  projectRecord: ProjectRecord,
) => {
  if (!SPAWNABLE_PARENT_STATUSES.has(parentTask.status)) {
    throw new Error("Parent task is not eligible for spawning.");
  }

  if (parentTask.spawnDepth >= MAX_CHILD_DEPTH) {
    throw new Error("Child task depth limit reached.");
  }

  const children = await listChildTaskSummaries(parentTask.id);
  const activeChildren = children.filter((child) => ACTIVE_TASK_STATUSES.has(child.status));

  if (activeChildren.length >= MAX_ACTIVE_CHILDREN) {
    throw new Error("Too many active child tasks for this parent.");
  }

  if (children.length >= MAX_TOTAL_CHILDREN) {
    throw new Error("Total child task limit reached for this parent.");
  }

  const parentRepoId = parentTask.repoId ?? projectRecord.repoId;

  if (
    parentRepoId !== projectRecord.repoId &&
    parentTask.repoId &&
    parentTask.repoId !== projectRecord.repoId
  ) {
    throw new Error("Parent task repository does not match its project.");
  }
};

export const stopQuickTaskAndDestroySandbox = async (value: TaskRecord) => {
  await Sandbox.terminateTask(value.id).match(
    () => {},
    () => {},
  );

  if (value.sandboxId) {
    await Sandbox.destroySandbox(value.sandboxId).match(
      () => {},
      () => {},
    );
  }

  return (
    (await findTask(value.id)) ??
    updateTask(value.id, {
      completedAt: new Date(),
      error: "Quick task was stopped by user.",
      sandboxId: null,
      sandboxName: null,
      sandboxPath: null,
      sandboxStatus: "stopped",
      stage: "Quick task stopped",
      status: "failed",
    })
  );
};

export const destroyTaskSandboxRecord = async (value: TaskRecord) => {
  if (value.sandboxId) {
    await Sandbox.destroySandbox(value.sandboxId).match(
      () => {},
      () => {},
    );
  }

  return updateTask(value.id, {
    sandboxId: null,
    sandboxName: null,
    sandboxPath: null,
    sandboxStatus: "stopped",
    stage: "Sandbox stopped",
  });
};

export const queueFollowUpPrompt = async (value: TaskRecord, prompt: string) => {
  await updateTask(value.id, {
    completedAt: null,
    error: null,
    lastHeartbeatAt: new Date(),
    sandboxStatus: value.sandboxId ? "ready" : "pending",
    stage: "Queued prompt",
    status: "queued",
  });

  await Sandbox.runTaskFollowUp(value.id, prompt.trim()).match(
    () => {},
    (error) => {
      throw error;
    },
  );

  return (await findTask(value.id)) ?? value;
};

export const publishChildTaskUpdate = (input: {
  childTaskId: string;
  parentTaskId: string;
  sandboxStatus: string;
  stage: string;
  status: string;
  title: string | null;
}) =>
  SandboxEvents.publish({
    payload: input,
    taskId: input.parentTaskId,
    type: "child_task_update",
  });
