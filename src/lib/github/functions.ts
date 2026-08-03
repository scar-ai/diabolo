import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { Github } from "@/lib/github";
import { unwrap } from "@/lib/result";

const listGithubBranchesInputSchema = z.object({
  repoFullName: z.string().min(1),
});

const createGithubBranchInputSchema = z.object({
  branchName: z.string().trim().min(1).max(255),
  fromBranch: z.string().trim().min(1),
  repoFullName: z.string().min(1),
});

export const $listGithubRepos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => unwrap(Github.listRepos()));

export const $listGithubBranches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data) => listGithubBranchesInputSchema.parse(data))
  .handler(async ({ data }) => unwrap(Github.listBranches(data.repoFullName)));

export const $createGithubBranch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data) => createGithubBranchInputSchema.parse(data))
  .handler(async ({ data }) => unwrap(Github.createBranch(data)));
