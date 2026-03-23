import type { Github } from "@/lib/github";
import type { Sandbox } from "@/lib/sandbox";

import { opencodeInstallCommand } from "./opencode";

type Viewer = {
  email: string;
  login: string;
  name: string;
};

type Run = (
  sandbox: Sandbox.Session,
  jobId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout?: number,
  options?: { followUpId?: string },
) => Promise<{ exitCode: number; output: string }>;

type Update = (jobId: string, patch: Partial<Sandbox.TaskJob>) => void;
type UpdateFollowUp = (jobId: string, followUpId: string, update: (entry: any) => any) => void;

export namespace SandboxWorkspace {
  export const destroy = async (
    provider: Sandbox.Provider,
    job: Sandbox.TaskJob,
    update: Update,
    opts?: {
      stage?: string;
    },
  ) => {
    if (!job.sandboxId) {
      return;
    }

    try {
      await provider.destroyWorkspace(job.sandboxId);
    } catch {}

    update(job.id, {
      sandboxPath: undefined,
      sandboxId: undefined,
      sandboxName: undefined,
      stage: opts?.stage ?? "Sandbox stopped",
    });
  };

  export const prepare = async (input: {
    authenticatedRemoteUrl: string;
    branch: string;
    enableStagehandTools: boolean;
    githubAccessToken: string;
    jobId: string;
    provider: Sandbox.Provider;
    repoName: string;
    repoOwnerLogin: string;
    repoUrl: string;
    run: Run;
    setupTools?: string;
    update: Update;
    viewer: Viewer;
  }) => {
    input.update(input.jobId, {
      stage: "Booting Daytona sandbox",
      status: "running",
    });

    const sandbox = await input.provider.createWorkspace(input.repoName);

    input.update(input.jobId, {
      sandboxId: sandbox.id,
      sandboxName: sandbox.name,
      stage: "Resolving sandbox workspace",
    });

    const root = await sandbox.getWorkspaceRoot();
    const sandboxPath = `${root.replace(/\/$/, "")}/${input.repoName}`;

    input.update(input.jobId, {
      sandboxPath,
      stage: "Cloning repository into sandbox",
    });

    await sandbox.cloneRepository({
      accessToken: input.githubAccessToken,
      branch: input.branch,
      ownerLogin: input.repoOwnerLogin,
      targetPath: sandboxPath,
      url: input.repoUrl,
    });

    const setup = [
      `git remote set-url origin '${input.authenticatedRemoteUrl.replace(/'/g, `'\\''`)}'`,
      `git config user.name '${input.viewer.name.replace(/'/g, `'\\''`)}'`,
      `git config user.email '${input.viewer.email.replace(/'/g, `'\\''`)}'`,
      opencodeInstallCommand,
    ];

    if (input.enableStagehandTools && input.setupTools) {
      setup.push(input.setupTools);
    }

    input.update(input.jobId, {
      sandboxPath,
      stage: "Preparing git branch and OpenCode runtime",
    });

    await input.run(sandbox, input.jobId, setup.join("\n"), sandboxPath, undefined, 900);

    return {
      sandbox,
      sandboxPath,
    };
  };

  export const followUpTarget = (repo: Github.Repo, branchName?: string) => ({
    branch: branchName?.trim() || repo.defaultBranch,
    repo,
  });

  export const markRecreated = (
    jobId: string,
    followUpId: string,
    update: Update,
    updateFollowUp: UpdateFollowUp,
  ) => {
    update(jobId, {
      stage: "Recreating sandbox for follow-up",
    });
    updateFollowUp(jobId, followUpId, (entry) => ({
      ...entry,
      stage: "Recreating sandbox for follow-up",
    }));
  };

  export const getOrCreateFollowUp = async (input: {
    authenticatedRemoteUrl: string;
    enableStagehandTools: boolean;
    followUpId: string;
    githubAccessToken: string;
    job: Sandbox.TaskJob;
    provider: Sandbox.Provider;
    repo: Github.Repo;
    run: Run;
    setupTools?: string;
    update: Update;
    updateFollowUp: UpdateFollowUp;
    viewer: Viewer;
  }) => {
    if (input.job.sandboxId && input.job.sandboxPath) {
      try {
        return {
          sandbox: await input.provider.getWorkspace(input.job.sandboxId),
          sandboxPath: input.job.sandboxPath,
        };
      } catch {}
    }

    markRecreated(input.job.id, input.followUpId, input.update, input.updateFollowUp);

    return prepare({
      authenticatedRemoteUrl: input.authenticatedRemoteUrl,
      branch: input.job.branchName?.trim() || input.repo.defaultBranch,
      enableStagehandTools: input.enableStagehandTools,
      githubAccessToken: input.githubAccessToken,
      jobId: input.job.id,
      provider: input.provider,
      repoName: input.repo.name,
      repoOwnerLogin: input.repo.ownerLogin,
      repoUrl: input.repo.cloneUrl,
      run: input.run,
      setupTools: input.setupTools,
      update: input.update,
      viewer: input.viewer,
    });
  };
}
