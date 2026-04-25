import { and, asc, desc, eq, ne, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { organisationMember, user, userLlmProvider } from "@/lib/db/schema";
import { CODEX_SHARED_AUTH_PROVIDER_PREFIX } from "@/lib/opencode/codex";

export type UserLlmProviderRecord = typeof userLlmProvider.$inferSelect;

export const findUserById = (userId: string) =>
  db.query.user.findFirst({
    where: eq(user.id, userId),
  });

const getMembership = (userId: string) =>
  db.query.organisationMember.findFirst({
    where: eq(organisationMember.userId, userId),
  });

export const listUserLlmProviders = async (userId: string) => {
  const membership = await getMembership(userId);

  return db.query.userLlmProvider.findMany({
    orderBy: [desc(userLlmProvider.isDefault), asc(userLlmProvider.name), asc(userLlmProvider.id)],
    where: and(
      ne(userLlmProvider.id, `${CODEX_SHARED_AUTH_PROVIDER_PREFIX}${userId}`),
      or(
        eq(userLlmProvider.userId, userId),
        membership ? eq(userLlmProvider.orgId, membership.orgId) : undefined,
      ),
    ),
  });
};

export const findUserLlmProvider = async (userId: string, providerId: string) => {
  const membership = await getMembership(userId);

  return db.query.userLlmProvider.findFirst({
    where: and(
      eq(userLlmProvider.id, providerId),
      or(
        eq(userLlmProvider.userId, userId),
        membership ? eq(userLlmProvider.orgId, membership.orgId) : undefined,
      ),
    ),
  });
};

export const findAnyLlmProviderById = async (providerId: string) => {
  return db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });
};
