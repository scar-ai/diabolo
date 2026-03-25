import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { AuthMiddleware } from "@/auth/middleware";
import { Sandbox } from "@/sandbox";
import { unwrap } from "@/util/result";

const startRepoTaskInputSchema = z.object({
  prompt: z.string().min(10),
  quickTask: z.boolean().optional().default(false),
  repoId: z.string().min(1),
  sourceBranch: z.string().min(1),
});

const getRepoTaskInputSchema = z.object({
  jobId: z.string().min(1),
});

export namespace SandboxServer {
  export const $startRepoTask = createServerFn({ method: "POST" })
    .middleware([AuthMiddleware.fresh])
    .inputValidator((data) => startRepoTaskInputSchema.parse(data))
    .handler(async ({ data, context }) => unwrap(Sandbox.startTask(data, context.user.id)));

  export const $getRepoTask = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => getRepoTaskInputSchema.parse(data))
    .handler(async ({ data }) => unwrap(Sandbox.getTask(data.jobId)));
}

export const $startRepoTask = SandboxServer.$startRepoTask;
export const $getRepoTask = SandboxServer.$getRepoTask;
