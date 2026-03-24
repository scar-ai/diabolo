import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "@/lib/db/schema";

export const project = pgTable(
  "project",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    repoId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("project_userId_idx").on(table.userId)],
);

export const task = pgTable(
  "task",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    prompt: text().notNull(),
    quickTask: boolean().notNull().default(false),
    status: text().notNull().default("queued"),
    stage: text().notNull().default("Queued"),
    repoId: text(),
    repoName: text(),
    repoUrl: text(),
    sandboxId: text(),
    sandboxName: text(),
    branchName: text(),
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
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("task_projectId_idx").on(table.projectId)],
);

export const taskMessage = pgTable(
  "task_message",
  {
    id: text().primaryKey(),
    taskId: text()
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
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
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_message_taskId_idx").on(table.taskId),
    index("task_message_taskId_sequence_idx").on(table.taskId, table.sequence),
    index("task_message_taskId_status_idx").on(table.taskId, table.status),
  ],
);

export const projectRelations = relations(project, ({ many }) => ({
  tasks: many(task),
}));

export const taskRelations = relations(task, ({ many, one }) => ({
  messages: many(taskMessage),
  project: one(project, {
    fields: [task.projectId],
    references: [project.id],
  }),
}));

export const taskMessageRelations = relations(taskMessage, ({ one }) => ({
  task: one(task, {
    fields: [taskMessage.taskId],
    references: [task.id],
  }),
}));
