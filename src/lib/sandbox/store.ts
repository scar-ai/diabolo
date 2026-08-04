import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import type { JsonObject } from "@/lib/json";
import {
  task,
  taskArtifact,
  taskEvent,
  taskEventSequence,
  taskMessage,
} from "@/lib/project/project.sql";
import { findUserById } from "@/lib/user/data";

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

const parseJson = <T>(raw: string | null | undefined): T | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const stringifyPayload = (payload: unknown) => JSON.stringify(payload ?? {});

const syncPendingQueuePositions = async (
  executor: any,
  taskId: string,
  skipMessageId?: string | null,
) => {
  const pendingMessages = await executor
    .select({ id: taskMessage.id })
    .from(taskMessage)
    .where(and(eq(taskMessage.taskId, taskId), eq(taskMessage.status, "pending")))
    .orderBy(asc(taskMessage.sequence), asc(taskMessage.createdAt));

  let position = 1;

  for (const message of pendingMessages) {
    const nextQueuePosition = skipMessageId && message.id === skipMessageId ? null : position++;

    await executor
      .update(taskMessage)
      .set({
        queuePosition: nextQueuePosition,
      })
      .where(eq(taskMessage.id, message.id));
  }
};

export type TaskRecord = typeof task.$inferSelect;
export type TaskMessageRecord = typeof taskMessage.$inferSelect;
export type TaskEventRecord = typeof taskEvent.$inferSelect;
export type TaskArtifactRecord = typeof taskArtifact.$inferSelect;

export type ParsedTaskEventRecord = Omit<TaskEventRecord, "payload"> & {
  parsedPayload: JsonObject;
};

export type ParsedTaskArtifactRecord = Omit<TaskArtifactRecord, "metadata"> & {
  parsedMetadata: JsonObject | null;
};

export const findTaskRecord = (taskId: string) =>
  db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .then((rows) => rows[0]);

export const findTaskRecords = (taskIds: string[]) =>
  taskIds.length === 0
    ? Promise.resolve([] as TaskRecord[])
    : db.select().from(task).where(inArray(task.id, taskIds));

export const listTaskMessages = (taskId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(eq(taskMessage.taskId, taskId))
    .orderBy(asc(taskMessage.sequence), asc(taskMessage.createdAt));

export const listTaskEvents = async (taskId: string) => {
  const rows = await db
    .select()
    .from(taskEvent)
    .where(eq(taskEvent.taskId, taskId))
    .orderBy(asc(taskEvent.sequence), asc(taskEvent.createdAt));

  return rows.map((row) => ({
    ...row,
    parsedPayload: parseJson<JsonObject>(row.payload) ?? {},
  }));
};

export const listTaskEventsAfter = async (taskId: string, afterSequence: number) => {
  const rows = await db
    .select()
    .from(taskEvent)
    .where(and(eq(taskEvent.taskId, taskId), sql`${taskEvent.sequence} > ${afterSequence}`))
    .orderBy(asc(taskEvent.sequence), asc(taskEvent.createdAt));

  return rows.map((row) => ({
    ...row,
    parsedPayload: parseJson<JsonObject>(row.payload) ?? {},
  }));
};

export const listTaskArtifacts = async (taskId: string) => {
  const rows = await db
    .select()
    .from(taskArtifact)
    .where(eq(taskArtifact.taskId, taskId))
    .orderBy(asc(taskArtifact.createdAt));

  return rows.map((row) => ({
    ...row,
    parsedMetadata: parseJson<JsonObject>(row.metadata),
  }));
};

export const listTaskArtifactsByMessageId = async (messageId: string) => {
  const rows = await db
    .select()
    .from(taskArtifact)
    .where(eq(taskArtifact.messageId, messageId))
    .orderBy(asc(taskArtifact.createdAt));

  return rows.map((row) => ({
    ...row,
    parsedMetadata: parseJson<JsonObject>(row.metadata),
  }));
};

export const findTaskMessage = (messageId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(eq(taskMessage.id, messageId))
    .then((rows) => rows[0]);

export const findTaskArtifact = (artifactId: string) =>
  db
    .select()
    .from(taskArtifact)
    .where(eq(taskArtifact.id, artifactId))
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
  createdByUserId?: string | null;
  kind: "follow_up" | "initial";
  model?: string | null;
  prompt: string;
  reasoningEffort?: string | null;
  taskId: string;
}) =>
  db.transaction(async (tx) => {
    const createdByUserId = input.createdByUserId
      ? ((await findUserById(input.createdByUserId))?.id ?? null)
      : null;

    const allocated = await tx
      .update(task)
      .set({
        nextMessageSequence: sql`${task.nextMessageSequence} + 1`,
      })
      .where(eq(task.id, input.taskId))
      .returning({ nextMessageSequence: task.nextMessageSequence });

    const sequence = (allocated[0]?.nextMessageSequence ?? 1) - 1;

    const inserted = await tx
      .insert(taskMessage)
      .values({
        createdByUserId,
        id: crypto.randomUUID(),
        kind: input.kind,
        model: input.model ?? null,
        prompt: input.prompt,
        reasoningEffort: input.reasoningEffort ?? null,
        sequence,
        taskId: input.taskId,
      })
      .returning();

    await syncPendingQueuePositions(tx, input.taskId);

    return inserted[0];
  });

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

export const createTaskEvent = async (input: {
  createdAt?: Date;
  messageId?: string | null;
  payload: JsonObject;
  taskId: string;
  type: string;
  sandboxId?: string;
}) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO ${taskEventSequence} (${sql.identifier(taskEventSequence.taskId.name)})
      SELECT ${task.id}
      FROM ${task}
      WHERE ${task.id} = ${input.taskId}
      ON CONFLICT DO NOTHING
    `);

    const allocated = await tx
      .update(taskEventSequence)
      .set({
        nextSequence: sql`${taskEventSequence.nextSequence} + 1`,
      })
      .where(eq(taskEventSequence.taskId, input.taskId))
      .returning({ nextSequence: taskEventSequence.nextSequence });

    if (!allocated[0]) {
      return null;
    }

    const sequence = allocated[0].nextSequence - 1;
    const inserted = await tx
      .insert(taskEvent)
      .values({
        createdAt: input.createdAt ?? new Date(),
        id: crypto.randomUUID(),
        messageId: input.messageId ?? null,
        payload: stringifyPayload(input.payload),
        sequence,
        taskId: input.taskId,
        type: input.type,
        sandboxId: input.sandboxId ?? null,
        timestamp: input.createdAt ?? new Date(),
      })
      .returning();

    const row = inserted[0];

    return {
      ...row,
      parsedPayload: parseJson<JsonObject>(row.payload) ?? {},
    };
  });

export const createTaskArtifact = async (input: {
  id?: string;
  messageId?: string | null;
  metadata?: JsonObject | null;
  taskId: string;
  type: string;
  url: string;
}) => {
  const inserted = await db
    .insert(taskArtifact)
    .values({
      id: input.id ?? crypto.randomUUID(),
      messageId: input.messageId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      taskId: input.taskId,
      type: input.type,
      url: input.url,
    })
    .returning();

  const row = inserted[0];

  return {
    ...row,
    parsedMetadata: parseJson<JsonObject>(row.metadata),
  };
};

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
    const executionTimeoutAt = new Date(now.getTime() + 90 * 60 * 1000);
    const updated = await tx
      .update(taskMessage)
      .set({
        dispatchedAt: now,
        executionTimeoutAt,
        queuePosition: null,
        processingStartedAt: now,
        stage: "Dispatching prompt",
        status: "processing",
      })
      .where(and(eq(taskMessage.id, next.id), eq(taskMessage.status, "pending")))
      .returning();

    if (!updated[0]) {
      return null;
    }

    await syncPendingQueuePositions(tx, taskId, next.id);

    return updated[0];
  });

export const appendTaskMessageLog = async (messageId: string, chunk: string) => {
  if (!chunk) {
    return null;
  }

  const current = await findTaskMessage(messageId);

  if (!current) {
    return null;
  }

  return updateTaskMessageRecord(messageId, {
    logs: trimLogs(`${current.logs ?? ""}${chunk}`),
  });
};

// The agent's text is stored as the ordered blocks it produced: every block but
// the last is intermediate narration, the last one is the final answer. Keeping
// them separate is what lets the UI render the answer apart from the reasoning.
export const setTaskMessageAgentResponse = (
  messageId: string,
  blocks: string[],
  timestamp: number,
) => {
  const kept = blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(-MAX_AGENT_MESSAGES);

  if (kept.length === 0) {
    return Promise.resolve(null);
  }

  return updateTaskMessageRecord(messageId, {
    responseMessages: serializeAgentMessages(kept.map((text) => ({ text, timestamp }))),
  });
};

export const setTaskAgentResponse = async (taskId: string, text: string, timestamp: number) => {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const current = await findTaskRecord(taskId);

  if (!current) {
    return null;
  }

  return updateTaskRecord(taskId, {
    agentMessages: serializeAgentMessages([{ text: trimmed, timestamp }]),
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
      executionTimeoutAt: null,
      error: errorMessage,
      queuePosition: null,
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
        isNotNull(taskMessage.processingStartedAt),
        lt(taskMessage.processingStartedAt, staleBefore),
      ),
    )
    .orderBy(asc(taskMessage.sequence))
    .then((rows) => rows[0]);

export const recomputeTaskMessageQueuePositions = (taskId: string) =>
  db.transaction(async (tx) => {
    await syncPendingQueuePositions(tx, taskId);

    await tx
      .update(taskMessage)
      .set({
        queuePosition: null,
      })
      .where(and(eq(taskMessage.taskId, taskId), sql`${taskMessage.status} <> 'pending'`));
  });

export const findLatestCompletedMessage = (taskId: string) =>
  db
    .select()
    .from(taskMessage)
    .where(and(eq(taskMessage.taskId, taskId), isNotNull(taskMessage.completedAt)))
    .orderBy(desc(taskMessage.sequence))
    .then((rows) => rows[0]);

export const listCompletedMessagesBeforeSequence = async (taskId: string, sequence: number) => {
  const rows = await db
    .select()
    .from(taskMessage)
    .where(
      and(
        eq(taskMessage.taskId, taskId),
        eq(taskMessage.status, "completed"),
        sql`${taskMessage.sequence} < ${sequence}`,
      ),
    )
    .orderBy(asc(taskMessage.sequence), asc(taskMessage.createdAt));

  return rows.map((message) => ({
    ...message,
    parsedResponseMessages: parseAgentMessages(message.responseMessages),
  }));
};
