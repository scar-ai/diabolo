import "@tanstack/react-start/server-only";
import { ResultAsync } from "neverthrow";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { ensureOpenCodeConfig } from "@/lib/opencode/config";
import { fromPromise, toError } from "@/lib/result";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { buildDaytonaCustomToolSetupCommand } from "@/lib/sandbox/daytona-tools";
import { SandboxRun } from "@/lib/sandbox/run";
import { jobs, requireJob, updateJob } from "@/lib/sandbox/state";

const log = Log.create({ ns: "sandbox" });

const sandboxProvider = getSandboxProvider();

const makeJobId = () => `tk-${crypto.randomUUID()}`;

const FRONTEND_TASK_PATTERN =
  /\b(frontend|ui|ux|browser|screenshot|screen shot|visual|css|tailwind|layout|responsive|component|shadcn|page|modal|dialog|dropdown|form|button|input|navbar|sidebar|header|footer|computer use|computer-use|desktop|gui|click|type|typing|keyboard|mouse|preview|daytona mcp|use daytona|daytona tool|sandbox browser|open the browser|open browser|checkout the file|check out the file)\b/i;

export namespace Sandbox {
  export type TaskInput = {
    prompt: string;
    quickTask: boolean;
    repoId: string;
    sourceBranch: string;
  };

  export type TaskStatus = "failed" | "queued" | "running" | "succeeded";

  export type AgentMessage = {
    text: string;
    timestamp: number;
  };

  export type FollowUpEntry = {
    completedAt?: string;
    error?: string;
    id: string;
    logs?: string;
    prompt: string;
    responseMessages: AgentMessage[];
    stage: string;
    startedAt: string;
    status: TaskStatus;
  };

  export type TaskJob = {
    agentMessages: AgentMessage[];
    branchName?: string;
    completedAt?: string;
    error?: string;
    followUpHistory: FollowUpEntry[];
    id: string;
    logs?: string;
    prNumber?: number;
    prUrl?: string;
    prompt: string;
    quickTask: boolean;
    repoId: string;
    repoName?: string;
    repoUrl?: string;
    sandboxId?: string;
    sandboxName?: string;
    sandboxPath?: string;
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

  export const isFrontendTaskPrompt = (prompt: string) => FRONTEND_TASK_PATTERN.test(prompt);

  export const startTask = (input: TaskInput, userId: string): ResultAsync<TaskJob, Error> =>
    fromPromise(
      (async () => {
        const prompt = input.prompt.trim();
        if (!prompt) throw new Error("Prompt is required.");
        if (prompt.length < 10) throw new Error("Prompt must be at least 10 characters.");

        const repo = await Github.getRepo(input.repoId).match(
          (r) => r,
          (e) => {
            throw e;
          },
        );

        ensureOpenCodeConfig();

        if (!repo) throw new Error("Unknown repository selection.");

        const jobId = makeJobId();
        const startedAt = new Date().toISOString();
        const sourceBranch = input.sourceBranch.trim() || repo.defaultBranch;
        const job: TaskJob = {
          agentMessages: [],
          followUpHistory: [],
          id: jobId,
          prompt,
          quickTask: input.quickTask,
          repoId: input.repoId,
          sourceBranch,
          stage: "Queued",
          startedAt,
          status: "queued",
          userId,
        };

        jobs.set(jobId, job);
        log.info("task queued", { jobId, repoId: input.repoId, quickTask: input.quickTask });

        queueMicrotask(() => {
          void SandboxRun.task(
            jobId,
            {
              prompt,
              quickTask: input.quickTask,
              repoId: input.repoId,
              sourceBranch: input.sourceBranch,
            },
            sandboxProvider,
            buildDaytonaCustomToolSetupCommand(),
          );
        });

        return job;
      })(),
    );

  export const getTask = (jobId: string, userId?: string): ResultAsync<TaskJob, Error> =>
    ResultAsync.fromSafePromise(Promise.resolve(requireJob(jobId, userId)));

  export const terminateTask = (jobId: string): ResultAsync<void, Error> =>
    ResultAsync.fromSafePromise(
      Promise.resolve().then(() => {
        const job = jobs.get(jobId);
        if (!job) return;

        updateJob(jobId, {
          completedAt: new Date().toISOString(),
          error: "Task was terminated by user.",
          stage: "Terminated",
          status: "failed",
        });

        log.info("task terminated", { jobId });
      }),
    );

  export const destroyTaskSandbox = (jobId: string, userId?: string): ResultAsync<void, Error> =>
    fromPromise(SandboxRun.destroy(jobId, sandboxProvider, "Sandbox stopped", userId));

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
    userId?: string,
  ): ResultAsync<void, Error> =>
    fromPromise(
      SandboxRun.followUp(
        jobId,
        prompt,
        sandboxProvider,
        buildDaytonaCustomToolSetupCommand(),
        userId,
      ),
    );
}
