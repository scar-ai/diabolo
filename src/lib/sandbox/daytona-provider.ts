import "@tanstack/react-start/server-only";
import {
  CodeLanguage,
  type CreateSandboxBaseParams,
  type CreateSandboxFromImageParams,
  Daytona,
} from "@daytonaio/sdk";

import { env } from "@/env/server";

import type {
  CloneRepositoryOptions,
  SandboxCommandOptions,
  SandboxProvider,
  SandboxSession,
} from "./types";

const LEGACY_UNSUPPORTED_IMAGES = new Set(["daytonaio/workspace", "daytonaio/workspace:latest"]);

const sanitizeNamePart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "repo";

const makeSandboxName = (repoName: string) =>
  `task-${sanitizeNamePart(repoName)}-${Date.now().toString(36)}`;

const getConfiguredDaytonaImage = () => {
  const image = env.DAYTONA_DEFAULT_IMAGE?.trim();

  if (!image || LEGACY_UNSUPPORTED_IMAGES.has(image)) {
    return undefined;
  }

  return image;
};

const getDaytonaClient = () => {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is not configured.");
  }

  return new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL || undefined,
    target: env.DAYTONA_TARGET || undefined,
  });
};

const wrapSandbox = (sandbox: Awaited<ReturnType<Daytona["create"]>>): SandboxSession => ({
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

export const formatDaytonaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected sandbox provider error.";

  if (
    message.toLowerCase().includes("unprocessable entity") &&
    message.toLowerCase().includes("pull access denied")
  ) {
    const configuredImage = env.DAYTONA_DEFAULT_IMAGE?.trim();

    if (configuredImage) {
      return `Daytona could not pull the configured image "${configuredImage}". Clear DAYTONA_DEFAULT_IMAGE to use Daytona's default sandbox image, or set it to a valid image your Daytona target can access.`;
    }

    return "Daytona could not start the sandbox because the resolved image was not accessible. Set a valid DAYTONA_DEFAULT_IMAGE for your Daytona target, or leave it unset to use Daytona's default sandbox image.";
  }

  return message;
};

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
