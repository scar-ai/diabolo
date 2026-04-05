import { asc, desc } from "drizzle-orm";

import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema";

export const findUserProviderSettings = (userId: string) =>
  db.query.userProviderSettings.findFirst({
    where: (table, { eq }) => eq(table.userId, userId),
  });

export const listUserLlmProviders = (userId: string) =>
  db.query.userLlmProvider.findMany({
    orderBy: [desc(userLlmProvider.isDefault), asc(userLlmProvider.name), asc(userLlmProvider.id)],
    where: (table, { eq }) => eq(table.userId, userId),
  });

export const findUserLlmProvider = (userId: string, providerId: string) =>
  db.query.userLlmProvider.findFirst({
    where: (table, { and, eq }) => and(eq(table.userId, userId), eq(table.id, providerId)),
  });
