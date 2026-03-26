import { and, desc, eq, inArray } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import * as R from "remeda";

import { db } from "@/lib/db";
import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { fromPromise } from "@/lib/result";
import { Sandbox } from "@/lib/sandbox";
import { SandboxEvents } from "@/lib/sandbox/events";
import {
  listTaskArtifacts,
  listTaskEventsAfter,
  listTaskMessages,
  type ParsedTaskArtifactRecord,
  type ParsedTaskEventRecord,
} from "@/lib/sandbox/store";

import { project, task, taskMessage } from "./project.sql";

export type ProjectId = string & { __brand: "ProjectId" };
export type TaskId = string & { __brand: "TaskId" };

const log = Log.create({ ns: "project" });

const MAX_CHILD_DEPTH = 2;
const MAX_ACTIVE_CHILDREN = 5;
const MAX_TOTAL_CHILDREN = 15;
const ACTIVE_TASK_STATUSES = new Set(["queued", "running"]);
const RUNNING_TASK_STATUSES = new Set(["queued", "running"]);
const SPAWNABLE_PARENT_STATUSES = new Set(["queued", "running", "succeeded"]);

const buildTaskTitle = (prompt: string) => prompt.split("\n")[0]?.trim().slice(0, 120) || null;

export namespace Project {
  export type ProjectRecord = typeof project.$inferSelect;
  export type TaskRecord = typeof task.$inferSelect;
  export type TaskMessageRecord = typeof taskMessage.$inferSelect;

  export type TaskSummaryRecord = Pick<TaskRecord, TaskSummaryKey>;
  export type TaskForUserRecord = {
    project: ProjectRecord;
    task: TaskRecord;
  };
  export type TaskDetailRecord = TaskRecord & {
    artifacts: ParsedTaskArtifactRecord[];
    children: TaskSummaryRecord[];
    events: ParsedTaskEventRecord[];
    messages: TaskMessageRecord[];
    parentTask: TaskSummaryRecord | null;
  };

  const taskSummarySelection = {
    branchName: task.branchName,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    id: task.id,
    lastHeartbeatAt: task.lastHeartbeatAt,
    parentTaskId: task.parentTaskId,
    projectId: task.projectId,
    prompt: task.prompt,
    quickTask: task.quickTask,
    repoName: task.repoName,
    sandboxId: task.sandboxId,
    sandboxStatus: task.sandboxStatus,
    spawnDepth: task.spawnDepth,
    stage: task.stage,
    startedAt: task.startedAt,
    status: task.status,
    title: task.title,
    updatedAt: task.updatedAt,
  } as const;

  type TaskSummaryKey = keyof typeof taskSummarySelection;

  const insertProject = (input: { id: string; name: string; repoId: string; userId: string }) =>
    db
      .insert(project)
      .values(input)
      .returning()
      .then((rows) => rows[0]);

  const deleteProject = (projectId: string) => db.delete(project).where(eq(project.id, projectId));

  const findProject = (projectId: string, userId: string) =>
    db
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.userId, userId)))
      .then((rows) => rows[0]);

  const listProjects = (userId: string) =>
    db.select().from(project).where(eq(project.userId, userId)).orderBy(desc(project.createdAt));

  const listProjectIds = (userId: string) =>
    db.select({ id: project.id }).from(project).where(eq(project.userId, userId));

  const insertTask = (input: {
    branchName: string;
    id: string;
    opencodeModel?: string | null;
    parentTaskId?: string | null;
    projectId: string;
    prompt: string;
    quickTask: boolean;
    repoId: string;
    sandboxStatus?: string;
    spawnDepth?: number;
    spawnSource?: string;
    stage: string;
    startedAt: Date;
    status: string;
    title?: string | null;
  }) =>
    db
      .insert(task)
      .values(input)
      .returning()
      .then((rows) => rows[0]);

  const deleteTask = (taskId: string, projectId: string) =>
    db.delete(task).where(and(eq(task.id, taskId), eq(task.projectId, projectId)));

  const findTask = (taskId: string) =>
    db
      .select()
      .from(task)
      .where(eq(task.id, taskId))
      .then((rows) => rows[0]);

  const findTaskWithProject = (taskId: string) =>
    db
      .select()
      .from(task)
      .innerJoin(project, eq(task.projectId, project.id))
      .where(eq(task.id, taskId))
      .then((rows) => rows[0] as TaskForUserRecord | undefined);

  const findProjectTask = (taskId: string, projectId: string) =>
    db
      .select()
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.projectId, projectId)))
      .then((rows) => rows[0]);

  const findUserTask = (taskId: string, userId: string) =>
    db
      .select()
      .from(task)
      .innerJoin(project, eq(task.projectId, project.id))
      .where(and(eq(task.id, taskId), eq(project.userId, userId)))
      .then((rows) => rows[0] as TaskForUserRecord | undefined);

  const listProjectTasks = (projectId: string) =>
    db.select().from(task).where(eq(task.projectId, projectId)).orderBy(desc(task.createdAt));

  const listChildTaskSummaries = (parentTaskId: string) =>
    db
      .select(taskSummarySelection)
      .from(task)
      .where(eq(task.parentTaskId, parentTaskId))
      .orderBy(desc(task.updatedAt));

  const listUserTasks = (projectIds: string[]) =>
    db.select().from(task).where(inArray(task.projectId, projectIds)).orderBy(desc(task.startedAt));

  const listUserTaskSummaries = (projectIds: string[]) =>
    db
      .select(taskSummarySelection)
      .from(task)
      .where(inArray(task.projectId, projectIds))
      .orderBy(desc(task.startedAt));

  const updateTask = (taskId: string, values: Partial<TaskRecord>) =>
    db
      .update(task)
      .set(values)
      .where(eq(task.id, taskId))
      .returning()
      .then((rows) => rows[0]);

  const requireUserProject = (projectId: string, userId: string) =>
    fromPromise(findProject(projectId, userId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Project not found.")),
    );

  const requireTaskForProject = (projectId: string, taskId: string) =>
    fromPromise(findProjectTask(taskId, projectId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Task not found.")),
    );

  const requireTaskForUser = (taskId: string, userId: string) =>
    fromPromise(findUserTask(taskId, userId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Task not found.")),
    );

  const pickTaskSummary = (value: TaskRecord): TaskSummaryRecord => ({
    branchName: value.branchName,
    completedAt: value.completedAt,
    createdAt: value.createdAt,
    id: value.id,
    lastHeartbeatAt: value.lastHeartbeatAt,
    parentTaskId: value.parentTaskId,
    projectId: value.projectId,
    prompt: value.prompt,
    quickTask: value.quickTask,
    repoName: value.repoName,
    sandboxId: value.sandboxId,
    sandboxStatus: value.sandboxStatus,
    spawnDepth: value.spawnDepth,
    stage: value.stage,
    startedAt: value.startedAt,
    status: value.status,
    title: value.title,
    updatedAt: value.updatedAt,
  });

  const syncTaskRuntime = async (value: TaskRecord) => {
    if (RUNNING_TASK_STATUSES.has(value.status)) {
      await Sandbox.resumeTask(value.id).match(
        () => {},
        () => {},
      );
    }

    return (await findTask(value.id)) ?? value;
  };

  const syncTaskSummaryRuntime = async (value: TaskSummaryRecord) =>
    pickTaskSummary(await syncTaskRuntime(value as TaskRecord));

  const buildTaskDetail = async (taskId: string): Promise<TaskDetailRecord> => {
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
        ? db
            .select(taskSummarySelection)
            .from(task)
            .where(eq(task.id, taskRecord.parentTaskId))
            .then((rows) => rows[0] ?? null)
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

  const terminateTaskRecord = async (taskId: string) => {
    await Sandbox.terminateTask(taskId).match(
      () => {},
      () => {},
    );

    return (await findTask(taskId)) ?? (await updateTask(taskId, {}));
  };

  const assertParentCanSpawn = async (parentTask: TaskRecord, projectRecord: ProjectRecord) => {
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

  export const createProjectForUser = (input: {
    name: string;
    repoId: string;
    userId: string;
  }): ResultAsync<ProjectRecord, Error> =>
    fromPromise(
      insertProject({
        id: crypto.randomUUID(),
        name: input.name,
        repoId: input.repoId,
        userId: input.userId,
      }),
    ).map((value) => {
      log.info("project created", { projectId: value.id });
      return value;
    });

  export const listProjectsForUser = (userId: string): ResultAsync<ProjectRecord[], Error> =>
    fromPromise(listProjects(userId));

  export const getProjectForUser = (
    projectId: string,
    userId: string,
  ): ResultAsync<
    ProjectRecord & {
      repoDefaultBranch: string | null;
      repoDescription: string | null;
      repoFullName: string | null;
      repoHtmlUrl: string | null;
    },
    Error
  > =>
    requireUserProject(projectId, userId).andThen((value) =>
      Github.getRepo(value.repoId).map((repo) => ({
        ...value,
        repoDefaultBranch: repo?.defaultBranch ?? null,
        repoDescription: repo?.description ?? null,
        repoFullName: repo?.fullName ?? null,
        repoHtmlUrl: repo?.htmlUrl ?? null,
      })),
    );

  export const deleteProjectForUser = (
    projectId: string,
    userId: string,
  ): ResultAsync<void, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => fromPromise(deleteProject(projectId)))
      .map(() => {
        log.info("project deleted", { projectId });
      });

  export const createTaskForUser = (input: {
    projectId: string;
    prompt: string;
    quickTask: boolean;
    sourceBranch: string;
    userId: string;
  }): ResultAsync<TaskRecord, Error> => {
    const op = log.child({ projectId: input.projectId, userId: input.userId });

    return requireUserProject(input.projectId, input.userId)
      .andThen((value) =>
        Sandbox.startTask(
          {
            prompt: input.prompt,
            quickTask: input.quickTask,
            repoId: value.repoId,
            sourceBranch: input.sourceBranch,
          },
          input.userId,
        ),
      )
      .andThen((draft) =>
        fromPromise(
          insertTask({
            branchName: draft.sourceBranch,
            id: draft.id,
            projectId: input.projectId,
            prompt: draft.prompt,
            quickTask: draft.quickTask,
            repoId: draft.repoId,
            sandboxStatus: "pending",
            stage: draft.stage,
            startedAt: new Date(draft.startedAt),
            status: draft.status,
            title: buildTaskTitle(draft.prompt),
          }),
        ).andThen((createdTask) =>
          Sandbox.enqueueTaskMessage(createdTask.id, draft.prompt, "initial").map(
            () => createdTask,
          ),
        ),
      )
      .map((value) => {
        op.info("task created", { taskId: value.id });
        return value;
      });
  };

  export const createChildTaskForTask = (input: {
    model?: string | null;
    parentTaskId: string;
    prompt: string;
    title: string;
  }): ResultAsync<TaskRecord, Error> =>
    fromPromise(findTaskWithProject(input.parentTaskId)).andThen((value) => {
      if (!value) {
        return errAsync(new Error("Parent task not found."));
      }

      const parentTask = value.task;
      const branchName = parentTask.branchName ?? "main";
      const childRepoId = parentTask.repoId ?? value.project.repoId;

      return fromPromise(assertParentCanSpawn(parentTask, value.project)).andThen(() =>
        Sandbox.startTask(
          {
            prompt: input.prompt,
            quickTask: false,
            repoId: childRepoId,
            sourceBranch: branchName,
          },
          value.project.userId,
        ).andThen((draft) =>
          fromPromise(
            insertTask({
              branchName,
              id: draft.id,
              opencodeModel: input.model ?? null,
              parentTaskId: input.parentTaskId,
              projectId: parentTask.projectId,
              prompt: input.prompt,
              quickTask: false,
              repoId: childRepoId,
              sandboxStatus: "pending",
              spawnDepth: parentTask.spawnDepth + 1,
              spawnSource: "agent",
              stage: input.title.trim() ? `Queued child task: ${input.title.trim()}` : draft.stage,
              startedAt: new Date(draft.startedAt),
              status: draft.status,
              title: input.title.trim() || buildTaskTitle(input.prompt),
            }),
          ).andThen((createdTask) =>
            Sandbox.enqueueTaskMessage(createdTask.id, input.prompt, "initial").andThen(() =>
              fromPromise(
                SandboxEvents.publish({
                  payload: {
                    childTaskId: createdTask.id,
                    parentTaskId: input.parentTaskId,
                    sandboxStatus: createdTask.sandboxStatus,
                    stage: createdTask.stage,
                    status: createdTask.status,
                    title: createdTask.title,
                  },
                  taskId: input.parentTaskId,
                  type: "child_task_update",
                }),
              ).map(() => createdTask),
            ),
          ),
        ),
      );
    });

  export const listTasksForProject = (
    projectId: string,
    userId: string,
  ): ResultAsync<TaskRecord[], Error> =>
    requireUserProject(projectId, userId).andThen(() => fromPromise(listProjectTasks(projectId)));

  export const listChildTasksForUser = (
    parentTaskId: string,
    userId: string,
  ): ResultAsync<TaskSummaryRecord[], Error> =>
    requireTaskForUser(parentTaskId, userId).andThen(() =>
      fromPromise(listChildTaskSummaries(parentTaskId)),
    );

  export const getTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen((value) => fromPromise(syncTaskRuntime(value)));

  export const deleteTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<void, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen((value) => {
        if (RUNNING_TASK_STATUSES.has(value.status)) {
          return errAsync(new Error("Running sessions cannot be removed."));
        }

        return fromPromise(deleteTask(taskId, projectId));
      })
      .map(() => {
        log.info("task deleted", { projectId, taskId });
      });

  export const terminateTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen(() => fromPromise(terminateTaskRecord(taskId)))
      .map((value) => {
        log.info("task terminated", { projectId, taskId });
        return value;
      });

  export const getTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskDetailRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      fromPromise(syncTaskRuntime(value)).andThen((latest) =>
        fromPromise(buildTaskDetail(latest.id)),
      ),
    );

  export const getTaskRuntimeById = (taskId: string): ResultAsync<TaskRecord, Error> =>
    fromPromise(findTask(taskId)).andThen((task) =>
      task ? okAsync(task) : errAsync(new Error("Task not found.")),
    );

  export const terminateTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(() =>
      fromPromise(terminateTaskRecord(taskId)).map((value) => {
        log.info("task terminated by user", { taskId });
        return value;
      }),
    );

  export const terminateQuickTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) => {
      if (!value.quickTask) {
        return errAsync(new Error("This action is only available for quick tasks."));
      }

      return fromPromise(
        (async () => {
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
        })(),
      ).map((updated) => {
        log.info("quick task terminated", { taskId });
        return updated;
      });
    });

  export const destroyTaskSandboxForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      fromPromise(
        (async () => {
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
        })(),
      ),
    );

  export const runTaskFollowUpForUser = (
    taskId: string,
    prompt: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) => {
      if (value.quickTask) {
        return errAsync(new Error("Quick tasks are read-only."));
      }

      return fromPromise(
        (async () => {
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
        })(),
      ).map((updated) => {
        log.info("follow-up queued", { taskId });
        return updated;
      });
    });

  export const listAllTasksForUser = (userId: string): ResultAsync<TaskRecord[], Error> =>
    fromPromise(listProjectIds(userId)).andThen((ids) => {
      if (ids.length === 0) {
        return okAsync([] as TaskRecord[]);
      }

      const projectIds = R.map(ids, R.prop("id"));

      return fromPromise(listUserTasks(projectIds)).andThen((values) =>
        fromPromise(
          Promise.all(
            R.map(values, (value) =>
              RUNNING_TASK_STATUSES.has(value.status) ? syncTaskRuntime(value) : value,
            ),
          ),
        ),
      );
    });

  export const listAllTaskSummariesForUser = (
    userId: string,
  ): ResultAsync<TaskSummaryRecord[], Error> =>
    fromPromise(listProjectIds(userId)).andThen((ids) => {
      if (ids.length === 0) {
        return okAsync([] as TaskSummaryRecord[]);
      }

      const projectIds = R.map(ids, R.prop("id"));

      return fromPromise(listUserTaskSummaries(projectIds)).andThen((values) =>
        fromPromise(
          Promise.all(
            R.map(values, (value) =>
              RUNNING_TASK_STATUSES.has(value.status) ? syncTaskSummaryRuntime(value) : value,
            ),
          ),
        ),
      );
    });
}
