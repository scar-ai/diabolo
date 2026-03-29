import { Buffer } from "node:buffer";

import type { Github } from "@/lib/github";
import { formatProjectEnvVarsForDotEnv } from "@/lib/project/env";
import type { Sandbox } from "@/lib/sandbox";
import { SandboxRuntimeState } from "@/lib/sandbox/runtime-state";
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
  SandboxRuntimeState.setTaskStage({
    stage,
    status,
    taskId,
  });

const PROJECT_ENV_START_MARKER = "# >>> diabolo project env >>>";
const PROJECT_ENV_END_MARKER = "# <<< diabolo project env <<<";

const escapeForSingleQuotedShell = (value: string) => value.replace(/'/g, `'\\''`);

const buildProjectEnvSyncCommand = (envVars?: Record<string, string>) => {
  const projectEnvBlock = envVars ? formatProjectEnvVarsForDotEnv(envVars) : "";
  const block = projectEnvBlock
    ? `${PROJECT_ENV_START_MARKER}\n${projectEnvBlock}\n${PROJECT_ENV_END_MARKER}\n`
    : "";
  const blockB64 = Buffer.from(block, "utf8").toString("base64");

  return [
    `export DIABOLO_PROJECT_ENV_BLOCK_B64='${escapeForSingleQuotedShell(blockB64)}'`,
    "node - <<'JS'",
    "const fs = require('fs');",
    `const startMarker = ${JSON.stringify(PROJECT_ENV_START_MARKER)};`,
    `const endMarker = ${JSON.stringify(PROJECT_ENV_END_MARKER)};`,
    "const envPath = '.env';",
    "const block = Buffer.from(process.env.DIABOLO_PROJECT_ENV_BLOCK_B64 || '', 'base64').toString('utf8');",
    "let existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';",
    "const start = existing.indexOf(startMarker);",
    "const end = existing.indexOf(endMarker);",
    "if (start !== -1 && end !== -1 && end >= start) {",
    "  existing = existing.slice(0, start).replace(/[\\r\\n]+$/, '');",
    "}",
    "if (block) {",
    "  existing = existing.replace(/[\\r\\n]+$/, '');",
    "  fs.writeFileSync(envPath, existing ? existing + '\\n\\n' + block : block);",
    "} else if (existing) {",
    "  fs.writeFileSync(envPath, existing.replace(/[\\r\\n]+$/, '') + '\\n');",
    "} else if (fs.existsSync(envPath)) {",
    "  fs.unlinkSync(envPath);",
    "}",
    "JS",
  ].join("\n");
};

const syncProjectEnvFile = async (input: {
  envVars?: Record<string, string>;
  messageId: string;
  run: Run;
  sandbox: Sandbox.Session;
  sandboxPath: string;
  taskId: string;
}) =>
  input.run(
    input.sandbox,
    input.taskId,
    input.messageId,
    buildProjectEnvSyncCommand(input.envVars),
    input.sandboxPath,
    undefined,
    120,
  );

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

    await SandboxRuntimeState.setSandboxStatus(taskId, "stopped", {
      sandboxPath: null,
      sandboxId: null,
      sandboxName: null,
      stage: opts?.stage ?? "Sandbox stopped",
    });
  };

  export const prepare = async (input: {
    authenticatedRemoteUrl: string;
    branch: string;
    envVars?: Record<string, string>;
    githubAccessToken: string;
    messageId: string;
    provider: Sandbox.Provider;
    repoName: string;
    repoOwnerLogin: string;
    repoUrl: string;
    run: Run;
    taskId: string;
    viewer: Viewer;
  }) => {
    try {
      await updateStage(input.taskId, "Getting your sandbox ready");
      await SandboxRuntimeState.setSandboxStatus(input.taskId, "spawning");

      const sandbox = await input.provider.createWorkspace(input.repoName);

      await SandboxRuntimeState.setSandboxStatus(input.taskId, "ready", {
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

      await SandboxRuntimeState.setSandboxStatus(input.taskId, "running", {
        sandboxPath,
        stage: "Preparing git branch and agent runtime",
      });

      await input.run(
        sandbox,
        input.taskId,
        input.messageId,
        setup.join("\n"),
        sandboxPath,
        input.envVars,
        900,
      );

      await syncProjectEnvFile({
        envVars: input.envVars,
        messageId: input.messageId,
        run: input.run,
        sandbox,
        sandboxPath,
        taskId: input.taskId,
      });

      return {
        sandbox,
        sandboxPath,
      };
    } catch (error) {
      await SandboxRuntimeState.markSpawnFailure(
        input.taskId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  };

  export const getOrCreateFollowUp = async (input: {
    authenticatedRemoteUrl: string;
    githubAccessToken: string;
    messageId: string;
    provider: Sandbox.Provider;
    repo: Github.Repo;
    run: Run;
    taskId: string;
    taskRecord: TaskRecord;
    envVars?: Record<string, string>;
    viewer: Viewer;
  }) => {
    if (input.taskRecord.sandboxId && input.taskRecord.sandboxPath) {
      try {
        const sandbox = await input.provider.getWorkspace(input.taskRecord.sandboxId);

        await syncProjectEnvFile({
          envVars: input.envVars,
          messageId: input.messageId,
          run: input.run,
          sandbox,
          sandboxPath: input.taskRecord.sandboxPath,
          taskId: input.taskId,
        });

        return {
          sandbox,
          sandboxPath: input.taskRecord.sandboxPath,
        };
      } catch {}
    }

    await updateStage(input.taskId, "Recreating sandbox for follow-up");

    return prepare({
      authenticatedRemoteUrl: input.authenticatedRemoteUrl,
      branch: input.taskRecord.branchName?.trim() || input.repo.defaultBranch,
      envVars: input.envVars,
      githubAccessToken: input.githubAccessToken,
      messageId: input.messageId,
      provider: input.provider,
      repoName: input.repo.name,
      repoOwnerLogin: input.repo.ownerLogin,
      repoUrl: input.repo.cloneUrl,
      run: input.run,
      taskId: input.taskId,
      viewer: input.viewer,
    });
  };
}
