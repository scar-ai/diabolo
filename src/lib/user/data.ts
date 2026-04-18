import { and, asc, desc, eq, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { organisationMember, user, userLlmProvider } from "@/lib/db/schema";
import { CODEX_SHARED_AUTH_PROVIDER_PREFIX } from "@/lib/opencode/codex";

type UserLlmProviderRecord = typeof userLlmProvider.$inferSelect;

export const findUserById = (userId: string) =>
  db.query.user.findFirst({
    where: eq(user.id, userId),
  });

const getMembership = (userId: string) =>
  db.query.organisationMember.findFirst({
    where: eq(organisationMember.userId, userId),
  });

export const supportsCodexProviderSchema = async () => {
  const result = await db.execute(sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_llm_provider'
        and column_name = 'provider_kind'
    ) as present
  `);

  const row = result[0] as { present?: boolean | string | number } | undefined;
  return Boolean(row?.present === true || row?.present === "t" || row?.present === 1);
};

const legacyProviderSelection = {
  createdAt: userLlmProvider.createdAt,
  id: userLlmProvider.id,
  isDefault: userLlmProvider.isDefault,
  name: userLlmProvider.name,
  oauthAccessToken: sql<string | null>`null`.as("oauth_access_token"),
  oauthAccessTokenExpiresAt: sql<Date | null>`null`.as("oauth_access_token_expires_at"),
  oauthAuthenticatedAt: sql<Date | null>`null`.as("oauth_authenticated_at"),
  oauthDeviceCode: sql<string | null>`null`.as("oauth_device_code"),
  oauthDeviceCodeExpiresAt: sql<Date | null>`null`.as("oauth_device_code_expires_at"),
  oauthError: sql<string | null>`null`.as("oauth_error"),
  oauthPollingIntervalSeconds: sql<string | null>`null`.as("oauth_polling_interval_seconds"),
  oauthRefreshToken: sql<string | null>`null`.as("oauth_refresh_token"),
  oauthRefreshTokenExpiresAt: sql<Date | null>`null`.as("oauth_refresh_token_expires_at"),
  oauthScope: sql<string | null>`null`.as("oauth_scope"),
  oauthUserCode: sql<string | null>`null`.as("oauth_user_code"),
  oauthVerificationUri: sql<string | null>`null`.as("oauth_verification_uri"),
  oauthVerificationUriComplete: sql<string | null>`null`.as("oauth_verification_uri_complete"),
  orgId: userLlmProvider.orgId,
  providerApiKey: userLlmProvider.providerApiKey,
  providerBaseUrl: userLlmProvider.providerBaseUrl,
  providerId: userLlmProvider.providerId,
  providerKind: sql<"manual">`'manual'`.as("provider_kind"),
  providerModel: userLlmProvider.providerModel,
  updatedAt: userLlmProvider.updatedAt,
  userId: userLlmProvider.userId,
};

const legacyListUserLlmProviders = async (userId: string) => {
  const membership = await getMembership(userId);

  return db
    .select(legacyProviderSelection)
    .from(userLlmProvider)
    .where(
      or(
        eq(userLlmProvider.userId, userId),
        membership ? eq(userLlmProvider.orgId, membership.orgId) : undefined,
      ),
    )
    .orderBy(
      desc(userLlmProvider.isDefault),
      asc(userLlmProvider.name),
      asc(userLlmProvider.id),
    ) as Promise<UserLlmProviderRecord[]>;
};

const legacyFindUserLlmProvider = async (userId: string, providerId: string) => {
  const membership = await getMembership(userId);

  const rows = (await db
    .select(legacyProviderSelection)
    .from(userLlmProvider)
    .where(
      and(
        eq(userLlmProvider.id, providerId),
        or(
          eq(userLlmProvider.userId, userId),
          membership ? eq(userLlmProvider.orgId, membership.orgId) : undefined,
        ),
      ),
    )) as UserLlmProviderRecord[];

  return rows[0];
};

const legacyFindAnyProviderById = async (providerId: string) => {
  const rows = (await db
    .select(legacyProviderSelection)
    .from(userLlmProvider)
    .where(eq(userLlmProvider.id, providerId))) as UserLlmProviderRecord[];

  return rows[0];
};

export const listUserLlmProviders = async (userId: string) => {
  if (!(await supportsCodexProviderSchema())) {
    return legacyListUserLlmProviders(userId);
  }

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
  if (!(await supportsCodexProviderSchema())) {
    return legacyFindUserLlmProvider(userId, providerId);
  }

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
  if (!(await supportsCodexProviderSchema())) {
    return legacyFindAnyProviderById(providerId);
  }

  return db.query.userLlmProvider.findFirst({
    where: eq(userLlmProvider.id, providerId),
  });
};
