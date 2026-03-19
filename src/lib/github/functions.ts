import { createServerFn } from "@tanstack/react-start";

import { authMiddleware } from "@/lib/auth/middleware";
import { listSignedInGithubRepos } from "@/lib/github/server";

export const $listGithubRepos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    return listSignedInGithubRepos();
  });
