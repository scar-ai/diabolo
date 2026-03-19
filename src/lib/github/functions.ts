import { createServerFn } from "@tanstack/react-start";

import { listSignedInGithubRepos } from "@/lib/github/server";

export const $listGithubRepos = createServerFn({ method: "GET" }).handler(async () => {
  return listSignedInGithubRepos();
});
