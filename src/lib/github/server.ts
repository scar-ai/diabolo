import "@tanstack/react-start/server-only";
import { _getUser } from "@/lib/auth/functions";
import { db } from "@/lib/db";
import type { GithubRepo } from "@/lib/github/types";

type GithubAccount = {
  accessToken: string;
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

type GithubViewerApiItem = {
  login: string;
  name: string | null;
  email: string | null;
};

type GithubPullRequestApiItem = {
  html_url: string;
  number: number;
};

const GITHUB_API_BASE_URL = "https://api.github.com";

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

const fetchGithub = async <T>(
  path: string,
  accessToken: string,
  init?: {
    body?: unknown;
    method?: "GET" | "POST" | "PATCH";
  },
): Promise<T> => {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `GitHub API request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
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
  const { accessToken } = await getGithubAccount();
  const repos: GithubRepo[] = [];
  let page = 1;

  while (true) {
    const pageItems = await fetchGithub<GithubRepoApiItem[]>(
      `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`,
      accessToken,
    );

    repos.push(...pageItems.map(mapGithubRepo));

    if (pageItems.length < 100) {
      break;
    }

    page += 1;
  }

  return repos;
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
  const { accessToken } = await getGithubAccount();
  const viewer = await fetchGithub<GithubViewerApiItem>("/user", accessToken);

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
  const [repo, accessToken] = await Promise.all([
    getSignedInGithubRepo(repoId),
    getSignedInGithubAccessToken(),
  ]);

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  const pullRequest = await fetchGithub<GithubPullRequestApiItem>(
    `/repos/${repo.fullName}/pulls`,
    accessToken,
    {
      body: {
        base,
        body,
        head,
        title,
      },
      method: "POST",
    },
  );

  return {
    number: pullRequest.number,
    url: pullRequest.html_url,
  };
};
