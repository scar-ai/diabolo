import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { Github } from "@/lib/github";
import { Sandbox } from "@/lib/sandbox";

import { project, task } from "./project.sql";

export type ProjectId = string & { __brand: "ProjectId" };
export type TaskId = string & { __brand: "TaskId" };

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
  // Internal helpers
  // ---------------------------------------------------------------------------

  const requireUserProject = async (projectId: string, userId: string) => {
    const result = await findProject(projectId, userId);

    if (!result) {
      throw new Error("Project not found.");
    }

    return result;
  };

  const requireTaskForProject = async (projectId: string, taskId: string) => {
    const result = await findProjectTask(taskId, projectId);

    if (!result) {
      throw new Error("Task not found.");
    }

    return result;
  };

  const requireTaskForUser = async (taskId: string, userId: string) => {
    const result = await findUserTask(taskId, userId);

    if (!result) {
      throw new Error("Task not found.");
    }

    return result;
  };

  const toSerializedJobPatch = (job: Awaited<ReturnType<typeof Sandbox.getTask>>) => ({
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
    try {
      const job = await Sandbox.getTask(t.id, userId);
      return updateTask(t.id, toSerializedJobPatch(job));
    } catch {
      if (!RUNNING_TASK_STATUSES.has(t.status)) {
        return t;
      }

      return updateTask(t.id, {
        completedAt: new Date(),
        error: "Task worker was not available. Start the task again.",
        stage: "Task failed",
        status: "failed",
      });
    }
  };

  const syncTaskSummaryWithJob = async (t: TaskSummaryRecord, userId?: string) =>
    pickTaskSummary(await syncTaskWithJob(t as TaskRecord, userId));

  const terminateTaskRecord = async (taskId: string) => {
    try {
      await Sandbox.terminateTask(taskId);
    } catch {}

    return updateTask(taskId, {
      completedAt: new Date(),
      error: "Task was terminated by user.",
      stage: "Terminated",
      status: "failed",
    });
  };

  // ---------------------------------------------------------------------------
  // Exported service functions
  // ---------------------------------------------------------------------------

  export const createProjectForUser = (input: { name: string; repoId: string; userId: string }) =>
    insertProject({
      id: crypto.randomUUID(),
      name: input.name,
      repoId: input.repoId,
      userId: input.userId,
    });

  export const listProjectsForUser = (userId: string) => listProjects(userId);

  export const getProjectForUser = async (projectId: string, userId: string) => {
    const p = await requireUserProject(projectId, userId);
    const repo = await Github.getRepo(p.repoId);

    return {
      ...p,
      repoDefaultBranch: repo?.defaultBranch ?? null,
      repoDescription: repo?.description ?? null,
      repoFullName: repo?.fullName ?? null,
      repoHtmlUrl: repo?.htmlUrl ?? null,
    };
  };

  export const deleteProjectForUser = async (projectId: string, userId: string) => {
    await requireUserProject(projectId, userId);
    await deleteProject(projectId);
  };

  export const createTaskForUser = async (input: {
    projectId: string;
    prompt: string;
    quickTask: boolean;
    sourceBranch: string;
    userId: string;
  }) => {
    const p = await requireUserProject(input.projectId, input.userId);

    const job = await Sandbox.startTask(
      {
        prompt: input.prompt,
        quickTask: input.quickTask,
        repoId: p.repoId,
        sourceBranch: input.sourceBranch,
      },
      input.userId,
    );

    return insertTask({
      branchName: job.sourceBranch,
      id: job.id,
      projectId: input.projectId,
      prompt: job.prompt,
      quickTask: job.quickTask,
      repoId: job.repoId,
      stage: job.stage,
      startedAt: new Date(job.startedAt),
      status: job.status,
    });
  };

  export const listTasksForProject = async (projectId: string, userId: string) => {
    await requireUserProject(projectId, userId);
    return listProjectTasks(projectId);
  };

  export const getTaskForProject = async (projectId: string, taskId: string, userId: string) => {
    await requireUserProject(projectId, userId);
    return syncTaskWithJob(await requireTaskForProject(projectId, taskId), userId);
  };

  export const deleteTaskForProject = async (projectId: string, taskId: string, userId: string) => {
    await requireUserProject(projectId, userId);

    const t = await requireTaskForProject(projectId, taskId);

    if (RUNNING_TASK_STATUSES.has(t.status)) {
      throw new Error("Running sessions cannot be removed.");
    }

    await deleteTask(taskId, projectId);
  };

  export const terminateTaskForProject = async (
    projectId: string,
    taskId: string,
    userId: string,
  ) => {
    await requireUserProject(projectId, userId);
    await requireTaskForProject(projectId, taskId);
    return terminateTaskRecord(taskId);
  };

  export const getTaskForUser = async (taskId: string, userId: string) => {
    const { task: t } = await requireTaskForUser(taskId, userId);
    return syncTaskWithJob(t, userId);
  };

  export const terminateTaskForUser = async (taskId: string, userId: string) => {
    const { task: t } = await requireTaskForUser(taskId, userId);
    return terminateTaskRecord(t.id);
  };

  export const terminateQuickTaskForUser = async (taskId: string, userId: string) => {
    const { task: t } = await requireTaskForUser(taskId, userId);

    if (!t.quickTask) {
      throw new Error("This action is only available for quick tasks.");
    }

    try {
      await Sandbox.terminateTask(t.id);
    } catch {}

    if (t.sandboxId) {
      try {
        await Sandbox.destroySandbox(t.sandboxId);
      } catch {}
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
  };

  export const destroyTaskSandboxForUser = async (taskId: string, userId: string) => {
    const { task: t } = await requireTaskForUser(taskId, userId);

    if (t.sandboxId) {
      await Sandbox.destroySandbox(t.sandboxId);
    }

    return updateTask(t.id, {
      sandboxId: null,
      sandboxName: null,
      sandboxPath: null,
      stage: "Sandbox stopped",
    });
  };

  export const runTaskFollowUpForUser = async (taskId: string, prompt: string, userId: string) => {
    const { task: t } = await requireTaskForUser(taskId, userId);

    if (t.quickTask) {
      throw new Error("Quick tasks are read-only.");
    }

    await updateTask(t.id, {
      stage: "Running follow-up task",
      status: "running",
    });

    await Sandbox.runTaskFollowUp(t.id, prompt.trim(), userId);

    const latestTask = await findTask(t.id);

    if (!latestTask) {
      throw new Error("Task not found.");
    }

    return syncTaskWithJob(latestTask, userId);
  };

  export const listAllTasksForUser = async (userId: string) => {
    const projectIds = await listProjectIds(userId);

    if (projectIds.length === 0) {
      return [];
    }

    const tasks = await listUserTasks(projectIds.map(({ id }) => id));

    return Promise.all(
      tasks.map((t) => (RUNNING_TASK_STATUSES.has(t.status) ? syncTaskWithJob(t, userId) : t)),
    );
  };

  export const listAllTaskSummariesForUser = async (userId: string) => {
    const projectIds = await listProjectIds(userId);

    if (projectIds.length === 0) {
      return [];
    }

    const tasks = await listUserTaskSummaries(projectIds.map(({ id }) => id));

    return Promise.all(
      tasks.map((t) =>
        RUNNING_TASK_STATUSES.has(t.status) ? syncTaskSummaryWithJob(t, userId) : t,
      ),
    );
  };
}
