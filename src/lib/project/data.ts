import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";

import { project, task } from "./project.sql";
import { taskSummarySelection } from "./shared";

export type ProjectRecord = typeof project.$inferSelect;
export type TaskRecord = typeof task.$inferSelect;
export type TaskForUserRecord = {
  project: ProjectRecord;
  task: TaskRecord;
};

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

export const findProject = (projectId: string, userId: string) =>
  db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.userId, userId)))
    .then((rows) => rows[0]);

export const listProjects = (userId: string) =>
  db.select().from(project).where(eq(project.userId, userId)).orderBy(desc(project.createdAt));

export const listProjectIds = (userId: string) =>
  db.select({ id: project.id }).from(project).where(eq(project.userId, userId));

export const insertTask = (input: {
  branchName: string;
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

export const findUserTask = (taskId: string, userId: string) =>
  db
    .select()
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .where(and(eq(task.id, taskId), eq(project.userId, userId)))
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
