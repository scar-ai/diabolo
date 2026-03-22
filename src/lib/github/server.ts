import "@tanstack/react-start/server-only";
import { Octokit } from "octokit";

import { _getUser } from "@/lib/auth/functions.server";
import { db } from "@/lib/db";
import type { GithubRepo } from "@/lib/github/types";

type GithubAccount = {
  accessToken: string;
};

type GithubBranch = {
  name: string;
};

type GithubRepoApiItem = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  clone_url: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
  owner: {
    login: string;
  };
};

const fetchGithub = async <TData>(path: string, accessToken: string): Promise<TData> => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}.`);
  }

  return response.json() as Promise<TData>;
};

const getGithubOctokit = async () => {
  const { accessToken } = await getGithubAccount();

  return new Octokit({
    auth: accessToken,
  });
};

const getGithubAccount = async (): Promise<GithubAccount> => {
  const user = await _getUser({ disableCookieCache: true });
  if (!user) {
    throw new Error("You must be signed in.");
  }

  const githubAccount = await db.query.account.findFirst({
    where: (account, { and, eq }) =>
      and(eq(account.userId, user.id), eq(account.providerId, "github")),
  });

  if (!githubAccount?.accessToken) {
    throw new Error("Connect a GitHub account to load your repositories.");
  }

  return {
    accessToken: githubAccount.accessToken,
  };
};

const mapGithubRepo = (repo: GithubRepoApiItem): GithubRepo => ({
  id: String(repo.id),
  name: repo.name,
  fullName: repo.full_name,
  description: repo.description,
  cloneUrl: repo.clone_url,
  htmlUrl: repo.html_url,
  ownerLogin: repo.owner.login,
  visibility: repo.private ? "private" : "public",
  defaultBranch: repo.default_branch,
  updatedAt: repo.updated_at,
});

export const listSignedInGithubRepos = async (): Promise<GithubRepo[]> => {
  const octokit = await getGithubOctokit();
  const repos = (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    affiliation: "owner,collaborator,organization_member",
    per_page: 100,
    sort: "updated",
    visibility: "all",
  })) as GithubRepoApiItem[];

  return repos.map(mapGithubRepo);
};

export const getSignedInGithubRepo = async (repoId: string): Promise<GithubRepo | null> => {
  const repos = await listSignedInGithubRepos();
  return repos.find((repo) => repo.id === repoId) ?? null;
};

export const getSignedInGithubAccessToken = async () => {
  const account = await getGithubAccount();
  return account.accessToken;
};

export const getSignedInGithubViewer = async () => {
  const octokit = await getGithubOctokit();
  const { data: viewer } = await octokit.rest.users.getAuthenticated();

  return {
    email: viewer.email || `${viewer.login}@users.noreply.github.com`,
    login: viewer.login,
    name: viewer.name || viewer.login,
  };
};

export const getGithubAuthenticatedRemoteUrl = async (repoId: string) => {
  const [repo, accessToken] = await Promise.all([
    getSignedInGithubRepo(repoId),
    getSignedInGithubAccessToken(),
  ]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  const encodedToken = encodeURIComponent(accessToken);

  return `https://x-access-token:${encodedToken}@github.com/${repo.fullName}.git`;
};

export const createPullRequestForSignedInGithubRepo = async ({
  base,
  body,
  head,
  repoId,
  title,
}: {
  base: string;
  body: string;
  head: string;
  repoId: string;
  title: string;
}) => {
  const [repo, octokit] = await Promise.all([getSignedInGithubRepo(repoId), getGithubOctokit()]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  const { data: pullRequest } = await octokit.rest.pulls.create({
    base,
    body,
    head,
    owner: repo.ownerLogin,
    repo: repo.name,
    title,
  });

  return {
    number: pullRequest.number,
    url: pullRequest.html_url,
  };
};

export const createPullRequestCommentForSignedInGithubRepo = async ({
  body,
  prNumber,
  repoId,
}: {
  body: string;
  prNumber: number;
  repoId: string;
}) => {
  const [repo, octokit] = await Promise.all([getSignedInGithubRepo(repoId), getGithubOctokit()]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  await octokit.rest.issues.createComment({
    body,
    issue_number: prNumber,
    owner: repo.ownerLogin,
    repo: repo.name,
  });
};

export const listSignedInGithubRepoBranches = async (repoFullName: string) => {
  const { accessToken } = await getGithubAccount();

  const branches = await fetchGithub<GithubBranch[]>(
    `/repos/${repoFullName}/branches?per_page=100`,
    accessToken,
  );

  return branches.map((branch) => ({ name: branch.name }));
};
