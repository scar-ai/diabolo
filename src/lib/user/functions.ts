import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { userLlmProvider } from "@/lib/db/schema/schema";
import { normalizeProviderApiKey } from "@/lib/opencode/config";
import { Org } from "@/lib/org";
import { unwrap } from "@/lib/result";
import { listUserLlmProviders } from "@/lib/user/data";

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
  scope: z.enum(["personal", "organisation"]).default("personal"),
});

const saveUserLlmProvidersInputSchema = z.object({
  providers: z.array(userLlmProviderSchema),
});

const normalizeProviders = (
  providers: Array<z.infer<typeof userLlmProviderSchema>>,
  input: {
    orgId: string | null;
    userId: string;
  },
) => {
  const seenIds = new Set<string>();
  let personalDefaultCount = 0;

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

    if (provider.scope === "personal" && provider.isDefault) {
      personalDefaultCount += 1;
    }

    return {
      id: provider.id,
      isDefault: provider.scope === "personal" ? provider.isDefault : false,
      name: provider.name.trim(),
      orgId: provider.scope === "organisation" ? input.orgId : null,
      providerApiKey:
        normalizeProviderApiKey(provider.providerApiKey) ??
        (() => {
          throw new Error("Provider API key is required.");
        })(),
      providerBaseUrl: provider.providerBaseUrl.trim(),
      providerId: provider.providerId.trim(),
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
      id: provider.id,
      isDefault: provider.isDefault,
      name: provider.name,
      scope: provider.orgId ? "organisation" : "personal",
      canManage:
        provider.orgId === null ||
        (membership?.orgId === provider.orgId && membership.role === "owner"),
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
    const membership = await unwrap(Org.getMembershipForUser(context.user.id));
    const isOrgOwner = membership?.role === "owner";

    if (!isOrgOwner && data.providers.some((provider) => provider.scope === "organisation")) {
      throw new Error("Only organisation owners can manage organisation providers.");
    }

    const providers = normalizeProviders(data.providers, {
      orgId: membership?.orgId ?? null,
      userId: context.user.id,
    });
    const personalProviders = providers.filter((provider) => provider.scope === "personal");
    const organisationProviders = providers.filter((provider) => provider.scope === "organisation");

    await db.transaction(async (tx) => {
      const existingPersonalProviders = await tx.query.userLlmProvider.findMany({
        where: eq(userLlmProvider.userId, context.user.id),
      });
      const existingOrganisationProviders =
        isOrgOwner && membership?.orgId
          ? await tx.query.userLlmProvider.findMany({
              where: eq(userLlmProvider.orgId, membership.orgId),
            })
          : [];

      const syncProviders = async (
        nextProviders: typeof personalProviders,
        existingProviders: typeof existingPersonalProviders,
      ) => {
        const nextProviderIds = new Set(nextProviders.map((provider) => provider.id));
        const existingProviderIds = new Set(existingProviders.map((provider) => provider.id));

        for (const provider of nextProviders) {
          const values = {
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
