import "@tanstack/react-start/server-only";
import { Log } from "@/lib/log";
import { findTaskRecord, updateTaskRecord, type TaskRecord } from "@/lib/sandbox/store";

import { SandboxEvents } from "./events";

type TaskStatus = TaskRecord["status"];
type SandboxStatus = TaskRecord["sandboxStatus"];
const log = Log.create({ ns: "sandbox.runtime_state" });

const publishChildUpdate = async (taskRecord: TaskRecord | null | undefined) => {
  if (!taskRecord?.parentTaskId) {
    return;
  }

  await SandboxEvents.publish({
    payload: {
      childTaskId: taskRecord.id,
      parentTaskId: taskRecord.parentTaskId,
      sandboxStatus: taskRecord.sandboxStatus,
      stage: taskRecord.stage,
      status: taskRecord.status,
      title: taskRecord.title,
      updatedAt: taskRecord.updatedAt.toISOString(),
    },
    taskId: taskRecord.parentTaskId,
    type: "child_task_update",
  });
};

export namespace SandboxRuntimeState {
  export const publishChildSnapshot = async (taskId: string) => {
    await publishChildUpdate(await findTaskRecord(taskId));
  };

  export const touchHeartbeat = async (taskId: string) =>
    updateTaskRecord(taskId, {
      lastHeartbeatAt: new Date(),
    });

  export const setSandboxStatus = async (
    taskId: string,
    sandboxStatus: SandboxStatus,
    extras?: Partial<TaskRecord>,
  ) => {
    const previous = await findTaskRecord(taskId);
    const taskRecord = await updateTaskRecord(taskId, {
      ...extras,
      lastHeartbeatAt: new Date(),
      sandboxStatus,
    });

    if (!taskRecord) {
      return null;
    }

    log.debug("sandbox status updated", {
      nextSandboxStatus: taskRecord.sandboxStatus,
      previousSandboxStatus: previous?.sandboxStatus ?? null,
      stage: taskRecord.stage,
      taskId,
    });

    await SandboxEvents.publish({
      payload: {
        sandboxId: taskRecord.sandboxId,
        sandboxName: taskRecord.sandboxName,
        sandboxStatus: taskRecord.sandboxStatus,
        stage: taskRecord.stage,
      },
      taskId,
      type: "sandbox_status",
    });

    await publishChildUpdate(taskRecord);

    return taskRecord;
  };

  export const setTaskStage = async (input: {
    messageId?: string | null;
    stage: string;
    status?: TaskStatus;
    taskId: string;
  }) => {
    const previous = await findTaskRecord(input.taskId);
    const taskRecord = await updateTaskRecord(input.taskId, {
      lastHeartbeatAt: new Date(),
      stage: input.stage,
      status: input.status,
    });

    if (!taskRecord) {
      return null;
    }

    log.debug("task stage updated", {
      messageId: input.messageId ?? null,
      nextStage: taskRecord.stage,
      previousStage: previous?.stage ?? null,
      status: taskRecord.status,
      taskId: input.taskId,
    });

    await SandboxEvents.publish({
      messageId: input.messageId ?? null,
      payload: {
        sandboxStatus: taskRecord.sandboxStatus,
        stage: taskRecord.stage,
        status: taskRecord.status,
      },
      taskId: input.taskId,
      type: "task_stage",
    });

    await publishChildUpdate(taskRecord);

    return taskRecord;
  };

  export const markSpawnFailure = async (taskId: string, errorMessage: string) => {
    const now = new Date();
    const current = await findTaskRecord(taskId);
    const taskRecord = await updateTaskRecord(taskId, {
      lastHeartbeatAt: now,
      lastSpawnError: errorMessage,
      lastSpawnFailureAt: now,
      sandboxStatus: "failed",
      spawnFailureCount: (current?.spawnFailureCount ?? 0) + 1,
      stage: "Sandbox spawn failed",
      status: "failed",
    });

    const latest = taskRecord ?? (await findTaskRecord(taskId));

    if (!latest) {
      return null;
    }

    log.error("sandbox spawn failure recorded", {
      error: errorMessage,
      spawnFailureCount: latest.spawnFailureCount,
      taskId,
    });

    await SandboxEvents.publish({
      payload: {
        error: errorMessage,
        sandboxStatus: latest.sandboxStatus,
        spawnFailureCount: latest.spawnFailureCount,
      },
      taskId,
      type: "error",
    });

    await publishChildUpdate(latest);

    return latest;
  };
}
