import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { getRepoTaskJob, startRepoTaskJob, terminateRepoTaskJob } from "@/lib/daytona/server";
import { db } from "@/lib/db";
import { project, task } from "@/lib/db/schema";
import { getSignedInGithubRepo } from "@/lib/github/server";

const createProjectInputSchema = z.object({
  name: z.string().min(1),
  repoId: z.string().min(1),
});

const projectIdInputSchema = z.object({
  projectId: z.string().min(1),
});

const createTaskInputSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(10),
});

const getTaskInputSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});

const requireUserProject = async (projectId: string, userId: string) => {
  const row = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .then((rows) => rows[0]);

  if (!row) {
    throw new Error("Project not found.");
  }

  return row;
};

export const $createProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createProjectInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const [inserted] = await db
      .insert(project)
      .values({
        id: crypto.randomUUID(),
        name: data.name,
        repoId: data.repoId,
        userId: context.user.id,
      })
      .returning();

    return inserted;
  });

export const $listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return db
      .select()
      .from(project)
      .where(eq(project.userId, context.user.id))
      .orderBy(desc(project.createdAt));
  });

export const $getProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const proj = await requireUserProject(data.projectId, context.user.id);
    const repo = await getSignedInGithubRepo(proj.repoId);

    return {
      ...proj,
      repoFullName: repo?.fullName ?? null,
      repoDescription: repo?.description ?? null,
      repoHtmlUrl: repo?.htmlUrl ?? null,
    };
  });

export const $createTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const proj = await requireUserProject(data.projectId, context.user.id);

    const job = await startRepoTaskJob({ prompt: data.prompt, repoId: proj.repoId });

    const [inserted] = await db
      .insert(task)
      .values({
        id: job.id,
        projectId: data.projectId,
        prompt: job.prompt,
        status: job.status,
        stage: job.stage,
        repoId: job.repoId,
        startedAt: new Date(job.startedAt),
      })
      .returning();

    return inserted;
  });

export const $listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireUserProject(data.projectId, context.user.id);

    return db
      .select()
      .from(task)
      .where(eq(task.projectId, data.projectId))
      .orderBy(desc(task.createdAt));
  });

export const $getTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireUserProject(data.projectId, context.user.id);

    const row = await db
      .select()
      .from(task)
      .where(and(eq(task.id, data.taskId), eq(task.projectId, data.projectId)))
      .then((rows) => rows[0]);

    if (!row) {
      throw new Error("Task not found.");
    }

    try {
      const job = await getRepoTaskJob(row.id);

      const [updated] = await db
        .update(task)
        .set({
          status: job.status,
          stage: job.stage,
          logs: job.logs,
          error: job.error,
          completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
          branchName: job.branchName,
          clonePath: job.clonePath,
          sandboxId: job.sandboxId,
          repoName: job.repoName,
          prUrl: job.prUrl,
          prNumber: job.prNumber,
        })
        .where(eq(task.id, row.id))
        .returning();

      return updated;
    } catch {
      return row;
    }
  });

export const $deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireUserProject(data.projectId, context.user.id);
    await db.delete(project).where(eq(project.id, data.projectId));
  });

export const $deleteTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireUserProject(data.projectId, context.user.id);
    await db.delete(task).where(and(eq(task.id, data.taskId), eq(task.projectId, data.projectId)));
  });

export const $terminateTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await requireUserProject(data.projectId, context.user.id);

    const row = await db
      .select()
      .from(task)
      .where(and(eq(task.id, data.taskId), eq(task.projectId, data.projectId)))
      .then((rows) => rows[0]);

    if (!row) {
      throw new Error("Task not found.");
    }

    try {
      await terminateRepoTaskJob(row.id);
    } catch {}

    const [updated] = await db
      .update(task)
      .set({
        status: "failed",
        stage: "Terminated",
        error: "Task was terminated by user.",
        completedAt: new Date(),
      })
      .where(eq(task.id, row.id))
      .returning();

    return updated;
  });

const taskIdInputSchema = z.object({
  taskId: z.string().min(1),
});

export const $getTaskById = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const row = await db
      .select()
      .from(task)
      .innerJoin(project, eq(task.projectId, project.id))
      .where(and(eq(task.id, data.taskId), eq(project.userId, context.user.id)))
      .then((rows) => rows[0]);

    if (!row) {
      throw new Error("Task not found.");
    }

    try {
      const job = await getRepoTaskJob(row.task.id);

      const [updated] = await db
        .update(task)
        .set({
          status: job.status,
          stage: job.stage,
          logs: job.logs,
          error: job.error,
          completedAt: job.completedAt ? new Date(job.completedAt) : undefined,
          branchName: job.branchName,
          clonePath: job.clonePath,
          sandboxId: job.sandboxId,
          repoName: job.repoName,
          prUrl: job.prUrl,
          prNumber: job.prNumber,
        })
        .where(eq(task.id, row.task.id))
        .returning();

      return updated;
    } catch {
      return row.task;
    }
  });

export const $terminateTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const row = await db
      .select()
      .from(task)
      .innerJoin(project, eq(task.projectId, project.id))
      .where(and(eq(task.id, data.taskId), eq(project.userId, context.user.id)))
      .then((rows) => rows[0]);

    if (!row) {
      throw new Error("Task not found.");
    }

    try {
      await terminateRepoTaskJob(row.task.id);
    } catch {}

    const [updated] = await db
      .update(task)
      .set({
        status: "failed",
        stage: "Terminated",
        error: "Task was terminated by user.",
        completedAt: new Date(),
      })
      .where(eq(task.id, row.task.id))
      .returning();

    return updated;
  });

export const $listAllUserTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const userProjects = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.userId, context.user.id));

    if (userProjects.length === 0) {
      return [];
    }

    return db
      .select()
      .from(task)
      .where(
        inArray(
          task.projectId,
          userProjects.map((p) => p.id),
        ),
      )
      .orderBy(desc(task.startedAt));
  });
