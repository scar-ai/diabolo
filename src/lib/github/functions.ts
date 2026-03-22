import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { Github } from "@/lib/github";

const listGithubBranchesInputSchema = z.object({
  repoFullName: z.string().min(1),
});

export const $listGithubRepos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    return Github.listRepos();
  });

export const $listGithubBranches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => listGithubBranchesInputSchema.parse(data))
  .handler(async ({ data }) => {
    return Github.listBranches(data.repoFullName);
  });
