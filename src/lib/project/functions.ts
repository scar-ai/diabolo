import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { Project, ProjectMembers } from "@/lib/project";
import { listProjectCollaborators, listProjectInvites } from "@/lib/project/data";
import type { ProjectEnvEntry } from "@/lib/project/env";
import {
  isValidCronExpression,
  isValidTimezone,
  MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH,
  MAX_SCHEDULED_TASK_NAME_LENGTH,
} from "@/lib/project/scheduled-tasks";
import type { ProjectSkillEntry } from "@/lib/project/skills";
import { unwrap } from "@/lib/result";
import { SANDBOX_TIER_IDS } from "@/lib/sandbox/tiers";
import { searchSkills } from "@/lib/skills/search";

const createProjectInputSchema = z.object({
  name: z.string().min(1),
  repoId: z.string().min(1),
});

const projectIdInputSchema = z.object({
  projectId: z.string().min(1),
});

const deleteProjectInputSchema = projectIdInputSchema.extend({
  projectName: z.string().min(1),
});

const projectEnvEntrySchema: z.ZodType<ProjectEnvEntry> = z.object({
  key: z.string(),
  value: z.string(),
});

const projectSkillEntrySchema: z.ZodType<ProjectSkillEntry> = z.object({
  installSpec: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  url: z.url(),
});

const updateProjectSettingsInputSchema = z.object({
  envEntries: z.array(projectEnvEntrySchema),
  projectId: z.string().min(1),
  shareWithOrganisation: z.boolean(),
  skills: z.array(projectSkillEntrySchema),
  sshPrivateKey: z.string().max(64_000).nullable().optional(),
  sshPublicKey: z.string().max(16_000).nullable(),
});

const generateProjectSshKeyInputSchema = z.object({
  projectId: z.string().min(1),
});

const searchSkillsInputSchema = z.object({
  query: z.string().min(2),
});

const createTaskInputSchema = z.object({
  providerId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1),
  prompt: z.string().min(10),
  reasoningEffort: z.string().trim().min(1).nullable().optional(),
  sandboxTier: z.enum(SANDBOX_TIER_IDS).nullable().optional(),
  sourceBranch: z.string().min(1),
});

const createScheduledTaskInputSchema = z.object({
  branchName: z.string().min(1).nullable().optional(),
  instructions: z.string().min(1).max(MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH),
  name: z.string().min(1).max(MAX_SCHEDULED_TASK_NAME_LENGTH),
  projectId: z.string().min(1),
  providerId: z.string().min(1).nullable().optional(),
  runOnce: z.boolean().optional().default(false),
  scheduleCron: z.string().refine(isValidCronExpression, "Invalid cron expression."),
  scheduleTimezone: z.string().refine(isValidTimezone, "Invalid timezone."),
});

const scheduledTaskIdInputSchema = z.object({
  projectId: z.string().min(1),
  scheduledTaskId: z.string().min(1),
});

const updateScheduledTaskInputSchema = createScheduledTaskInputSchema.extend({
  runOnce: z.boolean(),
  scheduledTaskId: z.string().min(1),
});

const getTaskInputSchema = z.object({
  projectId: z.string().min(1),
  taskId: z.string().min(1),
});

const taskIdInputSchema = z.object({
  taskId: z.string().min(1),
});

const taskDiffFilesInputSchema = z.object({
  messageId: z.string().min(1),
  taskId: z.string().min(1),
});

const taskDiffPatchInputSchema = z.object({
  diffFileId: z.string().min(1),
  taskId: z.string().min(1),
});

const followUpInputSchema = z.object({
  model: z.string().trim().min(1).nullable().optional(),
  prompt: z.string().min(10),
  reasoningEffort: z.string().trim().min(1).nullable().optional(),
  taskId: z.string().min(1),
});

export const $createProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => createProjectInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.createProjectForUser({ ...data, userId: context.user.id })),
  );

export const $listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => unwrap(Project.listProjectsForUser(context.user.id)));

export const $getProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.getProjectForUser(data.projectId, context.user.id)),
  );

export const $createTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => createTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.createTaskForUser({ ...data, userId: context.user.id })),
  );

export const $createScheduledTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => createScheduledTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.createScheduledTaskForUser({ ...data, userId: context.user.id })),
  );

export const $updateScheduledTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => updateScheduledTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.updateScheduledTaskForUser({ ...data, userId: context.user.id })),
  );

export const $deleteScheduledTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => scheduledTaskIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Project.deleteScheduledTaskForUser(data.projectId, data.scheduledTaskId, context.user.id),
    ),
  );

export const $listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.listTasksForProject(data.projectId, context.user.id)),
  );

export const $listScheduledTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.listScheduledTasksForProject(data.projectId, context.user.id)),
  );

export const $getServerTime = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({
    iso: new Date().toISOString(),
  }));

export const $getTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.getTaskForProject(data.projectId, data.taskId, context.user.id)),
  );

export const $deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => deleteProjectInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.deleteProjectForUser(data.projectId, context.user.id, data.projectName)),
  );

export const $updateProjectSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => updateProjectSettingsInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Project.updateProjectSettingsForUser({
        ...data,
        userId: context.user.id,
      }),
    ),
  );

export const $generateProjectSshKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => generateProjectSshKeyInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.generateSshKeyForProject(data.projectId, context.user.id)),
  );

export const $searchSkills = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => searchSkillsInputSchema.parse(data))
  .handler(async ({ data }) => searchSkills(data.query));

export const $deleteTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.deleteTaskForProject(data.projectId, data.taskId, context.user.id)),
  );

export const $deleteTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.deleteTaskForUser(data.taskId, context.user.id)),
  );

export const $terminateTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => getTaskInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.terminateTaskForProject(data.projectId, data.taskId, context.user.id)),
  );

export const $getTaskById = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => taskIdInputSchema.parse(data))
  .handler(
    async ({ context, data }) =>
      unwrap(Project.getTaskForUser(data.taskId, context.user.id)) as Promise<any>,
  );

export const $listTaskDiffFiles = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => taskDiffFilesInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Project.listTaskDiffFilesForUser({
        messageId: data.messageId,
        taskId: data.taskId,
        userId: context.user.id,
      }),
    ),
  );

export const $getTaskDiffFilePatch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => taskDiffPatchInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Project.getTaskDiffFilePatchForUser({
        diffFileId: data.diffFileId,
        taskId: data.taskId,
        userId: context.user.id,
      }),
    ),
  );

export const $listChildTasksByParentId = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => taskIdInputSchema.parse(data))
  .handler(
    async ({ context, data }) =>
      unwrap(Project.listChildTasksForUser(data.taskId, context.user.id)) as Promise<any>,
  );

export const $terminateTaskById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => taskIdInputSchema.parse(data))
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
  .validator((data) => taskIdInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(Project.destroyTaskSandboxForUser(data.taskId, context.user.id)),
  );

export const $runFollowUpById = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => followUpInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(
      Project.runTaskFollowUpForUser(
        data.taskId,
        data.prompt,
        {
          model: data.model ?? null,
          reasoningEffort: data.reasoningEffort ?? null,
        },
        context.user.id,
      ),
    ),
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
  .validator((data) => projectIdInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await unwrap(Project.getProjectForUser(data.projectId, context.user.id));
    return listProjectCollaborators(data.projectId);
  });

export const $getProjectInvites = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => projectIdInputSchema.parse(data))
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
  .validator((data) => inviteMemberInputSchema.parse(data))
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
  .validator((data) => inviteIdInputSchema.parse(data))
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
  .validator((data) => z.object({ inviteId: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) =>
    unwrap(ProjectMembers.acceptInvite({ inviteId: data.inviteId, userId: context.user.id })),
  );

export const $declineProjectInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => z.object({ inviteId: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) =>
    unwrap(ProjectMembers.declineInvite({ inviteId: data.inviteId, userId: context.user.id })),
  );

export const $kickProjectMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => memberIdInputSchema.parse(data))
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
  .validator((data) => leaveProjectInputSchema.parse(data))
  .handler(async ({ context, data }) =>
    unwrap(ProjectMembers.leaveProject({ projectId: data.projectId, userId: context.user.id })),
  );
