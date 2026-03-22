import { createInMemoryJobStore } from "@/lib/sandbox/job-store";

import type { Sandbox } from "./index";

const MAX_LOG_LENGTH = 16_000;
const MAX_AGENT_MESSAGES = 200;

export const jobs = createInMemoryJobStore<Sandbox.TaskJob>();

export const appendJobLog = (jobId: string, chunk: string) => {
  const job = jobs.get(jobId);

  if (!job || !chunk) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    logs: `${job.logs || ""}${chunk}`.slice(-MAX_LOG_LENGTH),
  });
};

export const updateFollowUp = (
  jobId: string,
  followUpId: string,
  update: (entry: Sandbox.FollowUpEntry) => Sandbox.FollowUpEntry,
) => {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  let found = false;
  const followUpHistory = job.followUpHistory.map((entry) => {
    if (entry.id !== followUpId) {
      return entry;
    }

    found = true;
    return update(entry);
  });

  if (!found) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    followUpHistory,
  });
};

export const appendFollowUpLog = (jobId: string, followUpId: string, chunk: string) => {
  if (!chunk) {
    return;
  }

  updateFollowUp(jobId, followUpId, (entry) => ({
    ...entry,
    logs: `${entry.logs || ""}${chunk}`.slice(-MAX_LOG_LENGTH),
  }));
};

export const appendAgentMessage = (jobId: string, text: string, timestamp: number) => {
  const job = jobs.get(jobId);

  if (!job || !text.trim()) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    agentMessages: [...job.agentMessages, { text: text.trim(), timestamp }].slice(
      -MAX_AGENT_MESSAGES,
    ),
  });
};

export const appendFollowUpAgentMessage = (
  jobId: string,
  followUpId: string,
  text: string,
  timestamp: number,
) => {
  if (!text.trim()) {
    return;
  }

  updateFollowUp(jobId, followUpId, (entry) => ({
    ...entry,
    responseMessages: [...entry.responseMessages, { text: text.trim(), timestamp }].slice(
      -MAX_AGENT_MESSAGES,
    ),
  }));
};

export const updateJob = (jobId: string, patch: Partial<Sandbox.TaskJob>) => {
  const job = jobs.get(jobId);

  if (!job) {
    return;
  }

  jobs.set(jobId, {
    ...job,
    ...patch,
  });
};

export const requireJob = (jobId: string, userId?: string) => {
  const job = jobs.get(jobId);

  if (!job || (userId && job.userId !== userId)) {
    throw new Error("Task not found.");
  }

  return job;
};
