import "@tanstack/react-start/server-only";
import { Github } from "@/lib/github";
import { ensureOpenCodeConfig } from "@/lib/opencode/config";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { buildDaytonaCustomToolSetupCommand } from "@/lib/sandbox/daytona-tools";
import { SandboxRun } from "@/lib/sandbox/run";
import { jobs, requireJob, updateJob } from "@/lib/sandbox/state";

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

  export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

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
    sandboxPath?: string;
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
    sourceBranch: string;
    userId: string;
    sandboxId?: string;
    sandboxName?: string;
    stage: string;
    startedAt: string;
    status: TaskStatus;
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
    id: string;
    name: string;
    cloneRepository(options: CloneRepositoryOptions): Promise<void>;
    delete(timeoutSeconds?: number): Promise<void>;
    executeCommand(command: string, options?: CommandOptions): Promise<CommandResult>;
    getWorkspaceRoot(): Promise<string>;
    stop(timeoutSeconds?: number): Promise<void>;
  }

  export interface Provider {
    createWorkspace(repoName: string): Promise<Session>;
    destroyWorkspace(id: string): Promise<void>;
    formatError(error: unknown): string;
    getWorkspace(id: string): Promise<Session>;
  }

  export const isFrontendTaskPrompt = (prompt: string) => FRONTEND_TASK_PATTERN.test(prompt);

  export const startTask = async (input: TaskInput, userId: string) => {
    const prompt = input.prompt.trim();

    if (!prompt) {
      throw new Error("Prompt is required.");
    }

    if (prompt.length < 10) {
      throw new Error("Prompt must be at least 10 characters.");
    }

    const repo = await Github.getRepo(input.repoId);
    ensureOpenCodeConfig();

    if (!repo) {
      throw new Error("Unknown repository selection.");
    }

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
  };

  export const getTask = async (jobId: string, userId?: string) => requireJob(jobId, userId);

  export const terminateTask = async (jobId: string) => {
    const job = jobs.get(jobId);

    if (!job) {
      return;
    }

    updateJob(jobId, {
      completedAt: new Date().toISOString(),
      error: "Task was terminated by user.",
      stage: "Terminated",
      status: "failed",
    });
  };

  export const destroyTaskSandbox = async (jobId: string, userId?: string) => {
    await SandboxRun.destroy(jobId, sandboxProvider, "Sandbox stopped", userId);
  };

  export const destroySandbox = async (sandboxId: string) => {
    try {
      await sandboxProvider.destroyWorkspace(sandboxId);
    } catch {}
  };

  export const runTaskFollowUp = async (jobId: string, prompt: string, userId?: string) => {
    return SandboxRun.followUp(
      jobId,
      prompt,
      sandboxProvider,
      buildDaytonaCustomToolSetupCommand(),
      userId,
    );
  };
}
