import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";

import { db } from "@/lib/db";

import { project, projectInvite, projectMember, task } from "./project.sql";
import { taskSummarySelection } from "./shared";

export type ProjectRecord = typeof project.$inferSelect;
export type TaskRecord = typeof task.$inferSelect;
export type ProjectMemberRecord = typeof projectMember.$inferSelect;
export type ProjectInviteRecord = typeof projectInvite.$inferSelect;
export type TaskForUserRecord = {
  project: ProjectRecord;
  task: TaskRecord;
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
    .where(
      and(
        eq(project.id, projectId),
        or(eq(project.userId, userId), isNotNull(projectMember.userId)),
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
    .where(or(eq(project.userId, userId), isNotNull(projectMember.userId)))
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
    .where(or(eq(project.userId, userId), isNotNull(projectMember.userId)));

// ─── Task queries ─────────────────────────────────────────────────────────────

export const insertTask = (input: {
  branchName: string;
  createdByUserId?: string | null;
  envVars?: string | null;
  id: string;
  opencodeModel?: string | null;
  parentTaskId?: string | null;
  projectId: string;
  prompt: string;
  quickTask: boolean;
  repoId: string;
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
    .where(
      and(eq(task.id, taskId), or(eq(project.userId, userId), isNotNull(projectMember.userId))),
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
