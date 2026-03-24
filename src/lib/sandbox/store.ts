import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { task, taskMessage } from "@/lib/project/project.sql";

import type { Sandbox } from "./index";

const MAX_LOG_LENGTH = 16_000;
const MAX_AGENT_MESSAGES = 200;

const trimLogs = (value: string | null | undefined) => value?.slice(-MAX_LOG_LENGTH) ?? null;

const parseAgentMessages = (raw: string | null | undefined): Sandbox.AgentMessage[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const serializeAgentMessages = (messages: Sandbox.AgentMessage[]) =>
  messages.length > 0 ? JSON.stringify(messages) : null;

export type TaskRecord = typeof task.$inferSelect;
export type TaskMessageRecord = typeof taskMessage.$inferSelect;

export const findTaskRecord = (taskId: string) =>
  db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .then((rows) => rows[0]);

export const listTaskMessages = (taskId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(eq(taskMessage.taskId, taskId))
    .orderBy(asc(taskMessage.sequence), asc(taskMessage.createdAt));

export const findTaskMessage = (messageId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(eq(taskMessage.id, messageId))
    .then((rows) => rows[0]);

export const findProcessingTaskMessage = (taskId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(and(eq(taskMessage.taskId, taskId), eq(taskMessage.status, "processing")))
    .orderBy(asc(taskMessage.sequence))
    .then((rows) => rows[0]);

export const findNextPendingTaskMessage = (taskId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(and(eq(taskMessage.taskId, taskId), eq(taskMessage.status, "pending")))
    .orderBy(asc(taskMessage.sequence))
    .then((rows) => rows[0]);

export const createTaskMessage = async (input: {
  kind: "follow_up" | "initial";
  prompt: string;
  taskId: string;
}) => {
  const nextSequenceRows = await db
    .select({
      value: sql<number>`coalesce(max(${taskMessage.sequence}), -1)`,
    })
    .from(taskMessage)
    .where(eq(taskMessage.taskId, input.taskId));

  const nextSequence = (nextSequenceRows[0]?.value ?? -1) + 1;

  return db
    .insert(taskMessage)
    .values({
      id: crypto.randomUUID(),
      kind: input.kind,
      prompt: input.prompt,
      sequence: nextSequence,
      taskId: input.taskId,
    })
    .returning()
    .then((rows) => rows[0]);
};

export const updateTaskRecord = (taskId: string, values: Partial<TaskRecord>) =>
  db
    .update(task)
    .set(values)
    .where(eq(task.id, taskId))
    .returning()
    .then((rows) => rows[0]);

export const updateTaskMessageRecord = (messageId: string, values: Partial<TaskMessageRecord>) =>
  db
    .update(taskMessage)
    .set(values)
    .where(eq(taskMessage.id, messageId))
    .returning()
    .then((rows) => rows[0]);

export const claimNextTaskMessage = (taskId: string) =>
  db.transaction(async (tx) => {
    const processing = await tx
      .select()
      .from(taskMessage)
      .where(and(eq(taskMessage.taskId, taskId), eq(taskMessage.status, "processing")))
      .orderBy(asc(taskMessage.sequence));

    if (processing[0]) {
      return null;
    }

    const pending = await tx
      .select()
      .from(taskMessage)
      .where(and(eq(taskMessage.taskId, taskId), eq(taskMessage.status, "pending")))
      .orderBy(asc(taskMessage.sequence));

    const next = pending[0];

    if (!next) {
      return null;
    }

    const now = new Date();
    const updated = await tx
      .update(taskMessage)
      .set({
        processingStartedAt: now,
        stage: "Dequeued prompt",
        status: "processing",
      })
      .where(eq(taskMessage.id, next.id))
      .returning();

    return updated[0] ?? null;
  });

export const appendTaskMessageLog = async (messageId: string, chunk: string) => {
  if (!chunk) {
    return;
  }

  const current = await findTaskMessage(messageId);

  if (!current) {
    return;
  }

  await updateTaskMessageRecord(messageId, {
    logs: trimLogs(`${current.logs ?? ""}${chunk}`),
  });
};

export const appendTaskMessageAgentMessage = async (
  messageId: string,
  text: string,
  timestamp: number,
) => {
  const trimmed = text.trim();

  if (!trimmed) {
    return;
  }

  const current = await findTaskMessage(messageId);

  if (!current) {
    return;
  }

  const responseMessages = [
    ...parseAgentMessages(current.responseMessages),
    { text: trimmed, timestamp },
  ].slice(-MAX_AGENT_MESSAGES);

  await updateTaskMessageRecord(messageId, {
    responseMessages: serializeAgentMessages(responseMessages),
  });
};

export const getTaskConversation = async (taskId: string) => {
  const messages = await listTaskMessages(taskId);
  return messages.map((message) => ({
    ...message,
    parsedResponseMessages: parseAgentMessages(message.responseMessages),
  }));
};

export const findQueuedOrRunningTasks = () =>
  db
    .select({ id: task.id })
    .from(task)
    .where(sql`${task.status} in ('queued', 'running')`)
    .orderBy(desc(task.updatedAt));

export const cancelPendingTaskMessages = (taskId: string, errorMessage: string) =>
  db
    .update(taskMessage)
    .set({
      completedAt: new Date(),
      error: errorMessage,
      stage: "Cancelled",
      status: "cancelled",
    })
    .where(and(eq(taskMessage.taskId, taskId), eq(taskMessage.status, "pending")));

export const clearTaskCancellation = (taskId: string) =>
  db.update(task).set({ cancelRequestedAt: null }).where(eq(task.id, taskId));

export const isTaskCancellationRequested = (taskId: string) =>
  db
    .select({ cancelRequestedAt: task.cancelRequestedAt })
    .from(task)
    .where(eq(task.id, taskId))
    .then((rows) => rows[0]?.cancelRequestedAt ?? null);

export const findStaleProcessingMessage = (taskId: string, staleBefore: Date) =>
  db
    .select()
    .from(taskMessage)
    .where(
      and(
        eq(taskMessage.taskId, taskId),
        eq(taskMessage.status, "processing"),
        sql`${taskMessage.processingStartedAt} is not null and ${taskMessage.processingStartedAt} < ${staleBefore}`,
      ),
    )
    .orderBy(asc(taskMessage.sequence))
    .then((rows) => rows[0]);

export const findLatestCompletedMessage = (taskId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(and(eq(taskMessage.taskId, taskId), sql`${taskMessage.completedAt} is not null`))
    .orderBy(desc(taskMessage.sequence))
    .then((rows) => rows[0]);
