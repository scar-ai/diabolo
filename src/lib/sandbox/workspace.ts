import type { Github } from "@/lib/github";
import type { Sandbox } from "@/lib/sandbox";
import type { TaskRecord } from "@/lib/sandbox/store";
import { findTaskRecord, updateTaskRecord } from "@/lib/sandbox/store";

import { opencodeInstallCommand } from "./opencode";

type Viewer = {
  email: string;
  login: string;
  name: string;
};

type Run = (
  sandbox: Sandbox.Session,
  taskId: string,
  messageId: string,
  command: string,
  cwd?: string,
  envVars?: Record<string, string>,
  timeout?: number,
) => Promise<{ exitCode: number; output: string }>;

const updateStage = async (
  taskId: string,
  stage: string,
  status: "queued" | "running" = "running",
) =>
  updateTaskRecord(taskId, {
    stage,
    status,
  });

export namespace SandboxWorkspace {
  export const destroy = async (
    provider: Sandbox.Provider,
    taskId: string,
    opts?: {
      stage?: string;
    },
  ) => {
    const taskRecord = await findTaskRecord(taskId);

    if (!taskRecord?.sandboxId) {
      return;
    }

    try {
      await provider.destroyWorkspace(taskRecord.sandboxId);
    } catch {}

    await updateTaskRecord(taskId, {
      sandboxPath: null,
      sandboxId: null,
      sandboxName: null,
      stage: opts?.stage ?? "Sandbox stopped",
    });
  };

  export const prepare = async (input: {
    authenticatedRemoteUrl: string;
    branch: string;
    enableStagehandTools: boolean;
    githubAccessToken: string;
    messageId: string;
    provider: Sandbox.Provider;
    repoName: string;
    repoOwnerLogin: string;
    repoUrl: string;
    run: Run;
    setupTools?: string;
    taskId: string;
    viewer: Viewer;
  }) => {
    await updateStage(input.taskId, "Booting Daytona sandbox");

    const sandbox = await input.provider.createWorkspace(input.repoName);

    await updateTaskRecord(input.taskId, {
      sandboxId: sandbox.id,
      sandboxName: sandbox.name,
      stage: "Resolving sandbox workspace",
      status: "running",
    });

    const root = await sandbox.getWorkspaceRoot();
    const sandboxPath = `${root.replace(/\/$/, "")}/${input.repoName}`;

    await updateTaskRecord(input.taskId, {
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

    await updateTaskRecord(input.taskId, {
      sandboxPath,
      stage: "Preparing git branch and OpenCode runtime",
    });

    await input.run(
      sandbox,
      input.taskId,
      input.messageId,
      setup.join("\n"),
      sandboxPath,
      undefined,
      900,
    );

    return {
      sandbox,
      sandboxPath,
    };
  };

  export const getOrCreateFollowUp = async (input: {
    authenticatedRemoteUrl: string;
    enableStagehandTools: boolean;
    githubAccessToken: string;
    messageId: string;
    provider: Sandbox.Provider;
    repo: Github.Repo;
    run: Run;
    setupTools?: string;
    taskId: string;
    taskRecord: TaskRecord;
    viewer: Viewer;
  }) => {
    if (input.taskRecord.sandboxId && input.taskRecord.sandboxPath) {
      try {
        return {
          sandbox: await input.provider.getWorkspace(input.taskRecord.sandboxId),
          sandboxPath: input.taskRecord.sandboxPath,
        };
      } catch {}
    }

    await updateStage(input.taskId, "Recreating sandbox for follow-up");

    return prepare({
      authenticatedRemoteUrl: input.authenticatedRemoteUrl,
      branch: input.taskRecord.branchName?.trim() || input.repo.defaultBranch,
      enableStagehandTools: input.enableStagehandTools,
      githubAccessToken: input.githubAccessToken,
      messageId: input.messageId,
      provider: input.provider,
      repoName: input.repo.name,
      repoOwnerLogin: input.repo.ownerLogin,
      repoUrl: input.repo.cloneUrl,
      run: input.run,
      setupTools: input.setupTools,
      taskId: input.taskId,
      viewer: input.viewer,
    });
  };
}
