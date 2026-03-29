import "@tanstack/react-start/server-only";
import { ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { ensureOpenCodeConfig } from "@/lib/opencode/config";
import { createSpawnTaskToken, getSpawnTaskEndpoint } from "@/lib/opencode/spawn-task";
import { fromPromise, toError } from "@/lib/result";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { SandboxEvents } from "@/lib/sandbox/events";
import { SandboxQueue } from "@/lib/sandbox/queue";
import { createTaskMessage, findTaskRecord } from "@/lib/sandbox/store";
import { SandboxWorkspace } from "@/lib/sandbox/workspace";

const log = Log.create({ ns: "sandbox" });

const sandboxProvider = getSandboxProvider();

const makeJobId = () => `tk-${crypto.randomUUID()}`;

export namespace Sandbox {
  export type TaskInput = {
    envVars?: Record<string, string>;
    prompt: string;
    repoId: string;
    sourceBranch: string;
  };

  export type TaskStatus = "failed" | "queued" | "running" | "succeeded";

  export type AgentMessage = {
    text: string;
    timestamp: number;
  };

  export type TaskJob = {
    envVars?: Record<string, string>;
    id: string;
    prompt: string;
    repoId: string;
    sourceBranch: string;
    stage: string;
    startedAt: string;
    status: TaskStatus;
    userId: string;
  };

  export type CommandOptions = {
    cwd?: string;
    envVars?: Record<string, string>;
    timeoutSeconds?: number;
  };

  export type CommandResult = {
    exitCode: number;
    output: string;
  };

  export type CloneRepositoryOptions = {
    accessToken: string;
    branch: string;
    ownerLogin: string;
    targetPath: string;
    url: string;
  };

  export interface Session {
    cloneRepository(options: CloneRepositoryOptions): Promise<void>;
    delete(timeoutSeconds?: number): Promise<void>;
    executeCommand(command: string, options?: CommandOptions): Promise<CommandResult>;
    getWorkspaceRoot(): Promise<string>;
    id: string;
    name: string;
    stop(timeoutSeconds?: number): Promise<void>;
  }

  export interface Provider {
    createWorkspace(repoName: string): Promise<Session>;
    destroyWorkspace(id: string): Promise<void>;
    formatError(error: unknown): string;
    getWorkspace(id: string): Promise<Session>;
  }

  export const getProvider = () => sandboxProvider;

  export const getSpawnTaskEnvironment = (taskId: string) => ({
    OPENCODE_SPAWN_TASK_ENDPOINT: getSpawnTaskEndpoint(),
    OPENCODE_SPAWN_TASK_PARENT_ID: taskId,
    OPENCODE_SPAWN_TASK_TOKEN: createSpawnTaskToken(taskId),
  });

  export const startTask = (input: TaskInput, userId: string): ResultAsync<TaskJob, Error> =>
    fromPromise(
      (async () => {
        const prompt = input.prompt.trim();

        if (!prompt) {
          throw new Error("Prompt is required.");
        }

        if (prompt.length < 10) {
          throw new Error("Prompt must be at least 10 characters.");
        }

        const repo = await Github.getRepo(input.repoId).match(
          (value) => value,
          (error) => {
            throw error;
          },
        );

        ensureOpenCodeConfig();

        if (!repo) {
          throw new Error("Unknown repository selection.");
        }

        const startedAt = new Date().toISOString();

        return {
          envVars: input.envVars,
          id: makeJobId(),
          prompt,
          repoId: input.repoId,
          sourceBranch: input.sourceBranch.trim() || repo.defaultBranch,
          stage: "Queued",
          startedAt,
          status: "queued",
          userId,
        };
      })(),
    );

  export const enqueueTaskMessage = (
    taskId: string,
    prompt: string,
    kind: "follow_up" | "initial",
    createdByUserId?: string | null,
  ): ResultAsync<void, Error> =>
    fromPromise(
      (async () => {
        const trimmedPrompt = prompt.trim();

        if (!trimmedPrompt) {
          throw new Error("Prompt is required.");
        }

        if (trimmedPrompt.length < 10) {
          throw new Error("Prompt must be at least 10 characters.");
        }

        const message = await createTaskMessage({
          createdByUserId: createdByUserId ?? null,
          kind,
          prompt: trimmedPrompt,
          taskId,
        });
        await SandboxEvents.publish({
          messageId: message.id,
          payload: {
            prompt: trimmedPrompt,
          },
          taskId,
          type: "user_message",
        });
        await SandboxQueue.enqueue(taskId);
      })(),
    );

  export const getTask = (
    jobId: string,
  ): ResultAsync<Awaited<ReturnType<typeof findTaskRecord>>, Error> =>
    fromPromise(findTaskRecord(jobId));

  export const resumeTask = (taskId: string): ResultAsync<void, Error> =>
    fromPromise(SandboxQueue.resume(taskId));

  export const terminateTask = (jobId: string): ResultAsync<void, Error> =>
    fromPromise(SandboxQueue.terminate(jobId)).map(() => {
      log.info("task terminated", { jobId });
    });

  export const destroyTaskSandbox = (jobId: string): ResultAsync<void, Error> =>
    fromPromise(SandboxWorkspace.destroy(sandboxProvider, jobId, { stage: "Sandbox stopped" }));

  export const destroySandbox = (sandboxId: string): ResultAsync<void, Error> =>
    ResultAsync.fromPromise(
      sandboxProvider.destroyWorkspace(sandboxId).catch(() => {}),
      toError,
    ).map(() => {
      log.info("sandbox destroyed", { sandboxId });
    });

  export const runTaskFollowUp = (
    jobId: string,
    prompt: string,
    createdByUserId?: string | null,
  ): ResultAsync<void, Error> => enqueueTaskMessage(jobId, prompt, "follow_up", createdByUserId);
}
