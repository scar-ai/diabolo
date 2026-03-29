import { relations } from "drizzle-orm";
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "@/lib/db/schema";

export const project = pgTable(
  "project",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    envVars: text("env_vars"),
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

export const projectMember = pgTable(
  "project_member",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_member_userId_idx").on(table.userId),
  ],
);

export const projectInvite = pgTable(
  "project_invite",
  {
    id: text().primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    githubUsername: text("github_username").notNull(),
    githubUserId: text("github_user_id").notNull(),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id),
    status: text().notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_invite_projectId_idx").on(table.projectId),
    index("project_invite_githubUserId_idx").on(table.githubUserId),
  ],
);

export const task = pgTable(
  "task",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    prompt: text().notNull(),
    title: text(),
    status: text().notNull().default("queued"),
    stage: text().notNull().default("Queued"),
    spawnDepth: integer("spawn_depth").notNull().default(0),
    repoId: text(),
    repoName: text(),
    repoUrl: text(),
    parentTaskId: text("parent_task_id"),
    sandboxId: text(),
    sandboxName: text(),
    sandboxStatus: text("sandbox_status").notNull().default("pending"),
    branchName: text(),
    spawnSource: text().notNull().default("user"),
    opencodeModel: text(),
    sandboxPath: text("clone_path"),
    nextMessageSequence: integer("next_message_sequence").notNull().default(0),
    spawnFailureCount: integer("spawn_failure_count").notNull().default(0),
    lastSpawnFailureAt: timestamp("last_spawn_failure_at"),
    lastSpawnError: text("last_spawn_error"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    logs: text(),
    envVars: text("env_vars"),
    agentMessages: text(),
    followUpHistory: text(),
    error: text(),
    prNumber: integer(),
    prUrl: text(),
    cancelRequestedAt: timestamp(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamp().defaultNow().notNull(),
    completedAt: timestamp(),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_projectId_idx").on(table.projectId),
    index("task_parentTaskId_idx").on(table.parentTaskId),
    index("task_status_idx").on(table.status),
    index("task_sandboxStatus_idx").on(table.sandboxStatus),
  ],
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
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
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

export const taskEvent = pgTable(
  "task_event",
  {
    id: text().primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => taskMessage.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    type: text().notNull(),
    payload: text().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_event_taskId_idx").on(table.taskId),
    index("task_event_taskId_sequence_idx").on(table.taskId, table.sequence),
    index("task_event_messageId_idx").on(table.messageId),
  ],
);

export const taskArtifact = pgTable(
  "task_artifact",
  {
    id: text().primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => taskMessage.id, { onDelete: "cascade" }),
    type: text().notNull(),
    url: text().notNull(),
    metadata: text(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_artifact_taskId_idx").on(table.taskId),
    index("task_artifact_messageId_idx").on(table.messageId),
  ],
);

export const taskEventSequence = pgTable(
  "task_event_sequence",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    nextSequence: integer("next_sequence").notNull().default(0),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId] })],
);

export const projectRelations = relations(project, ({ many, one }) => ({
  tasks: many(task),
  members: many(projectMember),
  invites: many(projectInvite),
  owner: one(user, { fields: [project.userId], references: [user.id] }),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  project: one(project, { fields: [projectMember.projectId], references: [project.id] }),
  user: one(user, { fields: [projectMember.userId], references: [user.id] }),
}));

export const projectInviteRelations = relations(projectInvite, ({ one }) => ({
  project: one(project, { fields: [projectInvite.projectId], references: [project.id] }),
  invitedBy: one(user, { fields: [projectInvite.invitedByUserId], references: [user.id] }),
}));

export const taskRelations = relations(task, ({ many, one }) => ({
  artifacts: many(taskArtifact),
  children: many(task, { relationName: "task_children" }),
  events: many(taskEvent),
  messages: many(taskMessage),
  parent: one(task, {
    fields: [task.parentTaskId],
    relationName: "task_children",
    references: [task.id],
  }),
  project: one(project, {
    fields: [task.projectId],
    references: [project.id],
  }),
  createdBy: one(user, {
    fields: [task.createdByUserId],
    references: [user.id],
  }),
}));

export const taskMessageRelations = relations(taskMessage, ({ one }) => ({
  task: one(task, {
    fields: [taskMessage.taskId],
    references: [task.id],
  }),
  createdBy: one(user, {
    fields: [taskMessage.createdByUserId],
    references: [user.id],
  }),
}));

export const taskEventRelations = relations(taskEvent, ({ one }) => ({
  message: one(taskMessage, {
    fields: [taskEvent.messageId],
    references: [taskMessage.id],
  }),
  task: one(task, {
    fields: [taskEvent.taskId],
    references: [task.id],
  }),
}));

export const taskArtifactRelations = relations(taskArtifact, ({ one }) => ({
  message: one(taskMessage, {
    fields: [taskArtifact.messageId],
    references: [taskMessage.id],
  }),
  task: one(task, {
    fields: [taskArtifact.taskId],
    references: [task.id],
  }),
}));
