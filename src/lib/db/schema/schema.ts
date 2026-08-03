import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, integer } from "drizzle-orm/pg-core";

import { organisation } from "@/lib/org/org.sql";
import { scheduledTask } from "@/lib/project/project.sql";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userProviderSettings = pgTable(
  "user_provider_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    providerBaseUrl: text("provider_base_url"),
    providerModel: text("provider_model"),
    providerApiKey: text("provider_api_key"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("user_provider_settings_user_id_idx").on(table.userId)],
);

export const userLlmProvider = pgTable(
  "user_llm_provider",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    orgId: text("org_id").references(() => organisation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerId: text("provider_id").notNull(),
    providerKind: text("provider_kind").notNull().default("manual"),
    providerBaseUrl: text("provider_base_url"),
    providerModel: text("provider_model").notNull(),
    providerApiKey: text("provider_api_key"),
    opencodeAuth: text("opencode_auth"),
    opencodeAuthSandboxId: text("opencode_auth_sandbox_id"),
    oauthAccessToken: text("oauth_access_token"),
    oauthRefreshToken: text("oauth_refresh_token"),
    oauthAccessTokenExpiresAt: timestamp("oauth_access_token_expires_at"),
    oauthRefreshTokenExpiresAt: timestamp("oauth_refresh_token_expires_at"),
    oauthDeviceCode: text("oauth_device_code"),
    oauthDeviceCodeExpiresAt: timestamp("oauth_device_code_expires_at"),
    oauthUserCode: text("oauth_user_code"),
    oauthVerificationUri: text("oauth_verification_uri"),
    oauthVerificationUriComplete: text("oauth_verification_uri_complete"),
    oauthPollingIntervalSeconds: text("oauth_polling_interval_seconds"),
    oauthScope: text("oauth_scope"),
    oauthAuthenticatedAt: timestamp("oauth_authenticated_at"),
    oauthError: text("oauth_error"),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("user_llm_provider_user_id_idx").on(table.userId),
    index("user_llm_provider_user_id_is_default_idx").on(table.userId, table.isDefault),
    index("user_llm_provider_org_id_idx").on(table.orgId),
  ],
);

export const providerTokenUsage = pgTable(
  "provider_token_usage",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerKind: text("provider_kind").notNull(),
    providerModel: text("provider_model").notNull(),
    providerName: text("provider_name").notNull(),
    providerScope: text("provider_scope").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    orgId: text("org_id").references(() => organisation.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    messageId: text("message_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    source: text("source").notNull().default("sandbox_proxy"),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("provider_token_usage_provider_id_idx").on(table.providerId),
    index("provider_token_usage_user_id_idx").on(table.userId),
    index("provider_token_usage_org_id_idx").on(table.orgId),
    index("provider_token_usage_occurred_at_idx").on(table.occurredAt),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  scheduledTasks: many(scheduledTask),
  llmProviders: many(userLlmProvider),
  providerTokenUsage: many(providerTokenUsage),
  providerSettings: many(userProviderSettings),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const userProviderSettingsRelations = relations(userProviderSettings, ({ one }) => ({
  user: one(user, {
    fields: [userProviderSettings.userId],
    references: [user.id],
  }),
}));

export const userLlmProviderRelations = relations(userLlmProvider, ({ one }) => ({
  org: one(organisation, {
    fields: [userLlmProvider.orgId],
    references: [organisation.id],
  }),
  user: one(user, {
    fields: [userLlmProvider.userId],
    references: [user.id],
  }),
}));

export const providerTokenUsageRelations = relations(providerTokenUsage, ({ one }) => ({
  org: one(organisation, {
    fields: [providerTokenUsage.orgId],
    references: [organisation.id],
  }),
  user: one(user, {
    fields: [providerTokenUsage.userId],
    references: [user.id],
  }),
}));
