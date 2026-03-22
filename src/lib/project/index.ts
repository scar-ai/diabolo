import { and, desc, eq, inArray } from "drizzle-orm";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import * as R from "remeda";

import { db } from "@/lib/db";
import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { fromPromise, toError } from "@/lib/result";
import { Sandbox } from "@/lib/sandbox";

import { project, task } from "./project.sql";

export type ProjectId = string & { __brand: "ProjectId" };
export type TaskId = string & { __brand: "TaskId" };

const log = Log.create({ ns: "project" });

export namespace Project {
  export type ProjectRecord = typeof project.$inferSelect;
  export type TaskRecord = typeof task.$inferSelect;

  export type TaskSummaryRecord = Pick<TaskRecord, TaskSummaryKey>;
  export type TaskForUserRecord = {
    project: ProjectRecord;
    task: TaskRecord;
  };

  // ---------------------------------------------------------------------------
  // Internal constants
  // ---------------------------------------------------------------------------

  const RUNNING_TASK_STATUSES = new Set(["queued", "running"]);

  const TASK_SUMMARY_KEYS = [
    "branchName",
    "completedAt",
    "createdAt",
    "id",
    "projectId",
    "prompt",
    "quickTask",
    "repoName",
    "sandboxId",
    "stage",
    "startedAt",
    "status",
    "updatedAt",
  ] as const;

  const taskSummarySelection = {
    branchName: task.branchName,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    id: task.id,
    projectId: task.projectId,
    prompt: task.prompt,
    quickTask: task.quickTask,
    repoName: task.repoName,
    sandboxId: task.sandboxId,
    stage: task.stage,
    startedAt: task.startedAt,
    status: task.status,
    updatedAt: task.updatedAt,
  } as const;

  type TaskSummaryKey = keyof typeof taskSummarySelection;

  // ---------------------------------------------------------------------------
  // Internal DB queries
  // ---------------------------------------------------------------------------

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
    projectId: string;
    prompt: string;
    quickTask: boolean;
    repoId: string;
    stage: string;
    startedAt: Date;
    status: string;
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

  // ---------------------------------------------------------------------------
  // Internal helpers — ResultAsync guards
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Internal helpers — serialization
  // ---------------------------------------------------------------------------

  const toSerializedJobPatch = (job: Sandbox.TaskJob) => ({
    agentMessages: job.agentMessages.length > 0 ? JSON.stringify(job.agentMessages) : null,
    branchName: job.branchName ?? job.sourceBranch ?? null,
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
    error: job.error ?? null,
    followUpHistory: job.followUpHistory.length > 0 ? JSON.stringify(job.followUpHistory) : null,
    logs: job.logs ?? null,
    prNumber: job.prNumber ?? null,
    prUrl: job.prUrl ?? null,
    repoName: job.repoName ?? null,
    repoUrl: job.repoUrl ?? null,
    sandboxId: job.sandboxId ?? null,
    sandboxName: job.sandboxName ?? null,
    sandboxPath: job.sandboxPath ?? null,
    stage: job.stage,
    status: job.status,
  });

  const pickTaskSummary = (t: TaskRecord): TaskSummaryRecord => ({
    branchName: t.branchName,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    id: t.id,
    projectId: t.projectId,
    prompt: t.prompt,
    quickTask: t.quickTask,
    repoName: t.repoName,
    sandboxId: t.sandboxId,
    stage: t.stage,
    startedAt: t.startedAt,
    status: t.status,
    updatedAt: t.updatedAt,
  });

  const syncTaskWithJob = async (t: TaskRecord, userId?: string) => {
    const result = await Sandbox.getTask(t.id, userId);

    if (result.isErr()) {
      if (!RUNNING_TASK_STATUSES.has(t.status)) return t;

      return updateTask(t.id, {
        completedAt: new Date(),
        error: "Task worker was not available. Start the task again.",
        stage: "Task failed",
        status: "failed",
      });
    }

    return updateTask(t.id, toSerializedJobPatch(result.value));
  };

  const syncTaskSummaryWithJob = async (t: TaskSummaryRecord, userId?: string) =>
    pickTaskSummary(await syncTaskWithJob(t as TaskRecord, userId));

  const terminateTaskRecord = async (taskId: string) => {
    await Sandbox.terminateTask(taskId).match(
      () => {},
      () => {},
    );

    return updateTask(taskId, {
      completedAt: new Date(),
      error: "Task was terminated by user.",
      stage: "Terminated",
      status: "failed",
    });
  };

  // ---------------------------------------------------------------------------
  // Exported service functions — all return ResultAsync
  // ---------------------------------------------------------------------------

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
    ).map((p) => {
      log.info("project created", { projectId: p.id });
      return p;
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
    requireUserProject(projectId, userId).andThen((p) =>
      Github.getRepo(p.repoId).map((repo) => ({
        ...p,
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
      .andThen((p) =>
        Sandbox.startTask(
          {
            prompt: input.prompt,
            quickTask: input.quickTask,
            repoId: p.repoId,
            sourceBranch: input.sourceBranch,
          },
          input.userId,
        ),
      )
      .andThen((job) =>
        fromPromise(
          insertTask({
            branchName: job.sourceBranch,
            id: job.id,
            projectId: input.projectId,
            prompt: job.prompt,
            quickTask: job.quickTask,
            repoId: job.repoId,
            stage: job.stage,
            startedAt: new Date(job.startedAt),
            status: job.status,
          }),
        ),
      )
      .map((t) => {
        op.info("task created", { taskId: t.id });
        return t;
      });
  };

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
      .andThen((t) => fromPromise(syncTaskWithJob(t, userId)));

  export const deleteTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<void, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen((t) => {
        if (RUNNING_TASK_STATUSES.has(t.status)) {
          return errAsync(new Error("Running sessions cannot be removed."));
        }
        return fromPromise(deleteTask(taskId, projectId));
      })
      .map(() => {
        log.info("task deleted", { taskId, projectId });
      });

  export const terminateTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen(() => fromPromise(terminateTaskRecord(taskId)))
      .map((t) => {
        log.info("task terminated", { taskId, projectId });
        return t;
      });

  export const getTaskForUser = (taskId: string, userId: string): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: t }) =>
      fromPromise(syncTaskWithJob(t, userId)),
    );

  export const terminateTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: t }) =>
      fromPromise(terminateTaskRecord(t.id)).map((updated) => {
        log.info("task terminated by user", { taskId });
        return updated;
      }),
    );

  export const terminateQuickTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: t }) => {
      if (!t.quickTask) {
        return errAsync(new Error("This action is only available for quick tasks."));
      }

      return fromPromise(
        (async () => {
          await Sandbox.terminateTask(t.id).match(
            () => {},
            () => {},
          );

          if (t.sandboxId) {
            await Sandbox.destroySandbox(t.sandboxId).match(
              () => {},
              () => {},
            );
          }

          return updateTask(t.id, {
            completedAt: new Date(),
            error: "Quick task was stopped by user.",
            sandboxId: null,
            sandboxName: null,
            sandboxPath: null,
            stage: "Quick task stopped",
            status: "failed",
          });
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
    requireTaskForUser(taskId, userId).andThen(({ task: t }) =>
      fromPromise(
        (async () => {
          if (t.sandboxId) {
            await Sandbox.destroySandbox(t.sandboxId).match(
              () => {},
              () => {},
            );
          }

          return updateTask(t.id, {
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
    requireTaskForUser(taskId, userId).andThen(({ task: t }) => {
      if (t.quickTask) {
        return errAsync(new Error("Quick tasks are read-only."));
      }

      return fromPromise(
        (async () => {
          await updateTask(t.id, {
            stage: "Running follow-up task",
            status: "running",
          });

          await Sandbox.runTaskFollowUp(t.id, prompt.trim(), userId).match(
            () => {},
            (e) => {
              throw e;
            },
          );

          const latest = await findTask(t.id);
          if (!latest) throw new Error("Task not found.");

          return syncTaskWithJob(latest, userId);
        })(),
      ).map((updated) => {
        log.info("follow-up completed", { taskId });
        return updated;
      });
    });

  export const listAllTasksForUser = (userId: string): ResultAsync<TaskRecord[], Error> =>
    fromPromise(listProjectIds(userId)).andThen((ids) => {
      if (ids.length === 0) return okAsync([] as TaskRecord[]);

      const projectIds = R.map(ids, R.prop("id"));

      return fromPromise(listUserTasks(projectIds)).andThen((tasks) =>
        fromPromise(
          Promise.all(
            R.map(tasks, (t) =>
              RUNNING_TASK_STATUSES.has(t.status) ? syncTaskWithJob(t, userId) : t,
            ),
          ),
        ),
      );
    });

  export const listAllTaskSummariesForUser = (
    userId: string,
  ): ResultAsync<TaskSummaryRecord[], Error> =>
    fromPromise(listProjectIds(userId)).andThen((ids) => {
      if (ids.length === 0) return okAsync([] as TaskSummaryRecord[]);

      const projectIds = R.map(ids, R.prop("id"));

      return fromPromise(listUserTaskSummaries(projectIds)).andThen((tasks) =>
        fromPromise(
          Promise.all(
            R.map(tasks, (t) =>
              RUNNING_TASK_STATUSES.has(t.status) ? syncTaskSummaryWithJob(t, userId) : t,
            ),
          ),
        ),
      );
    });
}
