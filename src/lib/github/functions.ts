import { createServerFn } from "@tanstack/react-start";

import { listSignedInGithubRepoBranches, listSignedInGithubRepos } from "@/lib/github/server";

export const $listGithubRepos = createServerFn({ method: "GET" }).handler(async () => {
  return listSignedInGithubRepos();
});

export const $listGithubBranches = createServerFn({ method: "GET" })
  .inputValidator((data: { repoFullName: string }) => data)
  .handler(async ({ data }) => {
    return listSignedInGithubRepoBranches(data.repoFullName);
  });
