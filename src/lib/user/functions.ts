import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { userLlmProvider, userProviderSettings } from "@/lib/db/schema/schema";
import { findUserProviderSettings, listUserLlmProviders } from "@/lib/user/data";

const providerIdPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const userLlmProviderSchema = z.object({
  id: z.string().min(1),
  isDefault: z.boolean(),
  name: z.string().trim().min(1),
  providerApiKey: z.string().trim().min(1),
  providerBaseUrl: z.url(),
  providerId: z
    .string()
    .trim()
    .min(1)
    .regex(
      providerIdPattern,
      "Provider ID must use lowercase letters, numbers, hyphens, or underscores.",
    ),
  providerModel: z.string().trim().min(1),
});

const updateProviderSettingsInputSchema = z.object({
  providerBaseUrl: z.string(),
  providerModel: z.string(),
  providerApiKey: z.string(),
});

const saveUserLlmProvidersInputSchema = z.object({
  providers: z.array(userLlmProviderSchema),
});

const normalizeProviders = (
  providers: Array<z.infer<typeof userLlmProviderSchema>>,
  userId: string,
) => {
  const seenIds = new Set<string>();
  let defaultCount = 0;

  const normalized = providers.map((provider) => {
    if (seenIds.has(provider.id)) {
      throw new Error("Provider IDs must be unique.");
    }

    seenIds.add(provider.id);

    if (provider.isDefault) {
      defaultCount += 1;
    }

    return {
      id: provider.id,
      isDefault: provider.isDefault,
      name: provider.name.trim(),
      providerApiKey: provider.providerApiKey.trim(),
      providerBaseUrl: provider.providerBaseUrl.trim(),
      providerId: provider.providerId.trim(),
      providerModel: provider.providerModel.trim(),
      userId,
    };
  });

  if (defaultCount > 1) {
    throw new Error("Only one provider can be marked as default.");
  }

  return normalized;
};

export const $listUserLlmProviders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const providers = await listUserLlmProviders(context.user.id);

    return providers.map((provider) => ({
      id: provider.id,
      isDefault: provider.isDefault,
      name: provider.name,
      providerApiKey: provider.providerApiKey,
      providerBaseUrl: provider.providerBaseUrl,
      providerId: provider.providerId,
      providerModel: provider.providerModel,
    }));
  });

export const $saveUserLlmProviders = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => saveUserLlmProvidersInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    const providers = normalizeProviders(data.providers, context.user.id);

    await db.transaction(async (tx) => {
      await tx.delete(userLlmProvider).where(eq(userLlmProvider.userId, context.user.id));

      if (providers.length > 0) {
        await tx.insert(userLlmProvider).values(
          providers.map((provider) => ({
            id: provider.id,
            isDefault: provider.isDefault,
            name: provider.name,
            providerApiKey: provider.providerApiKey,
            providerBaseUrl: provider.providerBaseUrl,
            providerId: provider.providerId,
            providerModel: provider.providerModel,
            userId: provider.userId,
          })),
        );
      }
    });
  });

export const $getUserProviderSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [providers, legacy] = await Promise.all([
      listUserLlmProviders(context.user.id),
      findUserProviderSettings(context.user.id),
    ]);
    const preferred = providers.find((provider) => provider.isDefault) ?? providers[0] ?? legacy;

    return {
      providerApiKey: preferred?.providerApiKey ?? "",
      providerBaseUrl: preferred?.providerBaseUrl ?? "",
      providerModel: preferred?.providerModel ?? "",
    };
  });

export const $updateUserProviderSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data) => updateProviderSettingsInputSchema.parse(data))
  .handler(async ({ context, data }) => {
    await db
      .insert(userProviderSettings)
      .values({
        userId: context.user.id,
        providerApiKey: data.providerApiKey,
        providerBaseUrl: data.providerBaseUrl,
        providerModel: data.providerModel,
      })
      .onConflictDoUpdate({
        target: userProviderSettings.userId,
        set: {
          providerApiKey: data.providerApiKey,
          providerBaseUrl: data.providerBaseUrl,
          providerModel: data.providerModel,
        },
      });
  });
