import "@tanstack/react-start/server-only";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { Octokit } from "octokit";
import * as R from "remeda";

import { _getUser } from "@/lib/auth/functions.server";
import { db } from "@/lib/db";
import { Log } from "@/lib/log";
import { fromPromise } from "@/lib/result";

const log = Log.create({ ns: "github" });

export namespace Github {
  export type Repo = {
    cloneUrl: string;
    defaultBranch: string;
    description: string | null;
    fullName: string;
    htmlUrl: string;
    id: string;
    name: string;
    ownerLogin: string;
    updatedAt: string;
    visibility: "private" | "public";
  };

  type GithubAccount = {
    accessToken: string;
  };

  type GithubBranch = {
    name: string;
  };

  type GithubRepoApiItem = {
    clone_url: string;
    default_branch: string;
    description: string | null;
    full_name: string;
    html_url: string;
    id: number;
    name: string;
    owner: {
      login: string;
    };
    private: boolean;
    updated_at: string;
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

    return { accessToken: githubAccount.accessToken };
  };

  const getOctokit = async () => {
    const { accessToken } = await getAccount();
    return new Octokit({ auth: accessToken });
  };

  const mapRepo = (repo: GithubRepoApiItem): Repo => ({
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
    description: repo.description,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    id: String(repo.id),
    name: repo.name,
    ownerLogin: repo.owner.login,
    updatedAt: repo.updated_at,
    visibility: repo.private ? "private" : "public",
  });

  // ---------------------------------------------------------------------------
  // Public API — all return ResultAsync
  // ---------------------------------------------------------------------------

  export const listRepos = (): ResultAsync<Repo[], Error> =>
    fromPromise(
      (async () => {
        const octokit = await getOctokit();
        const repos = (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
          affiliation: "owner,collaborator,organization_member",
          per_page: 100,
          sort: "updated",
          visibility: "all",
        })) as GithubRepoApiItem[];

        log.info("repos listed", { count: repos.length });
        return R.map(repos, mapRepo);
      })(),
    );

  export const getRepo = (repoId: string): ResultAsync<Repo | null, Error> =>
    listRepos().map((repos) => {
      const found = repos.find((repo) => repo.id === repoId) ?? null;
      if (!found) log.warn("repo not found", { repoId });
      return found;
    });

  export const requireRepo = (repoId: string): ResultAsync<Repo, Error> =>
    getRepo(repoId).andThen((repo) =>
      repo ? okAsync(repo) : errAsync(new Error("Unknown repository selection.")),
    );

  export const getAccessToken = (): ResultAsync<string, Error> =>
    fromPromise(getAccount().then((a) => a.accessToken));

  export const getViewer = (): ResultAsync<{ email: string; login: string; name: string }, Error> =>
    fromPromise(
      (async () => {
        const octokit = await getOctokit();
        const { data: viewer } = await octokit.rest.users.getAuthenticated();

        return {
          email: viewer.email || `${viewer.login}@users.noreply.github.com`,
          login: viewer.login,
          name: viewer.name || viewer.login,
        };
      })(),
    );

  export const getAuthenticatedRemoteUrl = (repoId: string): ResultAsync<string, Error> =>
    ResultAsync.combine([requireRepo(repoId), getAccessToken()]).map(([repo, token]) => {
      const encoded = encodeURIComponent(token);
      return `https://x-access-token:${encoded}@github.com/${repo.fullName}.git`;
    });

  export const createPullRequest = (input: {
    base: string;
    body: string;
    head: string;
    repoId: string;
    title: string;
  }): ResultAsync<{ number: number; url: string }, Error> =>
    ResultAsync.combine([requireRepo(input.repoId), fromPromise(getOctokit())]).andThen(
      ([repo, octokit]) =>
        fromPromise(
          octokit.rest.pulls
            .create({
              base: input.base,
              body: input.body,
              head: input.head,
              owner: repo.ownerLogin,
              repo: repo.name,
              title: input.title,
            })
            .then(({ data }) => {
              log.info("pull request created", { pr: data.number, repo: repo.fullName });
              return { number: data.number, url: data.html_url };
            }),
        ),
    );

  export const createPullRequestComment = (input: {
    body: string;
    prNumber: number;
    repoId: string;
  }): ResultAsync<void, Error> =>
    ResultAsync.combine([requireRepo(input.repoId), fromPromise(getOctokit())]).andThen(
      ([repo, octokit]) =>
        fromPromise(
          octokit.rest.issues
            .createComment({
              body: input.body,
              issue_number: input.prNumber,
              owner: repo.ownerLogin,
              repo: repo.name,
            })
            .then(() => {
              log.info("pr comment posted", { pr: input.prNumber });
            }),
        ),
    );

  export const findOpenPullRequestForBranch = (input: {
    branch: string;
    repoId: string;
  }): ResultAsync<{ number: number; url: string } | null, Error> =>
    ResultAsync.combine([requireRepo(input.repoId), fromPromise(getOctokit())]).andThen(
      ([repo, octokit]) =>
        fromPromise(
          octokit.rest.pulls
            .list({
              head: `${repo.ownerLogin}:${input.branch}`,
              owner: repo.ownerLogin,
              repo: repo.name,
              state: "open",
            })
            .then(({ data }) => {
              const pr = data[0];
              return pr ? { number: pr.number, url: pr.html_url } : null;
            }),
        ),
    );

  export const listBranches = (repoFullName: string): ResultAsync<Array<{ name: string }>, Error> =>
    fromPromise(
      (async () => {
        const { accessToken } = await getAccount();
        const branches = await fetchGithub<GithubBranch[]>(
          `/repos/${repoFullName}/branches?per_page=100`,
          accessToken,
        );

        return R.map(branches, (b) => ({ name: b.name }));
      })(),
    );

  export const lookupUserByUsername = (
    username: string,
  ): ResultAsync<{ id: string; login: string } | null, Error> =>
    fromPromise(
      (async () => {
        const { accessToken } = await getAccount();
        try {
          const data = await fetchGithub<{ id: number; login: string }>(
            `/users/${username}`,
            accessToken,
          );
          return { id: String(data.id), login: data.login };
        } catch {
          return null;
        }
      })(),
    );
}
