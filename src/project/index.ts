import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import * as R from "remeda";

import { BusEvent } from "@/bus/event";
import { db } from "@/db/db";
import { makeRunPromise } from "@/effect/runtime";
import { NamedError } from "@/error";
import { Github } from "@/github";
import { ProjectTable, TaskMessageTable, TaskTable } from "@/project/project.sql";
import { ProjectID, TaskID } from "@/project/schema";
import { Sandbox } from "@/sandbox";
import { listTaskMessages } from "@/sandbox/store";
import { Log } from "@/util/log";
import { fromPromise, unwrap } from "@/util/result";

const log = Log.create({ service: "project" });

export namespace Project {
  export type ProjectRecord = typeof ProjectTable.$inferSelect;
  export type TaskRecord = typeof TaskTable.$inferSelect;
  export type TaskMessageRecord = typeof TaskMessageTable.$inferSelect;
  export type TaskDetailRecord = TaskRecord & { messages: TaskMessageRecord[] };

  export type TaskSummaryRecord = Pick<TaskRecord, TaskSummaryKey>;
  export type TaskForUserRecord = {
    project: ProjectRecord;
    task: TaskRecord;
  };

  export const Event = {
    ProjectCreated: BusEvent.define("project.created", ProjectID.zod),
    TaskCreated: BusEvent.define("task.created", TaskID.zod),
  };

  export const NotFoundError = NamedError.create(
    "ProjectNotFoundError",
    ProjectID.zod.transform((id) => ({ id })),
  );

  const RUNNING_TASK_STATUSES = new Set(["queued", "running"]);

  const taskSummarySelection = {
    branchName: TaskTable.branchName,
    completedAt: TaskTable.completedAt,
    createdAt: TaskTable.createdAt,
    id: TaskTable.id,
    projectId: TaskTable.projectId,
    prompt: TaskTable.prompt,
    quickTask: TaskTable.quickTask,
    repoName: TaskTable.repoName,
    sandboxId: TaskTable.sandboxId,
    stage: TaskTable.stage,
    startedAt: TaskTable.startedAt,
    status: TaskTable.status,
    updatedAt: TaskTable.updatedAt,
  } as const;

  type TaskSummaryKey = keyof typeof taskSummarySelection;

  const insertProject = (input: { id: string; name: string; repoId: string; userId: string }) =>
    db
      .insert(ProjectTable)
      .values(input)
      .returning()
      .then((rows) => rows[0]);

  const deleteProject = (projectId: string) =>
    db.delete(ProjectTable).where(eq(ProjectTable.id, projectId));

  const findProject = (projectId: string, userId: string) =>
    db
      .select()
      .from(ProjectTable)
      .where(and(eq(ProjectTable.id, projectId), eq(ProjectTable.userId, userId)))
      .then((rows) => rows[0]);

  const listProjects = (userId: string) =>
    db
      .select()
      .from(ProjectTable)
      .where(eq(ProjectTable.userId, userId))
      .orderBy(desc(ProjectTable.createdAt));

  const listProjectIds = (userId: string) =>
    db.select({ id: ProjectTable.id }).from(ProjectTable).where(eq(ProjectTable.userId, userId));

  const insertTask = (input: {
    branchName: string;
    id: string;
    opencodeModel?: string | null;
    parentTaskId?: string | null;
    projectId: string;
    prompt: string;
    quickTask: boolean;
    repoId: string;
    spawnSource?: string;
    stage: string;
    startedAt: Date;
    status: string;
  }) =>
    db
      .insert(TaskTable)
      .values(input)
      .returning()
      .then((rows) => rows[0]);

  const deleteTask = (taskId: string, projectId: string) =>
    db.delete(TaskTable).where(and(eq(TaskTable.id, taskId), eq(TaskTable.projectId, projectId)));

  const findTask = (taskId: string) =>
    db
      .select()
      .from(TaskTable)
      .where(eq(TaskTable.id, taskId))
      .then((rows) => rows[0]);

  const findTaskWithProject = (taskId: string) =>
    db
      .select()
      .from(TaskTable)
      .innerJoin(ProjectTable, eq(TaskTable.projectId, ProjectTable.id))
      .where(eq(TaskTable.id, taskId))
      .then((rows) => rows[0] as TaskForUserRecord | undefined);

  const findProjectTask = (taskId: string, projectId: string) =>
    db
      .select()
      .from(TaskTable)
      .where(and(eq(TaskTable.id, taskId), eq(TaskTable.projectId, projectId)))
      .then((rows) => rows[0]);

  const findUserTask = (taskId: string, userId: string) =>
    db
      .select()
      .from(TaskTable)
      .innerJoin(ProjectTable, eq(TaskTable.projectId, ProjectTable.id))
      .where(and(eq(TaskTable.id, taskId), eq(ProjectTable.userId, userId)))
      .then((rows) => rows[0] as TaskForUserRecord | undefined);

  const listProjectTasks = (projectId: string) =>
    db
      .select()
      .from(TaskTable)
      .where(eq(TaskTable.projectId, projectId))
      .orderBy(desc(TaskTable.createdAt));

  const listUserTasks = (projectIds: string[]) =>
    db
      .select()
      .from(TaskTable)
      .where(inArray(TaskTable.projectId, projectIds))
      .orderBy(desc(TaskTable.startedAt));

  const listUserTaskSummaries = (projectIds: string[]) =>
    db
      .select(taskSummarySelection)
      .from(TaskTable)
      .where(inArray(TaskTable.projectId, projectIds))
      .orderBy(desc(TaskTable.startedAt));

  const updateTask = (taskId: string, values: Partial<TaskRecord>) =>
    db
      .update(TaskTable)
      .set(values)
      .where(eq(TaskTable.id, taskId))
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
    projectId: value.projectId,
    prompt: value.prompt,
    quickTask: value.quickTask,
    repoName: value.repoName,
    sandboxId: value.sandboxId,
    stage: value.stage,
    startedAt: value.startedAt,
    status: value.status,
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

  const buildTaskDetail = async (taskId: string) => {
    const [taskRecord, messages] = await Promise.all([findTask(taskId), listTaskMessages(taskId)]);

    if (!taskRecord) {
      throw new Error("Task not found.");
    }

    return {
      ...taskRecord,
      messages,
    };
  };

  const terminateTaskRecord = async (taskId: string) => {
    await Sandbox.terminateTask(taskId).match(
      () => {},
      () => {},
    );

    return (await findTask(taskId)) ?? (await updateTask(taskId, {}));
  };

  export const createProjectForUser = (input: {
    name: string;
    repoId: string;
    userId: string;
  }): ResultAsync<ProjectRecord, Error> =>
    fromPromise(
      insertProject({
        id: ProjectID.descending(),
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
            stage: draft.stage,
            startedAt: new Date(draft.startedAt),
            status: draft.status,
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

      return Sandbox.startTask(
        {
          prompt: input.prompt,
          quickTask: false,
          repoId: parentTask.repoId ?? value.project.repoId,
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
            repoId: draft.repoId,
            spawnSource: "agent",
            stage: input.title.trim() ? `Queued child task: ${input.title.trim()}` : draft.stage,
            startedAt: new Date(draft.startedAt),
            status: draft.status,
          }),
        ).andThen((createdTask) =>
          Sandbox.enqueueTaskMessage(createdTask.id, input.prompt, "initial").map(
            () => createdTask,
          ),
        ),
      );
    });

  export const listTasksForProject = (
    projectId: string,
    userId: string,
  ): ResultAsync<TaskRecord[], Error> =>
    requireUserProject(projectId, userId).andThen(() => fromPromise(listProjectTasks(projectId)));

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

  export interface Interface {
    readonly createProject: (
      input: Parameters<typeof createProjectForUser>[0],
    ) => Effect.Effect<ProjectRecord, Error>;
    readonly getTaskDetail: (
      taskId: string,
      userId: string,
    ) => Effect.Effect<TaskDetailRecord, Error>;
  }

  export class Service extends Effect.Service<Service>()("@app/Project", {
    succeed: {
      createProject: (input: Parameters<typeof createProjectForUser>[0]) =>
        Effect.promise(() => unwrap(createProjectForUser(input))),
      getTaskDetail: (taskId: string, userId: string) =>
        Effect.promise(() => unwrap(getTaskForUser(taskId, userId))),
    },
  }) {}

  export const layer = Service.Default;

  const run = makeRunPromise(Service, layer);

  export async function create(input: Parameters<typeof createProjectForUser>[0]) {
    return run((service) => service.createProject(input));
  }

  export async function getDetail(taskId: string, userId: string) {
    return run((service) => service.getTaskDetail(taskId, userId));
  }
}
