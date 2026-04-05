import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { userProviderSettings } from "@/lib/db/schema/schema";
import { findUserProviderSettings } from "@/lib/user/data";

const updateProviderSettingsInputSchema = z.object({
  providerBaseUrl: z.string(),
  providerModel: z.string(),
  providerApiKey: z.string(),
});

export const $getUserProviderSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const row = await findUserProviderSettings(context.user.id);
    return {
      providerBaseUrl: row?.providerBaseUrl ?? "",
      providerModel: row?.providerModel ?? "",
      providerApiKey: row?.providerApiKey ?? "",
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
        providerBaseUrl: data.providerBaseUrl,
        providerModel: data.providerModel,
        providerApiKey: data.providerApiKey,
      })
      .onConflictDoUpdate({
        target: userProviderSettings.userId,
        set: {
          providerBaseUrl: data.providerBaseUrl,
          providerModel: data.providerModel,
          providerApiKey: data.providerApiKey,
        },
      });
  });
