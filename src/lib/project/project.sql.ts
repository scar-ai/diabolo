import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "@/lib/db/schema";
import { organisation } from "@/lib/org/org.sql";

export const project = pgTable(
  "project",
  {
    id: text().primaryKey(),
    agentSkills: text("agent_skills"),
    name: text().notNull(),
    envVars: text("env_vars"),
    sshPrivateKey: text("ssh_private_key"),
    sshPublicKey: text("ssh_public_key"),
    repoId: text().notNull(),
    sharedWithOrgId: text("shared_with_org_id").references(() => organisation.id, {
      onDelete: "set null",
    }),
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
    sandboxTier: text("sandbox_tier"),
    branchName: text(),
    spawnSource: text().notNull().default("user"),
    scheduledTaskId: text("scheduled_task_id"),
    opencodeModel: text(),
    opencodeProviderId: text("opencode_provider_id"),
    opencodeSessionId: text("opencode_session_id"),
    opencodeRuntimeFingerprint: text("opencode_runtime_fingerprint"),
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

export const scheduledTask = pgTable(
  "scheduled_task",
  {
    id: text().primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    name: text().notNull(),
    scheduleCron: text("schedule_cron").notNull(),
    scheduleTimezone: text("schedule_timezone").notNull(),
    instructions: text().notNull(),
    providerId: text("provider_id"),
    branchName: text("branch_name"),
    enabled: integer().notNull().default(1),
    runOnce: integer("run_once").notNull().default(0),
    lastEnqueuedAt: timestamp("last_enqueued_at"),
    lastRunAt: timestamp("last_run_at"),
    lastFailureAt: timestamp("last_failure_at"),
    lastAlertedAt: timestamp("last_alerted_at"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("scheduled_task_projectId_idx").on(table.projectId),
    index("scheduled_task_createdByUserId_idx").on(table.createdByUserId),
    index("scheduled_task_enabled_idx").on(table.enabled),
  ],
);

export const scheduledTaskJob = pgTable(
  "scheduled_task_job",
  {
    id: text().primaryKey(),
    scheduledTaskId: text("scheduled_task_id")
      .notNull()
      .references(() => scheduledTask.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at").notNull(),
    availableAt: timestamp("available_at").defaultNow().notNull(),
    status: text().notNull().default("pending"),
    attempts: integer().notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdTaskId: text("created_task_id").references(() => task.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp().defaultNow().notNull(),
    updatedAt: timestamp()
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("scheduled_task_job_scheduledTaskId_idx").on(table.scheduledTaskId),
    index("scheduled_task_job_projectId_idx").on(table.projectId),
    index("scheduled_task_job_status_availableAt_idx").on(table.status, table.availableAt),
    index("scheduled_task_job_lockedAt_idx").on(table.lockedAt),
    uniqueIndex("scheduled_task_job_scheduledTaskId_dueAt_idx").on(
      table.scheduledTaskId,
      table.dueAt,
    ),
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
    model: text(),
    reasoningEffort: text("reasoning_effort"),
    opencodeUserMessageId: text("opencode_user_message_id"),
    opencodeAssistantMessageId: text("opencode_assistant_message_id"),
    replayStrategy: text("replay_strategy"),
    replayedAt: timestamp("replayed_at"),
    status: text().notNull().default("pending"),
    queuePosition: integer("queue_position"),
    stage: text().notNull().default("Queued"),
    // Summary of the workspace diff this exchange produced. Stored on the
    // message so the conversation can offer the diff without loading patches.
    diffFileCount: integer("diff_file_count"),
    diffAdditions: integer("diff_additions"),
    diffDeletions: integer("diff_deletions"),
    logs: text(),
    responseMessages: text(),
    error: text(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    dispatchedAt: timestamp("dispatched_at"),
    processingStartedAt: timestamp(),
    executionTimeoutAt: timestamp("execution_timeout_at"),
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
    type: text().notNull(), // EventType, see src/lib/session/types.ts
    payload: text().notNull(), // JSON string of event data
    sandboxId: text("sandbox_id"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_event_taskId_idx").on(table.taskId),
    index("task_event_taskId_sequence_idx").on(table.taskId, table.sequence),
    index("task_event_messageId_idx").on(table.messageId),
    index("task_event_type_idx").on(table.type),
    index("task_event_timestamp_idx").on(table.timestamp),
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

/**
 * One row per file the agent changed during a message, patch included. Kept out
 * of `task_artifact` because patches are large and are only ever read when a
 * user opens a specific file, never as part of the task detail payload.
 */
export const taskDiffFile = pgTable(
  "task_diff_file",
  {
    id: text().primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => taskMessage.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    previousPath: text("previous_path"),
    changeType: text("change_type").notNull().default("modified"),
    additions: integer().notNull().default(0),
    deletions: integer().notNull().default(0),
    isBinary: integer("is_binary").notNull().default(0),
    truncated: integer().notNull().default(0),
    patch: text(),
    position: integer().notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_diff_file_taskId_idx").on(table.taskId),
    index("task_diff_file_messageId_idx").on(table.messageId),
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
  scheduledTasks: many(scheduledTask),
  scheduledTaskJobs: many(scheduledTaskJob),
  members: many(projectMember),
  invites: many(projectInvite),
  owner: one(user, { fields: [project.userId], references: [user.id] }),
  sharedWithOrg: one(organisation, {
    fields: [project.sharedWithOrgId],
    references: [organisation.id],
  }),
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
  diffFiles: many(taskDiffFile),
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

export const scheduledTaskRelations = relations(scheduledTask, ({ one }) => ({
  project: one(project, {
    fields: [scheduledTask.projectId],
    references: [project.id],
  }),
  createdBy: one(user, {
    fields: [scheduledTask.createdByUserId],
    references: [user.id],
  }),
}));

export const scheduledTaskJobRelations = relations(scheduledTaskJob, ({ one }) => ({
  project: one(project, {
    fields: [scheduledTaskJob.projectId],
    references: [project.id],
  }),
  scheduledTask: one(scheduledTask, {
    fields: [scheduledTaskJob.scheduledTaskId],
    references: [scheduledTask.id],
  }),
  task: one(task, {
    fields: [scheduledTaskJob.createdTaskId],
    references: [task.id],
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

export const taskDiffFileRelations = relations(taskDiffFile, ({ one }) => ({
  message: one(taskMessage, {
    fields: [taskDiffFile.messageId],
    references: [taskMessage.id],
  }),
  task: one(task, {
    fields: [taskDiffFile.taskId],
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
