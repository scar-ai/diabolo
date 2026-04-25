import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema/schema";
import {
  completeCodexLogin,
  ensureCodexSharedAuthProvider,
  disconnectCodexProvider,
  getUserSharedCodexAuthState,
  getCodexSharedAuthProviderId,
  isCodexProvider,
  listAvailableCodexModels,
  startCodexCallbackServer,
  startCodexLogin,
} from "@/lib/opencode/codex";
import { OPENAI_CODEX_RESPONSES_PROVIDER_ID, normalizeProviderApiKey } from "@/lib/opencode/config";
import { Org } from "@/lib/org";
import { unwrap } from "@/lib/result";
import { listUserLlmProviders } from "@/lib/user/data";
import { listUserProviderUsageSummary } from "@/lib/user/provider-usage";

const providerIdPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const userLlmProviderSchema = z
  .object({
    authStatus: z.enum(["connected", "disconnected", "pending"]).optional(),
    codexAuthenticatedAt: z.string().nullable().optional(),
    codexAuthError: z.string().nullable().optional(),
    id: z.string().min(1),
    isDefault: z.boolean(),
    name: z.string().trim().min(1),
    providerApiKey: z.string().optional().default(""),
    providerBaseUrl: z.string().optional().default(""),
    providerKind: z.enum(["codex", "manual"]).default("manual"),
    providerId: z.string().trim().min(1),
    providerModel: z.string().trim().min(1),
    scope: z.enum(["personal", "organisation"]).default("personal"),
  })
  .superRefine((provider, ctx) => {
    if (provider.providerKind === "codex") {
      return;
    }

    if (!providerIdPattern.test(provider.providerId)) {
      ctx.addIssue({
        code: "custom",
        message: "Provider ID must use lowercase letters, numbers, hyphens, or underscores.",
        path: ["providerId"],
      });
    }
  });

const saveUserLlmProvidersInputSchema = z.object({
  providers: z.array(userLlmProviderSchema),
});

const toSerializableError = (error: unknown, fallbackMessage: string) => {
  if (error instanceof Error && error.message.trim()) {
    return new Error(error.message);
  }

  return new Error(fallbackMessage);
};

const normalizeProviders = (
  providers: Array<z.infer<typeof userLlmProviderSchema>>,
  existingProviders: Array<Awaited<ReturnType<typeof listUserLlmProviders>>[number]>,
  input: {
    orgId: string | null;
    userId: string;
  },
) => {
  const seenIds = new Set<string>();
  let personalDefaultCount = 0;
  const existingProviderById = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );
  const sharedCodexAuthState = existingProviders
    .filter(
      (provider) =>
        provider.providerKind === "codex" &&
        provider.userId === input.userId &&
        (provider.oauthAccessToken ||
          provider.oauthRefreshToken ||
          provider.oauthDeviceCode ||
          provider.oauthUserCode ||
          provider.oauthVerificationUri ||
          provider.oauthVerificationUriComplete ||
          provider.oauthAuthenticatedAt ||
          provider.oauthError),
    )
    .sort((left, right) => {
      const leftScore =
        (left.oauthRefreshToken ? 4 : 0) +
        (left.oauthAccessToken ? 2 : 0) +
        (left.oauthDeviceCode ? 1 : 0);
      const rightScore =
        (right.oauthRefreshToken ? 4 : 0) +
        (right.oauthAccessToken ? 2 : 0) +
        (right.oauthDeviceCode ? 1 : 0);

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      const leftAuthenticatedAt = left.oauthAuthenticatedAt?.getTime() ?? 0;
      const rightAuthenticatedAt = right.oauthAuthenticatedAt?.getTime() ?? 0;

      if (leftAuthenticatedAt !== rightAuthenticatedAt) {
        return rightAuthenticatedAt - leftAuthenticatedAt;
      }

      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })[0];

  const normalized = providers.map((provider) => {
    if (seenIds.has(provider.id)) {
      throw new Error("Provider IDs must be unique.");
    }

    seenIds.add(provider.id);

    if (provider.scope === "organisation" && provider.isDefault) {
      throw new Error("Organisation providers cannot be marked as default.");
    }

    if (provider.scope === "organisation" && !input.orgId) {
      throw new Error("Join an organisation before saving organisation providers.");
    }

    if (provider.providerKind === "codex" && provider.scope !== "personal") {
      throw new Error("Codex providers can only be personal.");
    }

    if (provider.scope === "personal" && provider.isDefault) {
      personalDefaultCount += 1;
    }

    const existingProvider = existingProviderById.get(provider.id);

    if (provider.providerKind === "codex") {
      const sourceProvider = existingProvider ?? sharedCodexAuthState;

      return {
        id: provider.id,
        isDefault: provider.scope === "personal" ? provider.isDefault : false,
        name: provider.name.trim(),
        oauthAccessToken: sourceProvider?.oauthAccessToken ?? null,
        oauthAccessTokenExpiresAt: sourceProvider?.oauthAccessTokenExpiresAt ?? null,
        oauthAuthenticatedAt: sourceProvider?.oauthAuthenticatedAt ?? null,
        oauthDeviceCode: sourceProvider?.oauthDeviceCode ?? null,
        oauthDeviceCodeExpiresAt: sourceProvider?.oauthDeviceCodeExpiresAt ?? null,
        oauthError: sourceProvider?.oauthError ?? null,
        oauthPollingIntervalSeconds: sourceProvider?.oauthPollingIntervalSeconds ?? null,
        oauthRefreshToken: sourceProvider?.oauthRefreshToken ?? null,
        oauthRefreshTokenExpiresAt: sourceProvider?.oauthRefreshTokenExpiresAt ?? null,
        oauthScope: sourceProvider?.oauthScope ?? null,
        oauthUserCode: sourceProvider?.oauthUserCode ?? null,
        oauthVerificationUri: sourceProvider?.oauthVerificationUri ?? null,
        oauthVerificationUriComplete: sourceProvider?.oauthVerificationUriComplete ?? null,
        orgId: null,
        providerApiKey: null,
        providerBaseUrl: null,
        providerId: OPENAI_CODEX_RESPONSES_PROVIDER_ID,
        providerKind: "codex" as const,
        providerModel: provider.providerModel.trim(),
        scope: provider.scope,
        userId: input.userId,
      };
    }

    const normalizedApiKey = normalizeProviderApiKey(provider.providerApiKey);
    const normalizedBaseUrl = provider.providerBaseUrl.trim();

    if (!normalizedBaseUrl) {
      throw new Error("Provider API base URL is required.");
    }

    if (!normalizedApiKey) {
      throw new Error("Provider API key is required.");
    }

    try {
      new URL(normalizedBaseUrl);
    } catch {
      throw new Error("Provider API base URL must be a valid URL.");
    }

    return {
      id: provider.id,
      isDefault: provider.scope === "personal" ? provider.isDefault : false,
      name: provider.name.trim(),
      orgId: provider.scope === "organisation" ? input.orgId : null,
      oauthAccessToken: null,
      oauthAccessTokenExpiresAt: null,
      oauthAuthenticatedAt: null,
      oauthDeviceCode: null,
      oauthDeviceCodeExpiresAt: null,
      oauthError: null,
      oauthPollingIntervalSeconds: null,
      oauthRefreshToken: null,
      oauthRefreshTokenExpiresAt: null,
      oauthScope: null,
      oauthUserCode: null,
      oauthVerificationUri: null,
      oauthVerificationUriComplete: null,
      providerApiKey: normalizedApiKey,
      providerBaseUrl: normalizedBaseUrl,
      providerId: provider.providerId.trim(),
      providerKind: "manual" as const,
      providerModel: provider.providerModel.trim(),
      scope: provider.scope,
      userId: provider.scope === "personal" ? input.userId : null,
    };
  });

  if (personalDefaultCount > 1) {
    throw new Error("Only one provider can be marked as default.");
  }

  return normalized;
};

const getProviderWriteValues = (provider: ReturnType<typeof normalizeProviders>[number]) => ({
  isDefault: provider.isDefault,
  name: provider.name,
  orgId: provider.orgId,
  oauthAccessToken: provider.oauthAccessToken,
  oauthAccessTokenExpiresAt: provider.oauthAccessTokenExpiresAt,
  oauthAuthenticatedAt: provider.oauthAuthenticatedAt,
  oauthDeviceCode: provider.oauthDeviceCode,
  oauthDeviceCodeExpiresAt: provider.oauthDeviceCodeExpiresAt,
  oauthError: provider.oauthError,
  oauthPollingIntervalSeconds: provider.oauthPollingIntervalSeconds,
  oauthRefreshToken: provider.oauthRefreshToken,
  oauthRefreshTokenExpiresAt: provider.oauthRefreshTokenExpiresAt,
  oauthScope: provider.oauthScope,
  oauthUserCode: provider.oauthUserCode,
  oauthVerificationUri: provider.oauthVerificationUri,
  oauthVerificationUriComplete: provider.oauthVerificationUriComplete,
  providerApiKey: provider.providerApiKey,
  providerBaseUrl: provider.providerBaseUrl,
  providerId: provider.providerId,
  providerKind: provider.providerKind,
  providerModel: provider.providerModel,
  userId: provider.userId,
});

export const $listUserLlmProviders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const providers = await listUserLlmProviders(context.user.id);
    const membership = await unwrap(Org.getMembershipForUser(context.user.id));

    return providers.map((provider) => ({
      authStatus:
        provider.providerKind === "codex"
          ? provider.oauthAccessToken && provider.oauthAuthenticatedAt
            ? "connected"
            : provider.oauthDeviceCode
              ? "pending"
              : "disconnected"
          : "connected",
      codexAuthenticatedAt: provider.oauthAuthenticatedAt?.toISOString() ?? null,
      codexAuthError: provider.oauthError,
      id: provider.id,
      isDefault: provider.isDefault,
      name: provider.name,
      providerKind: provider.providerKind === "codex" ? "codex" : "manual",
      scope: provider.orgId ? "organisation" : "personal",
      canManage:
        provider.orgId === null ||
        (membership?.orgId === provider.orgId && membership.role === "owner"),
      providerApiKey: provider.providerKind === "codex" ? "" : (provider.providerApiKey ?? ""),
      providerBaseUrl: provider.providerBaseUrl ?? "",
      providerId:
        provider.providerKind === "codex"
          ? OPENAI_CODEX_RESPONSES_PROVIDER_ID
          : provider.providerId,
      providerModel: provider.providerModel,
    }));
  });

export const $getCodexSharedLoginStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const provider = await ensureCodexSharedAuthProvider(context.user.id);
    const sharedState =
      (await getUserSharedCodexAuthState(context.user.id, provider.id)) ?? provider;

    return {
      authStatus:
        isCodexProvider(provider) &&
        sharedState.oauthAccessToken &&
        sharedState.oauthAuthenticatedAt
          ? "connected"
          : sharedState.oauthDeviceCode
            ? "pending"
            : "disconnected",
      codexAuthenticatedAt: sharedState.oauthAuthenticatedAt?.toISOString() ?? null,
      codexAuthError: sharedState.oauthError ?? null,
    } as const;
  });

export const $listAvailableCodexModels = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const provider = await ensureCodexSharedAuthProvider(context.user.id);
    return listAvailableCodexModels(provider);
  });

export const $getUserProviderUsageSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => listUserProviderUsageSummary(context.user.id));

export const $saveUserLlmProviders = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => saveUserLlmProvidersInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    try {
      const membership = await unwrap(Org.getMembershipForUser(context.user.id));
      const isOrgOwner = membership?.role === "owner";

      if (!isOrgOwner && data.providers.some((provider) => provider.scope === "organisation")) {
        throw new Error("Only organisation owners can manage organisation providers.");
      }

      const existingPersonalProviders = await db.query.userLlmProvider.findMany({
        where: eq(userLlmProvider.userId, context.user.id),
      });
      const existingOrganisationProviders =
        isOrgOwner && membership?.orgId
          ? await db.query.userLlmProvider.findMany({
              where: eq(userLlmProvider.orgId, membership.orgId),
            })
          : [];
      const hiddenCodexSharedProviderId = getCodexSharedAuthProviderId(context.user.id);
      const visibleExistingPersonalProviders = existingPersonalProviders.filter(
        (provider) => provider.id !== hiddenCodexSharedProviderId,
      );
      const existingProviders = [...existingPersonalProviders, ...existingOrganisationProviders];
      const providers = normalizeProviders(data.providers, existingProviders, {
        orgId: membership?.orgId ?? null,
        userId: context.user.id,
      });
      const personalProviders = providers.filter((provider) => provider.scope === "personal");
      const organisationProviders = providers.filter(
        (provider) => provider.scope === "organisation",
      );

      await db.transaction(async (tx) => {
        const syncProviders = async (
          nextProviders: typeof personalProviders,
          existingProviders: typeof existingPersonalProviders,
        ) => {
          const nextProviderIds = new Set(nextProviders.map((provider) => provider.id));
          const existingProviderIds = new Set(existingProviders.map((provider) => provider.id));

          for (const provider of nextProviders) {
            const values = getProviderWriteValues(provider);

            if (existingProviderIds.has(provider.id)) {
              await tx
                .update(userLlmProvider)
                .set(values)
                .where(eq(userLlmProvider.id, provider.id));
              continue;
            }

            await tx.insert(userLlmProvider).values({
              id: provider.id,
              ...values,
            });
          }

          for (const provider of existingProviders) {
            if (!nextProviderIds.has(provider.id)) {
              await tx.delete(userLlmProvider).where(eq(userLlmProvider.id, provider.id));
            }
          }
        };

        await syncProviders(personalProviders, visibleExistingPersonalProviders);

        if (isOrgOwner && membership?.orgId) {
          await syncProviders(organisationProviders, existingOrganisationProviders);
        }
      });
    } catch (error) {
      throw toSerializableError(error, "Failed to save providers.");
    }
  });

export const $startCodexDeviceAuthorization = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const provider = await ensureCodexSharedAuthProvider(context.user.id);
      const result = await startCodexLogin(provider);
      const callbackServerStarted = await startCodexCallbackServer(provider.id);
      return { ...result, callbackServerStarted };
    } catch (error) {
      throw toSerializableError(error, "Failed to start Codex login.");
    }
  });

const completeCodexLoginInputSchema = z.object({
  callbackUrl: z.string().min(1),
});

export const $completeCodexLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => completeCodexLoginInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    try {
      const provider = await ensureCodexSharedAuthProvider(context.user.id);
      return completeCodexLogin(provider, data.callbackUrl);
    } catch (error) {
      throw toSerializableError(error, "Failed to complete Codex login.");
    }
  });

export const $disconnectCodexProvider = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    try {
      const provider = await ensureCodexSharedAuthProvider(context.user.id);
      await disconnectCodexProvider(provider.id);
    } catch (error) {
      throw toSerializableError(error, "Failed to disconnect Codex provider.");
    }
  });
