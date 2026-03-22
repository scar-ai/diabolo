import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { Project } from "@/lib/project";

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
  quickTask: z.boolean().optional().default(false),
  sourceBranch: z.string().min(1),
});

const getTaskInputSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});

export const $createProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createProjectInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.createProjectForUser({ ...data, userId: context.user.id });
  });

export const $listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return Project.listProjectsForUser(context.user.id);
  });

export const $getProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.getProjectForUser(data.projectId, context.user.id);
  });

export const $createTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.createTaskForUser({ ...data, userId: context.user.id });
  });

export const $listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.listTasksForProject(data.projectId, context.user.id);
  });

export const $getTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.getTaskForProject(data.projectId, data.taskId, context.user.id);
  });

export const $deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await Project.deleteProjectForUser(data.projectId, context.user.id);
  });

export const $deleteTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await Project.deleteTaskForProject(data.projectId, data.taskId, context.user.id);
  });

export const $terminateTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.terminateTaskForProject(data.projectId, data.taskId, context.user.id);
  });

const taskIdInputSchema = z.object({
  taskId: z.string().min(1),
});

export const $getTaskById = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.getTaskForUser(data.taskId, context.user.id);
  });

export const $terminateTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.terminateTaskForUser(data.taskId, context.user.id);
  });

export const $terminateQuickTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.terminateQuickTaskForUser(data.taskId, context.user.id);
  });

export const $listAllUserTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return Project.listAllTasksForUser(context.user.id);
  });

export const $listAllUserTaskSummaries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return Project.listAllTaskSummariesForUser(context.user.id);
  });

const followUpInputSchema = z.object({
  prompt: z.string().min(10),
  taskId: z.string().min(1),
});

export const $destroyTaskSandboxById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.destroyTaskSandboxForUser(data.taskId, context.user.id);
  });

export const $runFollowUpById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => followUpInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return Project.runTaskFollowUpForUser(data.taskId, data.prompt, context.user.id);
  });
