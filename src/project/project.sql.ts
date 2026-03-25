import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { UserTable } from "@/auth/auth.sql";
import { Timestamps } from "@/db/schema.sql";

export const ProjectTable = pgTable(
  "project",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    repoId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => UserTable.id, { onDelete: "cascade" }),
    ...Timestamps,
  },
  (table) => [index("project_userId_idx").on(table.userId)],
);

export const TaskTable = pgTable(
  "task",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    prompt: text().notNull(),
    quickTask: boolean().notNull().default(false),
    status: text().notNull().default("queued"),
    stage: text().notNull().default("Queued"),
    repoId: text(),
    repoName: text(),
    repoUrl: text(),
    parentTaskId: text("parent_task_id"),
    sandboxId: text(),
    sandboxName: text(),
    branchName: text(),
    spawnSource: text().notNull().default("user"),
    opencodeModel: text(),
    sandboxPath: text("clone_path"),
    logs: text(),
    agentMessages: text(),
    followUpHistory: text(),
    error: text(),
    prNumber: integer(),
    prUrl: text(),
    cancelRequestedAt: timestamp(),
    startedAt: timestamp().defaultNow().notNull(),
    completedAt: timestamp(),
    ...Timestamps,
  },
  (table) => [
    index("task_projectId_idx").on(table.projectId),
    index("task_parentTaskId_idx").on(table.parentTaskId),
  ],
);

export const TaskMessageTable = pgTable(
  "task_message",
  {
    id: text().primaryKey(),
    taskId: text()
      .notNull()
      .references(() => TaskTable.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    kind: text().notNull().default("follow_up"),
    prompt: text().notNull(),
    status: text().notNull().default("pending"),
    stage: text().notNull().default("Queued"),
    logs: text(),
    responseMessages: text(),
    error: text(),
    processingStartedAt: timestamp(),
    startedAt: timestamp().defaultNow().notNull(),
    completedAt: timestamp(),
    ...Timestamps,
  },
  (table) => [
    index("task_message_taskId_idx").on(table.taskId),
    index("task_message_taskId_sequence_idx").on(table.taskId, table.sequence),
    index("task_message_taskId_status_idx").on(table.taskId, table.status),
  ],
);

export const ProjectRelations = relations(ProjectTable, ({ many }) => ({
  tasks: many(TaskTable),
}));

export const TaskRelations = relations(TaskTable, ({ many, one }) => ({
  children: many(TaskTable, { relationName: "task_children" }),
  messages: many(TaskMessageTable),
  parent: one(TaskTable, {
    fields: [TaskTable.parentTaskId],
    relationName: "task_children",
    references: [TaskTable.id],
  }),
  project: one(ProjectTable, {
    fields: [TaskTable.projectId],
    references: [ProjectTable.id],
  }),
}));

export const TaskMessageRelations = relations(TaskMessageTable, ({ one }) => ({
  task: one(TaskTable, {
    fields: [TaskMessageTable.taskId],
    references: [TaskTable.id],
  }),
}));
