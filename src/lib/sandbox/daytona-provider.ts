import "@tanstack/react-start/server-only";
import { Buffer } from "node:buffer";

import {
  CodeLanguage,
  type CreateSandboxBaseParams,
  type CreateSandboxFromSnapshotParams,
  type Daytona,
  DaytonaConnectionTimeoutError,
} from "@daytona/sdk";

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

const ASYNC_ENV_PREFIX = "DIABOLO_ASYNC_ENV_";
const ASYNC_COMMAND_ENV = "DIABOLO_ASYNC_COMMAND_B64";
const ASYNC_CWD_ENV = "DIABOLO_ASYNC_CWD_B64";
const ASYNC_COMMAND_RUNNER = String.raw`node -e '
const { Buffer } = require("node:buffer");
const { spawn } = require("node:child_process");
const prefix = "DIABOLO_ASYNC_ENV_";
const decode = (value) => Buffer.from(value || "", "base64").toString("utf8");
const env = { ...process.env };
for (const [name, value] of Object.entries(process.env)) {
  if (!name.startsWith(prefix)) continue;
  env[Buffer.from(name.slice(prefix.length), "hex").toString("utf8")] = value || "";
  delete env[name];
}
const command = decode(process.env.DIABOLO_ASYNC_COMMAND_B64);
const cwd = decode(process.env.DIABOLO_ASYNC_CWD_B64) || process.cwd();
delete env.DIABOLO_ASYNC_COMMAND_B64;
delete env.DIABOLO_ASYNC_CWD_B64;
const child = spawn("/bin/sh", ["-lc", command], { cwd, env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
'`;

const encodeAsyncCommandEnvironment = (command: string, options?: Sandbox.CommandOptions) => ({
  [ASYNC_COMMAND_ENV]: Buffer.from(command, "utf8").toString("base64"),
  [ASYNC_CWD_ENV]: Buffer.from(options?.cwd ?? "", "utf8").toString("base64"),
  ...Object.fromEntries(
    Object.entries(options?.envVars ?? {}).map(([name, value]) => [
      `${ASYNC_ENV_PREFIX}${Buffer.from(name, "utf8").toString("hex")}`,
      value,
    ]),
  ),
});

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
  async downloadFile(remotePath: string, timeoutSeconds = 180) {
    return sandbox.fs.downloadFile(remotePath, timeoutSeconds);
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
  async getBackgroundCommand(command: Sandbox.BackgroundCommand) {
    let state;

    try {
      state = await sandbox.process.getSessionCommand(command.sessionId, command.commandId);
    } catch (error) {
      if (error instanceof DaytonaConnectionTimeoutError) {
        log.debug("background command status poll timed out; retrying", {
          commandId: command.commandId,
          sandboxId: sandbox.id,
          sessionId: command.sessionId,
        });

        return {
          output: "",
        };
      }

      throw error;
    }

    // Logs are read on every poll, not just once the command exits. The runtime
    // reports what the agent is doing on stdout as it happens, so waiting for an
    // exit code here would hold back the whole run's events and deliver them in
    // a single burst at the end.
    let logs;

    try {
      logs = await sandbox.process.getSessionCommandLogs(command.sessionId, command.commandId);
    } catch (error) {
      if (typeof state.exitCode !== "number" && error instanceof DaytonaConnectionTimeoutError) {
        log.debug("background command log poll timed out; retrying", {
          commandId: command.commandId,
          sandboxId: sandbox.id,
          sessionId: command.sessionId,
        });

        // Logs come back cumulative, so the next poll picks up whatever this
        // one missed. Only the final read has to succeed.
        return {
          output: "",
        };
      }

      throw error;
    }

    const output = `${logs.stdout ?? ""}${logs.stderr ?? ""}`;

    return typeof state.exitCode === "number" ? { exitCode: state.exitCode, output } : { output };
  },
  async getWorkspaceRoot() {
    return (await sandbox.getWorkDir()) ?? (await sandbox.getUserHomeDir()) ?? ".";
  },
  async startBackgroundCommand(command: string, options?: Sandbox.CommandOptions) {
    const sessionId = `diabolo-${crypto.randomUUID()}`;
    const temporaryEnvironment = encodeAsyncCommandEnvironment(command, options);
    const temporaryNames = Object.keys(temporaryEnvironment);
    let commandError: unknown;
    let commandFailed = false;
    let commandResult: Sandbox.BackgroundCommand | null = null;

    try {
      await sandbox.updateEnv(temporaryEnvironment);
      await sandbox.process.createSession(sessionId);
      const response = await sandbox.process.executeSessionCommand(sessionId, {
        command: ASYNC_COMMAND_RUNNER,
        runAsync: true,
        suppressInputEcho: true,
      });

      if (!response.cmdId) {
        throw new Error("Daytona did not return a background command id.");
      }

      commandResult = {
        commandId: response.cmdId,
        sessionId,
      };
    } catch (error) {
      commandError = error;
      commandFailed = true;
      await sandbox.process.deleteSession(sessionId).catch(() => {});
    }

    try {
      await sandbox.updateEnv({}, { unset: temporaryNames });
    } catch (error) {
      await sandbox.process.deleteSession(sessionId).catch(() => {});
      throw new Error("Failed to clear the background command environment.", {
        cause: error,
      });
    }

    if (commandFailed) {
      throw commandError;
    }

    if (!commandResult) {
      throw new Error("Daytona background command did not start.");
    }

    return commandResult;
  },
  async stop(timeoutSeconds = 120) {
    await sandbox.stop(timeoutSeconds);
  },
  async stopBackgroundCommand(command: Sandbox.BackgroundCommand) {
    await sandbox.process.deleteSession(command.sessionId).catch(() => {});
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
    async createWorkspace(repoName, options) {
      const daytona = getDaytonaClient();
      const name = makeSandboxName(repoName);
      const baseParams: CreateSandboxBaseParams = {
        autoDeleteInterval: options?.autoDeleteInterval ?? 0,
        autoStopInterval: options?.autoStopInterval ?? 30,
        language: CodeLanguage.TYPESCRIPT,
        name,
      };
      const snapshot = await getRequiredBrowserSnapshot(daytona);

      log.debug("creating sandbox", { name, snapshot });

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
