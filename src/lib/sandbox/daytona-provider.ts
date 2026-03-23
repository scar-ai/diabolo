import "@tanstack/react-start/server-only";
import {
  CodeLanguage,
  type CreateSandboxBaseParams,
  type CreateSandboxFromImageParams,
} from "@daytonaio/sdk";

import {
  formatDaytonaError,
  getConfiguredDaytonaImage,
  getDaytonaClient,
} from "@/lib/daytona/client";

import type {
  CloneRepositoryOptions,
  SandboxCommandOptions,
  SandboxProvider,
  SandboxSession,
} from "./types";

const sanitizeNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "repo";

const makeSandboxName = (repoName: string) =>
  `task-${sanitizeNamePart(repoName)}-${Date.now().toString(36)}`;

const wrapSandbox = (
  sandbox: Awaited<ReturnType<ReturnType<typeof getDaytonaClient>["create"]>>,
): SandboxSession => ({
  id: sandbox.id,
  name: sandbox.name,
  async cloneRepository(options: CloneRepositoryOptions) {
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
  async executeCommand(command: string, options?: SandboxCommandOptions) {
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
});

export const getSandboxProvider = (): SandboxProvider => {
  const getWorkspace = async (id: string) => {
    const daytona = getDaytonaClient();
    return wrapSandbox(await daytona.get(id));
  };

  return {
    async createWorkspace(repoName) {
      const daytona = getDaytonaClient();
      const baseParams: CreateSandboxBaseParams = {
        autoDeleteInterval: 0,
        autoStopInterval: 30,
        language: CodeLanguage.TYPESCRIPT,
        name: makeSandboxName(repoName),
      };
      const configuredImage = getConfiguredDaytonaImage();

      if (configuredImage) {
        const imageParams: CreateSandboxFromImageParams = {
          ...baseParams,
          image: configuredImage,
        };

        return wrapSandbox(await daytona.create(imageParams, { timeout: 120 }));
      }

      return wrapSandbox(await daytona.create(baseParams, { timeout: 120 }));
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
