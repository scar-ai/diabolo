import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { AuthMiddleware } from "@/auth/middleware";
import { Project } from "@/project";
import { unwrap } from "@/util/result";

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

const taskIdInputSchema = z.object({
  taskId: z.string().min(1),
});

const followUpInputSchema = z.object({
  prompt: z.string().min(10),
  taskId: z.string().min(1),
});

export namespace ProjectServer {
  export const $createProject = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => createProjectInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.createProjectForUser({ ...data, userId: context.user.id })),
    );

  export const $listProjects = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .handler(async ({ context }) => unwrap(Project.listProjectsForUser(context.user.id)));

  export const $getProject = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => projectIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.getProjectForUser(data.projectId, context.user.id)),
    );

  export const $createTask = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => createTaskInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.createTaskForUser({ ...data, userId: context.user.id })),
    );

  export const $listTasks = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => projectIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.listTasksForProject(data.projectId, context.user.id)),
    );

  export const $getTask = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => getTaskInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.getTaskForProject(data.projectId, data.taskId, context.user.id)),
    );

  export const $deleteProject = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => projectIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.deleteProjectForUser(data.projectId, context.user.id)),
    );

  export const $deleteTask = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => getTaskInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.deleteTaskForProject(data.projectId, data.taskId, context.user.id)),
    );

  export const $terminateTask = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => getTaskInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.terminateTaskForProject(data.projectId, data.taskId, context.user.id)),
    );

  export const $getTaskById = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => taskIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.getTaskForUser(data.taskId, context.user.id)),
    );

  export const $terminateTaskById = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => taskIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.terminateTaskForUser(data.taskId, context.user.id)),
    );

  export const $terminateQuickTaskById = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => taskIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.terminateQuickTaskForUser(data.taskId, context.user.id)),
    );

  export const $listAllUserTasks = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .handler(async ({ context }) => unwrap(Project.listAllTasksForUser(context.user.id)));

  export const $listAllUserTaskSummaries = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .handler(async ({ context }) => unwrap(Project.listAllTaskSummariesForUser(context.user.id)));

  export const $destroyTaskSandboxById = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => taskIdInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.destroyTaskSandboxForUser(data.taskId, context.user.id)),
    );

  export const $runFollowUpById = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => followUpInputSchema.parse(data))
    .handler(async ({ context, data }) =>
      unwrap(Project.runTaskFollowUpForUser(data.taskId, data.prompt, context.user.id)),
    );
}

export const $createProject = ProjectServer.$createProject;
export const $listProjects = ProjectServer.$listProjects;
export const $getProject = ProjectServer.$getProject;
export const $createTask = ProjectServer.$createTask;
export const $listTasks = ProjectServer.$listTasks;
export const $getTask = ProjectServer.$getTask;
export const $deleteProject = ProjectServer.$deleteProject;
export const $deleteTask = ProjectServer.$deleteTask;
export const $terminateTask = ProjectServer.$terminateTask;
export const $getTaskById = ProjectServer.$getTaskById;
export const $terminateTaskById = ProjectServer.$terminateTaskById;
export const $terminateQuickTaskById = ProjectServer.$terminateQuickTaskById;
export const $listAllUserTasks = ProjectServer.$listAllUserTasks;
export const $listAllUserTaskSummaries = ProjectServer.$listAllUserTaskSummaries;
export const $destroyTaskSandboxById = ProjectServer.$destroyTaskSandboxById;
export const $runFollowUpById = ProjectServer.$runFollowUpById;
