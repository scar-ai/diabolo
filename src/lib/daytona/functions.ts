import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware, freshAuthMiddleware } from "@/lib/auth/middleware";
import { getRepoTaskJob, startRepoTaskJob } from "@/lib/daytona/server";

const startRepoTaskInputSchema = z.object({
  prompt: z.string().min(10),
  repoId: z.string().min(1),
});

const getRepoTaskInputSchema = z.object({
  jobId: z.string().min(1),
});

export const $startRepoTask = createServerFn({ method: "POST" })
  .middleware([freshAuthMiddleware])
  .inputValidator((data) => startRepoTaskInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    return startRepoTaskJob(data, context.user.id);
  });

export const $getRepoTask = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => getRepoTaskInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    return getRepoTaskJob(data.jobId, context.user.id);
  });
