import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "@/db/db";
import { TaskMessageTable, TaskTable } from "@/project/project.sql";
import type { Sandbox } from "@/sandbox";

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

export type TaskRecord = typeof TaskTable.$inferSelect;
export type TaskMessageRecord = typeof TaskMessageTable.$inferSelect;

export const findTaskRecord = (taskId: string) =>
  db
    .select()
    .from(TaskTable)
    .where(eq(TaskTable.id, taskId))
    .then((rows) => rows[0]);

export const listTaskMessages = (taskId: string) =>
  db
    .select()
    .from(TaskMessageTable)
    .where(eq(TaskMessageTable.taskId, taskId))
    .orderBy(asc(TaskMessageTable.sequence), asc(TaskMessageTable.createdAt));

export const findTaskMessage = (messageId: string) =>
  db
    .select()
    .from(TaskMessageTable)
    .where(eq(TaskMessageTable.id, messageId))
    .then((rows) => rows[0]);

export const findProcessingTaskMessage = (taskId: string) =>
  db
    .select()
    .from(TaskMessageTable)
    .where(and(eq(TaskMessageTable.taskId, taskId), eq(TaskMessageTable.status, "processing")))
    .orderBy(asc(TaskMessageTable.sequence))
    .then((rows) => rows[0]);

export const findNextPendingTaskMessage = (taskId: string) =>
  db
    .select()
    .from(TaskMessageTable)
    .where(and(eq(TaskMessageTable.taskId, taskId), eq(TaskMessageTable.status, "pending")))
    .orderBy(asc(TaskMessageTable.sequence))
    .then((rows) => rows[0]);

export const createTaskMessage = async (input: {
  kind: "follow_up" | "initial";
  prompt: string;
  taskId: string;
}) => {
  const nextSequenceRows = await db
    .select({
      value: sql<number>`coalesce(max(${TaskMessageTable.sequence}), -1)`,
    })
    .from(TaskMessageTable)
    .where(eq(TaskMessageTable.taskId, input.taskId));

  const nextSequence = (nextSequenceRows[0]?.value ?? -1) + 1;

  return db
    .insert(TaskMessageTable)
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
    .update(TaskTable)
    .set(values)
    .where(eq(TaskTable.id, taskId))
    .returning()
    .then((rows) => rows[0]);

export const updateTaskMessageRecord = (messageId: string, values: Partial<TaskMessageRecord>) =>
  db
    .update(TaskMessageTable)
    .set(values)
    .where(eq(TaskMessageTable.id, messageId))
    .returning()
    .then((rows) => rows[0]);

export const claimNextTaskMessage = (taskId: string) =>
  db.transaction(async (tx) => {
    const processing = await tx
      .select()
      .from(TaskMessageTable)
      .where(and(eq(TaskMessageTable.taskId, taskId), eq(TaskMessageTable.status, "processing")))
      .orderBy(asc(TaskMessageTable.sequence));

    if (processing[0]) {
      return null;
    }

    const pending = await tx
      .select()
      .from(TaskMessageTable)
      .where(and(eq(TaskMessageTable.taskId, taskId), eq(TaskMessageTable.status, "pending")))
      .orderBy(asc(TaskMessageTable.sequence));

    const next = pending[0];

    if (!next) {
      return null;
    }

    const now = new Date();
    const updated = await tx
      .update(TaskMessageTable)
      .set({
        processingStartedAt: now,
        stage: "Dequeued prompt",
        status: "processing",
      })
      .where(eq(TaskMessageTable.id, next.id))
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

export const findQueuedOrRunningTasks = () =>
  db
    .select({ id: TaskTable.id })
    .from(TaskTable)
    .where(sql`${TaskTable.status} in ('queued', 'running')`)
    .orderBy(desc(TaskTable.updatedAt));

export const cancelPendingTaskMessages = (taskId: string, errorMessage: string) =>
  db
    .update(TaskMessageTable)
    .set({
      completedAt: new Date(),
      error: errorMessage,
      stage: "Cancelled",
      status: "cancelled",
    })
    .where(and(eq(TaskMessageTable.taskId, taskId), eq(TaskMessageTable.status, "pending")));

export const clearTaskCancellation = (taskId: string) =>
  db.update(TaskTable).set({ cancelRequestedAt: null }).where(eq(TaskTable.id, taskId));

export const isTaskCancellationRequested = (taskId: string) =>
  db
    .select({ cancelRequestedAt: TaskTable.cancelRequestedAt })
    .from(TaskTable)
    .where(eq(TaskTable.id, taskId))
    .then((rows) => rows[0]?.cancelRequestedAt ?? null);

export const findStaleProcessingMessage = (taskId: string, staleBefore: Date) =>
  db
    .select()
    .from(TaskMessageTable)
    .where(
      and(
        eq(TaskMessageTable.taskId, taskId),
        eq(TaskMessageTable.status, "processing"),
        isNotNull(TaskMessageTable.processingStartedAt),
        lt(TaskMessageTable.processingStartedAt, staleBefore),
      ),
    )
    .orderBy(asc(TaskMessageTable.sequence))
    .then((rows) => rows[0]);

export const findLatestCompletedMessage = (taskId: string) =>
  db
    .select()
    .from(TaskMessageTable)
    .where(and(eq(TaskMessageTable.taskId, taskId), isNotNull(TaskMessageTable.completedAt)))
    .orderBy(desc(TaskMessageTable.sequence))
    .then((rows) => rows[0]);
