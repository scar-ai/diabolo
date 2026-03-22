import "@tanstack/react-start/server-only";
import { getSignedInGithubRepo } from "@/lib/github/server";
import { ensureOpenCodeConfig } from "@/lib/opencode/config";
import { getSandboxProvider } from "@/lib/sandbox/daytona-provider";
import { buildDaytonaCustomToolSetupCommand } from "@/lib/sandbox/daytona-tools";
import { SandboxRun } from "@/lib/sandbox/run";
import { jobs, requireJob, updateJob } from "@/lib/sandbox/state";
import type { SandboxTaskInput, SandboxTaskJob } from "@/lib/sandbox/task";

const sandboxProvider = getSandboxProvider();

const makeJobId = () => `tk-${crypto.randomUUID()}`;

export const startSandboxTask = async (input: SandboxTaskInput, userId: string) => {
  const prompt = input.prompt.trim();

  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  if (prompt.length < 10) {
    throw new Error("Prompt must be at least 10 characters.");
  }

  const repo = await getSignedInGithubRepo(input.repoId);
  ensureOpenCodeConfig();

  if (!repo) {
    throw new Error("Unknown repository selection.");
  }

  const jobId = makeJobId();
  const startedAt = new Date().toISOString();
  const sourceBranch = input.sourceBranch.trim() || repo.defaultBranch;
  const job: SandboxTaskJob = {
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

export const getSandboxTask = async (jobId: string, userId?: string) => requireJob(jobId, userId);

export const terminateSandboxTask = async (jobId: string) => {
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

export const runSandboxTaskFollowUp = async (jobId: string, prompt: string, userId?: string) => {
  return SandboxRun.followUp(
    jobId,
    prompt,
    sandboxProvider,
    buildDaytonaCustomToolSetupCommand(),
    userId,
  );
};
