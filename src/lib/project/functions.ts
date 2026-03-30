import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { Project, ProjectMembers } from "@/lib/project";
import { listProjectCollaborators, listProjectInvites } from "@/lib/project/data";
import type { ProjectEnvEntry } from "@/lib/project/env";
import { unwrap } from "@/lib/result";

const createProjectInputSchema = z.object({
  name: z.string().min(1),
  repoId: z.string().min(1),
});

const projectIdInputSchema = z.object({
  projectId: z.string().min(1),
});

const projectEnvEntrySchema: z.ZodType<ProjectEnvEntry> = z.object({
  key: z.string(),
  value: z.string(),
});

const updateProjectSettingsInputSchema = z.object({
  envEntries: z.array(projectEnvEntrySchema),
  projectId: z.string().min(1),
  shareWithOrganisation: z.boolean(),
});

const createTaskInputSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(10),
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

export const $createProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createProjectInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.createProjectForUser({ ...data, userId: context.user.id })),
  );

export const $listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(Project.listProjectsForUser(context.user.id)));

export const $getProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.getProjectForUser(data.projectId, context.user.id)),
  );

export const $createTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => createTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.createTaskForUser({ ...data, userId: context.user.id })),
  );

export const $listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.listTasksForProject(data.projectId, context.user.id)),
  );

export const $getTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.getTaskForProject(data.projectId, data.taskId, context.user.id)),
  );

export const $deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.deleteProjectForUser(data.projectId, context.user.id)),
  );

export const $updateProjectSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => updateProjectSettingsInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Project.updateProjectSettingsForUser({
        ...data,
        userId: context.user.id,
      }),
    ),
  );

export const $deleteTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.deleteTaskForProject(data.projectId, data.taskId, context.user.id)),
  );

export const $terminateTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.terminateTaskForProject(data.projectId, data.taskId, context.user.id)),
  );

export const $getTaskById = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(
    async ({ context, data }) =>
      unwrap(Project.getTaskForUser(data.taskId, context.user.id)) as Promise<any>,
  );

export const $listChildTasksByParentId = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(
    async ({ context, data }) =>
      unwrap(Project.listChildTasksForUser(data.taskId, context.user.id)) as Promise<any>,
  );

export const $terminateTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.terminateTaskForUser(data.taskId, context.user.id)),
  );

export const $listAllUserTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(Project.listAllTasksForUser(context.user.id)));

export const $listAllUserTaskSummaries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(Project.listAllTaskSummariesForUser(context.user.id)));

export const $destroyTaskSandboxById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.destroyTaskSandboxForUser(data.taskId, context.user.id)),
  );

export const $runFollowUpById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => followUpInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.runTaskFollowUpForUser(data.taskId, data.prompt, context.user.id)),
  );

// ─── Collaboration server functions ──────────────────────────────────────────

const inviteMemberInputSchema = z.object({
  githubUsername: z.string().min(1),
  projectId: z.string().min(1),
});

const inviteIdInputSchema = z.object({
  inviteId: z.string().min(1),
  projectId: z.string().min(1),
});

const memberIdInputSchema = z.object({
  targetUserId: z.string().min(1),
  projectId: z.string().min(1),
});

const leaveProjectInputSchema = z.object({
  projectId: z.string().min(1),
});

export const $getProjectCollaborators = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await unwrap(Project.getProjectForUser(data.projectId, context.user.id));
    return listProjectCollaborators(data.projectId);
  });

export const $getProjectInvites = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    // Only the owner/member can list invites (access checked by collaborators lookup)
    await unwrap(Project.getProjectForUser(data.projectId, context.user.id));
    return listProjectInvites(data.projectId);
  });

export const $getMyProjectInvites = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(ProjectMembers.getMyInvites(context.user.id)));

export const $inviteProjectMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => inviteMemberInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      ProjectMembers.inviteMember({
        githubUsername: data.githubUsername,
        projectId: data.projectId,
        userId: context.user.id,
      }),
    ),
  );

export const $cancelProjectInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => inviteIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      ProjectMembers.cancelInvite({
        inviteId: data.inviteId,
        projectId: data.projectId,
        userId: context.user.id,
      }),
    ),
  );

export const $acceptProjectInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => z.object({ inviteId: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) =>
    unwrap(ProjectMembers.acceptInvite({ inviteId: data.inviteId, userId: context.user.id })),
  );

export const $declineProjectInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => z.object({ inviteId: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) =>
    unwrap(ProjectMembers.declineInvite({ inviteId: data.inviteId, userId: context.user.id })),
  );

export const $kickProjectMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => memberIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      ProjectMembers.kickMember({
        targetUserId: data.targetUserId,
        projectId: data.projectId,
        userId: context.user.id,
      }),
    ),
  );

export const $leaveProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => leaveProjectInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(ProjectMembers.leaveProject({ projectId: data.projectId, userId: context.user.id })),
  );
