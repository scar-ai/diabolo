import { queryOptions } from "@tanstack/react-query";

import { GithubServer } from "@/github/server";

export namespace GithubQuery {
  export type BranchesResult = Awaited<ReturnType<typeof GithubServer.$listBranches>>;
  export type ReposResult = Awaited<ReturnType<typeof GithubServer.$listRepos>>;

  export const repos = (userId: string) =>
    queryOptions({
      queryKey: ["github-repos", userId],
      queryFn: ({ signal }) => GithubServer.$listRepos({ signal }),
      staleTime: 5 * 60_000,
    });

  export const branches = (userId: string, repoFullName: string) =>
    queryOptions({
      queryKey: ["github-branches", userId, repoFullName],
      queryFn: ({ signal }) => GithubServer.$listBranches({ data: { repoFullName }, signal }),
      staleTime: 30_000,
    });
}

export type GithubReposResult = GithubQuery.ReposResult;
export type GithubBranchesResult = GithubQuery.BranchesResult;
export const githubReposQueryOptions = GithubQuery.repos;
export const githubBranchesQueryOptions = GithubQuery.branches;
