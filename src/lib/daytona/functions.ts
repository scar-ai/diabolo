import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { getRepoTaskJob, startRepoTaskJob } from "@/lib/daytona/server";

const startRepoTaskInputSchema = z.object({
  prompt: z.string().min(10),
  repoId: z.string().min(1),
});

const getRepoTaskInputSchema = z.object({
  jobId: z.string().min(1),
});

export const $startRepoTask = createServerFn({ method: "POST" })
  .inputValidator((data) => startRepoTaskInputSchema.parse(data))
  .handler(async ({ data }) => {
    return startRepoTaskJob(data);
  });

export const $getRepoTask = createServerFn({ method: "GET" })
  .inputValidator((data) => getRepoTaskInputSchema.parse(data))
  .handler(async ({ data }) => {
    return getRepoTaskJob(data.jobId);
  });
