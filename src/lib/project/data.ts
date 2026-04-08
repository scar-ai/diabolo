import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";

import { db } from "@/lib/db";
import { organisationMember } from "@/lib/org/org.sql";

import {
  project,
  projectInvite,
  projectMember,
  scheduledTask,
  scheduledTaskJob,
  task,
} from "./project.sql";
import { taskSummarySelection } from "./shared";

export type ProjectRecord = typeof project.$inferSelect;
export type TaskRecord = typeof task.$inferSelect;
export type ScheduledTaskRecord = typeof scheduledTask.$inferSelect;
export type ProjectMemberRecord = typeof projectMember.$inferSelect;
export type ProjectInviteRecord = typeof projectInvite.$inferSelect;
export type ScheduledTaskJobRecord = typeof scheduledTaskJob.$inferSelect;
export type TaskForUserRecord = {
  project: ProjectRecord;
  task: TaskRecord;
};
export type ScheduledTaskWithProjectRecord = {
  project: ProjectRecord;
  scheduledTask: ScheduledTaskRecord;
};
export type ScheduledTaskJobWithProjectRecord = {
  project: ProjectRecord;
  scheduledTask: ScheduledTaskRecord;
  scheduledTaskJob: ScheduledTaskJobRecord;
};

// ─── Project queries ──────────────────────────────────────────────────────────

/** Find a project accessible by userId (owner or member). */
export const findProject = (projectId: string, userId: string) =>
  db
    .select({ ...getTableColumns(project) })
    .from(project)
    .leftJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
    )
    .leftJoin(
      organisationMember,
      and(
        eq(organisationMember.orgId, project.sharedWithOrgId),
        eq(organisationMember.userId, userId),
      ),
    )
    .where(
      and(
        eq(project.id, projectId),
        or(
          eq(project.userId, userId),
          isNotNull(projectMember.userId),
          isNotNull(organisationMember.userId),
        ),
      ),
    )
    .then((rows) => rows[0] as ProjectRecord | undefined);

/** Find a project where userId is the owner (for privileged operations). */
export const findOwnedProject = (projectId: string, userId: string) =>
  db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .then((rows) => rows[0]);

export const insertProject = (input: {
  id: string;
  name: string;
  repoId: string;
  userId: string;
}) =>
  db
    .insert(project)
    .values(input)
    .returning()
    .then((rows) => rows[0]);

export const updateProject = (projectId: string, values: Partial<ProjectRecord>) =>
  db
    .update(project)
    .set(values)
    .where(eq(project.id, projectId))
    .returning()
    .then((rows) => rows[0]);

export const deleteProject = (projectId: string) =>
  db.delete(project).where(eq(project.id, projectId));

/** List all projects accessible by userId (owned + member). */
export const listProjects = (userId: string) =>
  db
    .selectDistinct({ ...getTableColumns(project) })
    .from(project)
    .leftJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
    )
    .leftJoin(
      organisationMember,
      and(
        eq(organisationMember.orgId, project.sharedWithOrgId),
        eq(organisationMember.userId, userId),
      ),
    )
    .where(
      or(
        eq(project.userId, userId),
        isNotNull(projectMember.userId),
        isNotNull(organisationMember.userId),
      ),
    )
    .orderBy(desc(project.createdAt))
    .then((rows) => rows as ProjectRecord[]);

/** List IDs of all projects accessible by userId (owned + member). */
export const listProjectIds = (userId: string) =>
  db
    .selectDistinct({ id: project.id })
    .from(project)
    .leftJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
    )
    .leftJoin(
      organisationMember,
      and(
        eq(organisationMember.orgId, project.sharedWithOrgId),
        eq(organisationMember.userId, userId),
      ),
    )
    .where(
      or(
        eq(project.userId, userId),
        isNotNull(projectMember.userId),
        isNotNull(organisationMember.userId),
      ),
    );

// ─── Task queries ─────────────────────────────────────────────────────────────

export const insertTask = (input: {
  branchName: string;
  createdByUserId?: string | null;
  envVars?: string | null;
  id: string;
  opencodeModel?: string | null;
  opencodeProviderId?: string | null;
  parentTaskId?: string | null;
  projectId: string;
  prompt: string;
  repoId: string;
  scheduledTaskId?: string | null;
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

export const deleteTask = (taskId: string, projectId: string) =>
  db.delete(task).where(and(eq(task.id, taskId), eq(task.projectId, projectId)));

export const findTask = (taskId: string) =>
  db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .then((rows) => rows[0]);

export const findTaskWithProject = (taskId: string) =>
  db
    .select()
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .where(eq(task.id, taskId))
    .then((rows) => rows[0] as TaskForUserRecord | undefined);

export const findProjectTask = (taskId: string, projectId: string) =>
  db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.projectId, projectId)))
    .then((rows) => rows[0]);

/** Find a task accessible by userId (via owned or member project). */
export const findUserTask = (taskId: string, userId: string) =>
  db
    .select({ task: getTableColumns(task), project: getTableColumns(project) })
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .leftJoin(
      projectMember,
      and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)),
    )
    .leftJoin(
      organisationMember,
      and(
        eq(organisationMember.orgId, project.sharedWithOrgId),
        eq(organisationMember.userId, userId),
      ),
    )
    .where(
      and(
        eq(task.id, taskId),
        or(
          eq(project.userId, userId),
          isNotNull(projectMember.userId),
          isNotNull(organisationMember.userId),
        ),
      ),
    )
    .then((rows) => rows[0] as TaskForUserRecord | undefined);

export const listProjectTasks = (projectId: string) =>
  db.select().from(task).where(eq(task.projectId, projectId)).orderBy(desc(task.createdAt));

export const listChildTaskSummaries = (parentTaskId: string) =>
  db
    .select(taskSummarySelection)
    .from(task)
    .where(eq(task.parentTaskId, parentTaskId))
    .orderBy(desc(task.updatedAt));

export const findParentTaskSummary = (parentTaskId: string) =>
  db
    .select(taskSummarySelection)
    .from(task)
    .where(eq(task.id, parentTaskId))
    .then((rows) => rows[0] ?? null);

export const listUserTasks = (projectIds: string[]) =>
  db.select().from(task).where(inArray(task.projectId, projectIds)).orderBy(desc(task.startedAt));

export const listUserTaskSummaries = (projectIds: string[]) =>
  db
    .select(taskSummarySelection)
    .from(task)
    .where(inArray(task.projectId, projectIds))
    .orderBy(desc(task.startedAt));

export const updateTask = (taskId: string, values: Partial<TaskRecord>) =>
  db
    .update(task)
    .set(values)
    .where(eq(task.id, taskId))
    .returning()
    .then((rows) => rows[0]);

export const insertScheduledTask = (input: {
  branchName?: string | null;
  consecutiveFailures?: number;
  createdByUserId?: string | null;
  id: string;
  instructions: string;
  name: string;
  projectId: string;
  providerId?: string | null;
  runOnce?: number;
  scheduleCron: string;
  scheduleTimezone: string;
}) =>
  db
    .insert(scheduledTask)
    .values(input)
    .returning()
    .then((rows) => rows[0]);

export const listProjectScheduledTasks = (projectId: string) =>
  db
    .select()
    .from(scheduledTask)
    .where(eq(scheduledTask.projectId, projectId))
    .orderBy(desc(scheduledTask.createdAt));

export const listEnabledScheduledTasksWithProjects = () =>
  db
    .select({ project: getTableColumns(project), scheduledTask: getTableColumns(scheduledTask) })
    .from(scheduledTask)
    .innerJoin(project, eq(scheduledTask.projectId, project.id))
    .where(eq(scheduledTask.enabled, 1))
    .orderBy(desc(scheduledTask.createdAt))
    .then((rows) => rows as ScheduledTaskWithProjectRecord[]);

export const listScheduledTaskRuns = (scheduledTaskIds: string[]) =>
  scheduledTaskIds.length === 0
    ? Promise.resolve(
        [] as Array<Pick<TaskRecord, "id" | "scheduledTaskId" | "startedAt" | "status">>,
      )
    : db
        .select({
          id: task.id,
          scheduledTaskId: task.scheduledTaskId,
          startedAt: task.startedAt,
          status: task.status,
        })
        .from(task)
        .where(inArray(task.scheduledTaskId, scheduledTaskIds))
        .orderBy(desc(task.startedAt));

export const findProjectScheduledTask = (scheduledTaskId: string, projectId: string) =>
  db
    .select()
    .from(scheduledTask)
    .where(and(eq(scheduledTask.id, scheduledTaskId), eq(scheduledTask.projectId, projectId)))
    .then((rows) => rows[0]);

export const updateScheduledTask = (
  scheduledTaskId: string,
  values: Partial<ScheduledTaskRecord>,
) =>
  db
    .update(scheduledTask)
    .set(values)
    .where(eq(scheduledTask.id, scheduledTaskId))
    .returning()
    .then((rows) => rows[0]);

export const insertScheduledTaskJobs = (
  input: Array<{
    availableAt?: Date;
    dueAt: Date;
    id: string;
    maxAttempts?: number;
    projectId: string;
    scheduledTaskId: string;
  }>,
) =>
  input.length === 0
    ? Promise.resolve([])
    : db
        .insert(scheduledTaskJob)
        .values(
          input.map((entry) => ({
            availableAt: entry.availableAt ?? entry.dueAt,
            dueAt: entry.dueAt,
            id: entry.id,
            maxAttempts: entry.maxAttempts ?? 3,
            projectId: entry.projectId,
            scheduledTaskId: entry.scheduledTaskId,
          })),
        )
        .onConflictDoNothing({
          target: [scheduledTaskJob.scheduledTaskId, scheduledTaskJob.dueAt],
        })
        .returning();

export const claimNextScheduledTaskJob = async (input: {
  now: Date;
  staleBefore: Date;
  workerId: string;
}) =>
  db.transaction(async (tx) => {
    const candidate = await tx
      .select({ id: scheduledTaskJob.id })
      .from(scheduledTaskJob)
      .where(
        and(
          or(eq(scheduledTaskJob.status, "pending"), eq(scheduledTaskJob.status, "retrying")),
          lte(scheduledTaskJob.availableAt, input.now),
          or(isNull(scheduledTaskJob.lockedAt), lt(scheduledTaskJob.lockedAt, input.staleBefore)),
        ),
      )
      .orderBy(asc(scheduledTaskJob.availableAt), asc(scheduledTaskJob.dueAt))
      .limit(1)
      .then((rows) => rows[0]);

    if (!candidate) {
      return null;
    }

    const claimed = await tx
      .update(scheduledTaskJob)
      .set({
        attempts: sql`${scheduledTaskJob.attempts} + 1`,
        lockedAt: input.now,
        lockedBy: input.workerId,
        status: "running",
      })
      .where(
        and(
          eq(scheduledTaskJob.id, candidate.id),
          or(eq(scheduledTaskJob.status, "pending"), eq(scheduledTaskJob.status, "retrying")),
          lte(scheduledTaskJob.availableAt, input.now),
          or(isNull(scheduledTaskJob.lockedAt), lt(scheduledTaskJob.lockedAt, input.staleBefore)),
        ),
      )
      .returning()
      .then((rows) => rows[0]);

    if (!claimed) {
      return null;
    }

    const joined = await tx
      .select({
        project: getTableColumns(project),
        scheduledTask: getTableColumns(scheduledTask),
        scheduledTaskJob: getTableColumns(scheduledTaskJob),
      })
      .from(scheduledTaskJob)
      .innerJoin(scheduledTask, eq(scheduledTaskJob.scheduledTaskId, scheduledTask.id))
      .innerJoin(project, eq(scheduledTaskJob.projectId, project.id))
      .where(eq(scheduledTaskJob.id, claimed.id))
      .then((rows) => rows[0]);

    return joined as ScheduledTaskJobWithProjectRecord | null;
  });

export const markScheduledTaskJobSucceeded = async (input: {
  createdTaskId: string;
  dueAt: Date;
  jobId: string;
  now: Date;
  scheduledTaskId: string;
}) => {
  await db.transaction(async (tx) => {
    await tx
      .update(scheduledTaskJob)
      .set({
        completedAt: input.now,
        createdTaskId: input.createdTaskId,
        lockedAt: null,
        lockedBy: null,
        status: "succeeded",
      })
      .where(eq(scheduledTaskJob.id, input.jobId));

    await tx
      .update(scheduledTask)
      .set({
        consecutiveFailures: 0,
        lastError: null,
        lastRunAt: input.dueAt,
      })
      .where(eq(scheduledTask.id, input.scheduledTaskId));
  });
};

export const markScheduledTaskJobRetrying = async (input: {
  error: string;
  jobId: string;
  nextAvailableAt: Date;
}) =>
  db
    .update(scheduledTaskJob)
    .set({
      availableAt: input.nextAvailableAt,
      lastError: input.error,
      lockedAt: null,
      lockedBy: null,
      status: "retrying",
    })
    .where(eq(scheduledTaskJob.id, input.jobId))
    .returning()
    .then((rows) => rows[0]);

export const markScheduledTaskJobFailed = async (input: {
  error: string;
  jobId: string;
  now: Date;
  scheduledTaskId: string;
}) => {
  await db.transaction(async (tx) => {
    await tx
      .update(scheduledTaskJob)
      .set({
        completedAt: input.now,
        lastError: input.error,
        lockedAt: null,
        lockedBy: null,
        status: "failed",
      })
      .where(eq(scheduledTaskJob.id, input.jobId));

    await tx
      .update(scheduledTask)
      .set({
        consecutiveFailures: sql`${scheduledTask.consecutiveFailures} + 1`,
        lastAlertedAt: input.now,
        lastError: input.error,
        lastFailureAt: input.now,
      })
      .where(eq(scheduledTask.id, input.scheduledTaskId));
  });
};

export const releaseStaleScheduledTaskJobs = (staleBefore: Date) =>
  db
    .update(scheduledTaskJob)
    .set({
      lockedAt: null,
      lockedBy: null,
      status: sql`case
        when ${scheduledTaskJob.status} = 'running' then 'retrying'
        else ${scheduledTaskJob.status}
      end`,
    })
    .where(and(eq(scheduledTaskJob.status, "running"), lt(scheduledTaskJob.lockedAt, staleBefore)))
    .returning();

export const deleteScheduledTask = (scheduledTaskId: string, projectId: string) =>
  db
    .delete(scheduledTask)
    .where(and(eq(scheduledTask.id, scheduledTaskId), eq(scheduledTask.projectId, projectId)));

// ─── Project member queries ───────────────────────────────────────────────────

export const insertProjectMember = (input: { projectId: string; userId: string; role?: string }) =>
  db
    .insert(projectMember)
    .values({ role: "member", ...input })
    .returning()
    .then((rows) => rows[0]);

export const deleteProjectMember = (projectId: string, userId: string) =>
  db
    .delete(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));

export const findProjectMember = (projectId: string, userId: string) =>
  db
    .select()
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
    .then((rows) => rows[0]);

export type ProjectCollaborator = {
  userId: string;
  role: "owner" | "member";
  user: { id: string; name: string; image: string | null };
};

export const listProjectCollaborators = async (
  projectId: string,
): Promise<ProjectCollaborator[]> => {
  const projectRow = await db.query.project.findFirst({
    where: eq(project.id, projectId),
    with: {
      owner: { columns: { id: true, name: true, image: true } },
      members: {
        with: { user: { columns: { id: true, name: true, image: true } } },
      },
    },
  });

  if (!projectRow) return [];

  const owner: ProjectCollaborator = {
    userId: projectRow.userId,
    role: "owner",
    user: projectRow.owner,
  };

  const members: ProjectCollaborator[] = projectRow.members.map((m) => ({
    userId: m.userId,
    role: "member",
    user: m.user,
  }));

  return [owner, ...members];
};

// ─── Project invite queries ───────────────────────────────────────────────────

export const insertProjectInvite = (input: {
  id: string;
  projectId: string;
  githubUsername: string;
  githubUserId: string;
  invitedByUserId: string;
}) =>
  db
    .insert(projectInvite)
    .values({ status: "pending", ...input })
    .returning()
    .then((rows) => rows[0]);

export const findProjectInviteById = (inviteId: string) =>
  db
    .select()
    .from(projectInvite)
    .where(eq(projectInvite.id, inviteId))
    .then((rows) => rows[0]);

export const updateProjectInvite = (inviteId: string, values: Partial<ProjectInviteRecord>) =>
  db
    .update(projectInvite)
    .set(values)
    .where(eq(projectInvite.id, inviteId))
    .returning()
    .then((rows) => rows[0]);

export const listProjectInvites = (projectId: string) =>
  db
    .select()
    .from(projectInvite)
    .where(and(eq(projectInvite.projectId, projectId), eq(projectInvite.status, "pending")));

export type ProjectInviteWithProject = ProjectInviteRecord & {
  project: { id: string; name: string };
};

export const listUserProjectInvites = async (
  githubUserId: string,
): Promise<ProjectInviteWithProject[]> => {
  const rows = await db.query.projectInvite.findMany({
    where: and(eq(projectInvite.githubUserId, githubUserId), eq(projectInvite.status, "pending")),
    with: { project: { columns: { id: true, name: true } } },
  });

  return rows as ProjectInviteWithProject[];
};
