import "@tanstack/react-start/server-only";
import {
  CodeLanguage,
  type CreateSandboxBaseParams,
  type CreateSandboxFromSnapshotParams,
  type Daytona,
} from "@daytonaio/sdk";

import { formatDaytonaError, getDaytonaClient } from "@/lib/daytona/client";
import { getRequiredBrowserSnapshot } from "@/lib/daytona/snapshot";
import { Log } from "@/lib/log";

import type { Sandbox } from "./index";

const log = Log.create({ ns: "daytona" });

const sanitizeNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "repo";

const makeSandboxName = (repoName: string) =>
  `task-${sanitizeNamePart(repoName)}-${Date.now().toString(36)}`;

const wrapSandbox = (sandbox: Awaited<ReturnType<Daytona["create"]>>): Sandbox.Session => ({
  id: sandbox.id,
  name: sandbox.name,
  async cloneRepository(options: Sandbox.CloneRepositoryOptions) {
    await sandbox.git.clone(
      options.url,
      options.targetPath,
      options.branch,
      undefined,
      options.ownerLogin,
      options.accessToken,
    );
  },
  async delete(timeoutSeconds = 120) {
    await sandbox.delete(timeoutSeconds);
  },
  async executeCommand(command: string, options?: Sandbox.CommandOptions) {
    const response = await sandbox.process.executeCommand(
      command,
      options?.cwd,
      options?.envVars,
      options?.timeoutSeconds ?? 0,
    );

    return {
      exitCode: response.exitCode,
      output: response.result || "",
    };
  },
  async getWorkspaceRoot() {
    return (await sandbox.getWorkDir()) ?? (await sandbox.getUserHomeDir()) ?? ".";
  },
  async stop(timeoutSeconds = 120) {
    await sandbox.stop(timeoutSeconds);
  },
  async uploadFile(localPath: string, remotePath: string, timeoutSeconds = 180) {
    await sandbox.fs.uploadFile(localPath, remotePath, timeoutSeconds);
  },
});

export const getSandboxProvider = (): Sandbox.Provider => {
  const getWorkspace = async (id: string) => {
    const daytona = getDaytonaClient();
    return wrapSandbox(await daytona.get(id));
  };

  return {
    async createWorkspace(repoName) {
      const daytona = getDaytonaClient();
      const name = makeSandboxName(repoName);
      const baseParams: CreateSandboxBaseParams = {
        autoDeleteInterval: 0,
        autoStopInterval: 30,
        language: CodeLanguage.TYPESCRIPT,
        name,
      };
      const snapshot = await getRequiredBrowserSnapshot(daytona);

      log.info("creating sandbox", { name, snapshot });

      const snapshotParams: CreateSandboxFromSnapshotParams = {
        ...baseParams,
        snapshot,
      };

      return wrapSandbox(await daytona.create(snapshotParams, { timeout: 120 }));
    },
    async destroyWorkspace(id) {
      const workspace = await getWorkspace(id);

      try {
        await workspace.stop(120);
      } catch {}

      try {
        await workspace.delete(120);
      } catch {}
    },
    formatError: formatDaytonaError,
    getWorkspace,
  };
};
