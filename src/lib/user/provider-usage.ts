import "@tanstack/react-start/server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { providerTokenUsage } from "@/lib/db/schema/schema";

const PROVIDER_USAGE_WINDOW_DAYS = 30;

const startOfDay = (value: Date) => {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
};

const getWindowStart = () => {
  const end = startOfDay(new Date());
  end.setDate(end.getDate() - (PROVIDER_USAGE_WINDOW_DAYS - 1));
  return end;
};

const normalizeOptionalId = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

export const parseProviderUsageLog = (raw: string) =>
  raw.split("\n").flatMap((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        cacheCreationTokens?: unknown;
        cacheReadTokens?: unknown;
        inputTokens?: unknown;
        outputTokens?: unknown;
        reasoningTokens?: unknown;
        timestamp?: unknown;
        totalTokens?: unknown;
        type?: unknown;
      };

      if (parsed.type !== "usage") {
        return [];
      }

      const inputTokens =
        typeof parsed.inputTokens === "number" && Number.isFinite(parsed.inputTokens)
          ? Math.max(0, Math.round(parsed.inputTokens))
          : 0;
      const outputTokens =
        typeof parsed.outputTokens === "number" && Number.isFinite(parsed.outputTokens)
          ? Math.max(0, Math.round(parsed.outputTokens))
          : 0;
      const cacheCreationTokens =
        typeof parsed.cacheCreationTokens === "number" &&
        Number.isFinite(parsed.cacheCreationTokens)
          ? Math.max(0, Math.round(parsed.cacheCreationTokens))
          : 0;
      const cacheReadTokens =
        typeof parsed.cacheReadTokens === "number" && Number.isFinite(parsed.cacheReadTokens)
          ? Math.max(0, Math.round(parsed.cacheReadTokens))
          : 0;
      const reasoningTokens =
        typeof parsed.reasoningTokens === "number" && Number.isFinite(parsed.reasoningTokens)
          ? Math.max(0, Math.round(parsed.reasoningTokens))
          : 0;
      const totalTokens =
        typeof parsed.totalTokens === "number" && Number.isFinite(parsed.totalTokens)
          ? Math.max(0, Math.round(parsed.totalTokens))
          : inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens + reasoningTokens;
      const occurredAt =
        typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp)
          ? new Date(parsed.timestamp)
          : new Date();

      if (totalTokens <= 0) {
        return [];
      }

      return [
        {
          cacheCreationTokens,
          cacheReadTokens,
          inputTokens,
          occurredAt,
          outputTokens,
          reasoningTokens,
          totalTokens,
        },
      ];
    } catch {
      return [];
    }
  });

export const recordProviderUsageEvents = async (input: {
  messageId: string;
  model: string;
  provider: {
    id: string;
    name: string;
    orgId?: string | null;
    providerKind: string;
    userId?: string | null;
  };
  source?: string;
  taskId: string;
  usageEvents: ReturnType<typeof parseProviderUsageLog>;
}) => {
  if (input.usageEvents.length === 0) {
    return;
  }

  const orgId = normalizeOptionalId(input.provider.orgId);
  const userId = normalizeOptionalId(input.provider.userId);

  await db.insert(providerTokenUsage).values(
    input.usageEvents.map((event) => ({
      cacheCreationTokens: event.cacheCreationTokens,
      cacheReadTokens: event.cacheReadTokens,
      id: crypto.randomUUID(),
      inputTokens: event.inputTokens,
      messageId: input.messageId,
      occurredAt: event.occurredAt,
      orgId,
      outputTokens: event.outputTokens,
      providerId: input.provider.id,
      providerKind: input.provider.providerKind,
      providerModel: input.model,
      providerName: input.provider.name,
      providerScope: orgId ? "organisation" : "personal",
      reasoningTokens: event.reasoningTokens,
      source: input.source ?? "sandbox_proxy",
      taskId: input.taskId,
      totalTokens: event.totalTokens,
      userId,
    })),
  );
};

const buildUsageSummary = async (where: ReturnType<typeof and> | undefined) => {
  const windowStart = getWindowStart();
  const scopedWhere = and(where, gte(providerTokenUsage.occurredAt, windowStart));

  const [dailyRows, providerRows] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${providerTokenUsage.occurredAt}), 'YYYY-MM-DD')`,
        providerId: providerTokenUsage.providerId,
        providerName: providerTokenUsage.providerName,
        totalTokens: sql<number>`coalesce(sum(${providerTokenUsage.totalTokens}), 0)`,
      })
      .from(providerTokenUsage)
      .where(scopedWhere)
      .groupBy(
        sql`date_trunc('day', ${providerTokenUsage.occurredAt})`,
        providerTokenUsage.providerId,
        providerTokenUsage.providerName,
      )
      .orderBy(
        asc(sql`date_trunc('day', ${providerTokenUsage.occurredAt})`),
        asc(providerTokenUsage.providerName),
      ),
    db
      .select({
        inputTokens: sql<number>`coalesce(sum(${providerTokenUsage.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${providerTokenUsage.outputTokens}), 0)`,
        providerId: providerTokenUsage.providerId,
        providerKind: providerTokenUsage.providerKind,
        providerName: providerTokenUsage.providerName,
        totalTokens: sql<number>`coalesce(sum(${providerTokenUsage.totalTokens}), 0)`,
      })
      .from(providerTokenUsage)
      .where(scopedWhere)
      .groupBy(
        providerTokenUsage.providerId,
        providerTokenUsage.providerKind,
        providerTokenUsage.providerName,
      )
      .orderBy(
        desc(sql`coalesce(sum(${providerTokenUsage.totalTokens}), 0)`),
        asc(providerTokenUsage.providerName),
      ),
  ]);

  return {
    days: dailyRows.map((row) => ({
      date: row.date,
      providerId: row.providerId,
      providerName: row.providerName,
      totalTokens: Number(row.totalTokens),
    })),
    periodDays: PROVIDER_USAGE_WINDOW_DAYS,
    periodStart: windowStart.toISOString(),
    providers: providerRows.map((row) => ({
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      providerId: row.providerId,
      providerKind: row.providerKind,
      providerName: row.providerName,
      totalTokens: Number(row.totalTokens),
    })),
  };
};

export const listUserProviderUsageSummary = (userId: string) =>
  buildUsageSummary(
    and(eq(providerTokenUsage.providerScope, "personal"), eq(providerTokenUsage.userId, userId)),
  );

export const listOrganisationProviderUsageSummary = (orgId: string) =>
  buildUsageSummary(
    and(eq(providerTokenUsage.providerScope, "organisation"), eq(providerTokenUsage.orgId, orgId)),
  );
