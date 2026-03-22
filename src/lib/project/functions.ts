import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import {
  createProjectForUser,
  createTaskForUser,
  deleteProjectForUser,
  deleteTaskForProject,
  destroyTaskSandboxForUser,
  getProjectForUser,
  getTaskForProject,
  getTaskForUser,
  listAllTaskSummariesForUser,
  listAllTasksForUser,
  listProjectsForUser,
  listTasksForProject,
  runTaskFollowUpForUser,
  terminateQuickTaskForUser,
  terminateTaskForProject,
  terminateTaskForUser,
} from "@/lib/project/service";

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
    return createProjectForUser({ ...data, userId: context.user.id });
  });

export const $listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return listProjectsForUser(context.user.id);
  });

export const $getProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return getProjectForUser(data.projectId, context.user.id);
  });

export const $createTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return createTaskForUser({ ...data, userId: context.user.id });
  });

export const $listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return listTasksForProject(data.projectId, context.user.id);
  });

export const $getTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return getTaskForProject(data.projectId, data.taskId, context.user.id);
  });

export const $deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await deleteProjectForUser(data.projectId, context.user.id);
  });

export const $deleteTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await deleteTaskForProject(data.projectId, data.taskId, context.user.id);
  });

export const $terminateTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return terminateTaskForProject(data.projectId, data.taskId, context.user.id);
  });

const taskIdInputSchema = z.object({
  taskId: z.string().min(1),
});

export const $getTaskById = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return getTaskForUser(data.taskId, context.user.id);
  });

export const $terminateTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return terminateTaskForUser(data.taskId, context.user.id);
  });

export const $terminateQuickTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return terminateQuickTaskForUser(data.taskId, context.user.id);
  });

export const $listAllUserTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return listAllTasksForUser(context.user.id);
  });

export const $listAllUserTaskSummaries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return listAllTaskSummariesForUser(context.user.id);
  });

const followUpInputSchema = z.object({
  prompt: z.string().min(10),
  taskId: z.string().min(1),
});

export const $destroyTaskSandboxById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return destroyTaskSandboxForUser(data.taskId, context.user.id);
  });

export const $runFollowUpById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => followUpInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    return runTaskFollowUpForUser(data.taskId, data.prompt, context.user.id);
  });
