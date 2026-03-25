import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";

import { AuthMiddleware } from "@/auth/middleware";
import { Github } from "@/github";
import { unwrap } from "@/util/result";

const listGithubBranchesInputSchema = z.object({
  repoFullName: z.string().min(1),
});

export namespace GithubServer {
  export const $listRepos = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .handler(async () => unwrap(Github.listRepos()));

  export const $listBranches = createServerFn({ method: "GET" })
    .middleware([AuthMiddleware.auth])
    .inputValidator((data) => listGithubBranchesInputSchema.parse(data))
    .handler(async ({ data }) => unwrap(Github.listBranches(data.repoFullName)));
}

export const $listGithubRepos = GithubServer.$listRepos;
export const $listGithubBranches = GithubServer.$listBranches;
