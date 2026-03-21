import { queryOptions } from "@tanstack/react-query";

import { $listGithubBranches, $listGithubRepos } from "./functions";

export type GithubReposResult = Awaited<ReturnType<typeof $listGithubRepos>>;
export type GithubBranchesResult = Awaited<ReturnType<typeof $listGithubBranches>>;

export const githubReposQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["github-repos", userId],
    queryFn: ({ signal }) => $listGithubRepos({ signal }),
    staleTime: 5 * 60_000,
  });

export const githubBranchesQueryOptions = (userId: string, repoFullName: string) =>
  queryOptions({
    queryKey: ["github-branches", userId, repoFullName],
    queryFn: ({ signal }) => $listGithubBranches({ data: { repoFullName }, signal }),
    staleTime: 30_000,
  });
