import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema/schema";
import { completeCodexLogin, disconnectCodexProvider, startCodexLogin } from "@/lib/opencode/codex";
import { OPENAI_CODEX_RESPONSES_PROVIDER_ID, normalizeProviderApiKey } from "@/lib/opencode/config";
import { Org } from "@/lib/org";
import { unwrap } from "@/lib/result";
import {
  findUserLlmProvider,
  listUserLlmProviders,
  supportsCodexProviderSchema,
} from "@/lib/user/data";

const providerIdPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const userLlmProviderSchema = z.object({
  authStatus: z.enum(["connected", "disconnected", "pending"]).optional(),
  codexAuthenticatedAt: z.string().nullable().optional(),
  codexAuthError: z.string().nullable().optional(),
  id: z.string().min(1),
  isDefault: z.boolean(),
  name: z.string().trim().min(1),
  providerApiKey: z.string().optional().default(""),
  providerBaseUrl: z.string().optional().default(""),
  providerKind: z.enum(["codex", "manual"]).default("manual"),
  providerId: z
    .string()
    .trim()
    .min(1)
    .regex(
      providerIdPattern,
      "Provider ID must use lowercase letters, numbers, hyphens, or underscores.",
    ),
  providerModel: z.string().trim().min(1),
  scope: z.enum(["personal", "organisation"]).default("personal"),
});

const saveUserLlmProvidersInputSchema = z.object({
  providers: z.array(userLlmProviderSchema),
});

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
      return {
        id: provider.id,
        isDefault: provider.scope === "personal" ? provider.isDefault : false,
        name: provider.name.trim(),
        oauthAccessToken: existingProvider?.oauthAccessToken ?? null,
        oauthAccessTokenExpiresAt: existingProvider?.oauthAccessTokenExpiresAt ?? null,
        oauthAuthenticatedAt: existingProvider?.oauthAuthenticatedAt ?? null,
        oauthDeviceCode: existingProvider?.oauthDeviceCode ?? null,
        oauthDeviceCodeExpiresAt: existingProvider?.oauthDeviceCodeExpiresAt ?? null,
        oauthError: existingProvider?.oauthError ?? null,
        oauthPollingIntervalSeconds: existingProvider?.oauthPollingIntervalSeconds ?? null,
        oauthRefreshToken: existingProvider?.oauthRefreshToken ?? null,
        oauthRefreshTokenExpiresAt: existingProvider?.oauthRefreshTokenExpiresAt ?? null,
        oauthScope: existingProvider?.oauthScope ?? null,
        oauthUserCode: existingProvider?.oauthUserCode ?? null,
        oauthVerificationUri: existingProvider?.oauthVerificationUri ?? null,
        oauthVerificationUriComplete: existingProvider?.oauthVerificationUriComplete ?? null,
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

export const $saveUserLlmProviders = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => saveUserLlmProvidersInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const membership = await unwrap(Org.getMembershipForUser(context.user.id));
    const isOrgOwner = membership?.role === "owner";
    const hasCodexSchema = await supportsCodexProviderSchema();

    if (!isOrgOwner && data.providers.some((provider) => provider.scope === "organisation")) {
      throw new Error("Only organisation owners can manage organisation providers.");
    }

    if (!hasCodexSchema && data.providers.some((provider) => provider.providerKind === "codex")) {
      throw new Error(
        "Codex providers require the latest database migration. Run `pnpm db migrate`.",
      );
    }

    const existingPersonalProviders = hasCodexSchema
      ? await db.query.userLlmProvider.findMany({
          where: eq(userLlmProvider.userId, context.user.id),
        })
      : (await listUserLlmProviders(context.user.id)).filter(
          (provider) => provider.userId === context.user.id,
        );
    const existingOrganisationProviders =
      isOrgOwner && membership?.orgId
        ? hasCodexSchema
          ? await db.query.userLlmProvider.findMany({
              where: eq(userLlmProvider.orgId, membership.orgId),
            })
          : (await listUserLlmProviders(context.user.id)).filter(
              (provider) => provider.orgId === membership.orgId,
            )
        : [];
    const existingProviders = [...existingPersonalProviders, ...existingOrganisationProviders];
    const providers = normalizeProviders(data.providers, existingProviders, {
      orgId: membership?.orgId ?? null,
      userId: context.user.id,
    });
    const personalProviders = providers.filter((provider) => provider.scope === "personal");
    const organisationProviders = providers.filter((provider) => provider.scope === "organisation");

    await db.transaction(async (tx) => {
      const syncProviders = async (
        nextProviders: typeof personalProviders,
        existingProviders: typeof existingPersonalProviders,
      ) => {
        const nextProviderIds = new Set(nextProviders.map((provider) => provider.id));
        const existingProviderIds = new Set(existingProviders.map((provider) => provider.id));

        for (const provider of nextProviders) {
          const values = hasCodexSchema
            ? {
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
              }
            : {
                isDefault: provider.isDefault,
                name: provider.name,
                orgId: provider.orgId,
                providerApiKey: provider.providerApiKey,
                providerBaseUrl: provider.providerBaseUrl,
                providerId: provider.providerId,
                providerModel: provider.providerModel,
                userId: provider.userId,
              };

          if (existingProviderIds.has(provider.id)) {
            await tx.update(userLlmProvider).set(values).where(eq(userLlmProvider.id, provider.id));
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

      await syncProviders(personalProviders, existingPersonalProviders);

      if (isOrgOwner && membership?.orgId) {
        await syncProviders(organisationProviders, existingOrganisationProviders);
      }
    });
  });

const codexProviderInputSchema = z.object({
  providerId: z.string().min(1),
});

const loadOwnedCodexProvider = async (userId: string, providerId: string) => {
  const provider = await findUserLlmProvider(userId, providerId);

  if (!provider) {
    throw new Error("Provider not found.");
  }

  if (provider.userId !== userId) {
    throw new Error("Only personal Codex providers can be managed here.");
  }

  if (provider.providerKind !== "codex") {
    throw new Error("Selected provider is not a Codex provider.");
  }

  return provider;
};

export const $startCodexDeviceAuthorization = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => codexProviderInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const provider = await loadOwnedCodexProvider(context.user.id, data.providerId);
    return startCodexLogin(provider);
  });

const completeCodexLoginInputSchema = z.object({
  callbackUrl: z.string().min(1),
  providerId: z.string().min(1),
});

export const $completeCodexLogin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => completeCodexLoginInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const provider = await loadOwnedCodexProvider(context.user.id, data.providerId);
    return completeCodexLogin(provider, data.callbackUrl);
  });

export const $disconnectCodexProvider = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => codexProviderInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const provider = await loadOwnedCodexProvider(context.user.id, data.providerId);
    await disconnectCodexProvider(provider.id);
  });
