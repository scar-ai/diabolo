import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { authMiddleware } from "@/lib/auth/middleware";
import { listSignedInGithubRepoBranches, listSignedInGithubRepos } from "@/lib/github/server";

const listGithubBranchesInputSchema = z.object({
  repoFullName: z.string().min(1),
});

export const $listGithubRepos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    return listSignedInGithubRepos();
  });

export const $listGithubBranches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data) => listGithubBranchesInputSchema.parse(data))
  .handler(async ({ data }) => {
    return listSignedInGithubRepoBranches(data.repoFullName);
  });
