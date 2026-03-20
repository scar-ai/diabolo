import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";

import { user } from "./schema";

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    repoId: text("repo_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("project_userId_idx").on(table.userId)],
);

export const task = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("Queued"),
    repoId: text("repo_id"),
    repoName: text("repo_name"),
    repoUrl: text("repo_url"),
    sandboxId: text("sandbox_id"),
    sandboxName: text("sandbox_name"),
    branchName: text("branch_name"),
    clonePath: text("clone_path"),
    logs: text("logs"),
    agentMessages: text("agent_messages"),
    error: text("error"),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("task_projectId_idx").on(table.projectId)],
);

export const projectRelations = relations(project, ({ many }) => ({
  tasks: many(task),
}));

export const taskRelations = relations(task, ({ one }) => ({
  project: one(project, {
    fields: [task.projectId],
    references: [project.id],
  }),
}));
