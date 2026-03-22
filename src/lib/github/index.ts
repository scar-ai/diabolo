import "@tanstack/react-start/server-only";
import { Octokit } from "octokit";

import { _getUser } from "@/lib/auth/functions.server";
import { db } from "@/lib/db";

export namespace Github {
  export type Repo = {
    id: string;
    name: string;
    fullName: string;
    description: string | null;
    cloneUrl: string;
    htmlUrl: string;
    ownerLogin: string;
    visibility: "public" | "private";
    defaultBranch: string;
    updatedAt: string;
  };

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

  const getOctokit = async () => {
    const { accessToken } = await getAccount();

    return new Octokit({
      auth: accessToken,
    });
  };

  const getAccount = async (): Promise<GithubAccount> => {
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

  const mapRepo = (repo: GithubRepoApiItem): Repo => ({
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

  export const listRepos = async (): Promise<Repo[]> => {
    const octokit = await getOctokit();
    const repos = (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      affiliation: "owner,collaborator,organization_member",
      per_page: 100,
      sort: "updated",
      visibility: "all",
    })) as GithubRepoApiItem[];

    return repos.map(mapRepo);
  };

  export const getRepo = async (repoId: string): Promise<Repo | null> => {
    const repos = await listRepos();
    return repos.find((repo) => repo.id === repoId) ?? null;
  };

  export const getAccessToken = async () => {
    const account = await getAccount();
    return account.accessToken;
  };

  export const getViewer = async () => {
    const octokit = await getOctokit();
    const { data: viewer } = await octokit.rest.users.getAuthenticated();

    return {
      email: viewer.email || `${viewer.login}@users.noreply.github.com`,
      login: viewer.login,
      name: viewer.name || viewer.login,
    };
  };

  export const getAuthenticatedRemoteUrl = async (repoId: string) => {
    const [repo, accessToken] = await Promise.all([getRepo(repoId), getAccessToken()]);

    if (!repo) {
      throw new Error("Unknown repository selection.");
    }

    const encodedToken = encodeURIComponent(accessToken);

    return `https://x-access-token:${encodedToken}@github.com/${repo.fullName}.git`;
  };

  export const createPullRequest = async ({
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
    const [repo, octokit] = await Promise.all([getRepo(repoId), getOctokit()]);

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

  export const createPullRequestComment = async ({
    body,
    prNumber,
    repoId,
  }: {
    body: string;
    prNumber: number;
    repoId: string;
  }) => {
    const [repo, octokit] = await Promise.all([getRepo(repoId), getOctokit()]);

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

  export const listBranches = async (repoFullName: string) => {
    const { accessToken } = await getAccount();

    const branches = await fetchGithub<GithubBranch[]>(
      `/repos/${repoFullName}/branches?per_page=100`,
      accessToken,
    );

    return branches.map((branch) => ({ name: branch.name }));
  };
}
