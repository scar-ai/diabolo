import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware, freshAuthMiddleware } from "@/lib/auth/middleware";
import { Sandbox } from "@/lib/sandbox";

const startRepoTaskInputSchema = z.object({
  prompt: z.string().min(10),
  quickTask: z.boolean().optional().default(false),
  repoId: z.string().min(1),
  sourceBranch: z.string().min(1),
});

const getRepoTaskInputSchema = z.object({
  jobId: z.string().min(1),
});

export const $startRepoTask = createServerFn({ method: "POST" })
  .middleware([freshAuthMiddleware])
  .inputValidator((data) => startRepoTaskInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    return Sandbox.startTask(data, context.user.id);
  });

export const $getRepoTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => getRepoTaskInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    return Sandbox.getTask(data.jobId, context.user.id);
  });
