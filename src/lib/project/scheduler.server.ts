import "@tanstack/react-start/server-only";
import { CronExpressionParser } from "cron-parser";

import { Log } from "@/lib/log";
import { resolveOpenCodeConfig } from "@/lib/opencode/config";
import {
  claimNextScheduledTaskJob,
  insertScheduledTaskJobs,
  insertTask,
  listEnabledScheduledTasksWithProjects,
  markScheduledTaskJobFailed,
  markScheduledTaskJobRetrying,
  markScheduledTaskJobSucceeded,
  releaseStaleScheduledTaskJobs,
  updateScheduledTask,
} from "@/lib/project/data";
import { parseStoredProjectEnvEntries, serializeProjectEnvEntries } from "@/lib/project/env";
import { Sandbox } from "@/lib/sandbox";
import { findUserLlmProvider, listUserLlmProviders } from "@/lib/user/data";

import { generateTaskTitle } from "./title";

const log = Log.create({ ns: "project.scheduler" });

const WORKER_POLL_MS = 5_000;
const JOB_LOCK_STALE_MS = 10 * 60 * 1000;
const MAX_CATCH_UP_RUNS = 100;
const MAX_JOB_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;

declare global {
  var __diaboloScheduledTaskWorkerStarted: boolean | undefined;
  var __diaboloScheduledTaskWorkerRunning: Promise<void> | null | undefined;
  var __diaboloScheduledTaskWorkerId: string | undefined;
}

const getWorkerId = () => {
  if (!globalThis.__diaboloScheduledTaskWorkerId) {
    globalThis.__diaboloScheduledTaskWorkerId = `worker-${crypto.randomUUID()}`;
  }

  return globalThis.__diaboloScheduledTaskWorkerId;
};

const getRetryDelayMs = (attempts: number) =>
  Math.min(BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_MS);

const buildCatchUpDueDates = (input: {
  createdAt: Date;
  lastEnqueuedAt?: Date | null;
  now: Date;
  scheduleCron: string;
  scheduleTimezone: string;
}) => {
  const cursor = input.lastEnqueuedAt ?? input.createdAt;

  try {
    const expression = CronExpressionParser.parse(input.scheduleCron, {
      currentDate: cursor,
      tz: input.scheduleTimezone,
    });
    const dueDates: Date[] = [];

    while (dueDates.length < MAX_CATCH_UP_RUNS) {
      const next = expression.next();
      const dueAt = next.toDate();

      if (dueAt.getTime() > input.now.getTime()) {
        break;
      }

      dueDates.push(dueAt);
    }

    return { dueDates, truncated: dueDates.length === MAX_CATCH_UP_RUNS };
  } catch (error) {
    log.warn("invalid scheduled task expression", {
      error: error instanceof Error ? error.message : String(error),
      scheduleCron: input.scheduleCron,
      scheduleTimezone: input.scheduleTimezone,
    });

    return { dueDates: [], truncated: false };
  }
};

const dispatchDueScheduledTaskJobs = async () => {
  const schedules = await listEnabledScheduledTasksWithProjects();

  if (schedules.length === 0) {
    return;
  }

  const now = new Date();

  for (const entry of schedules) {
    const { project, scheduledTask } = entry;
    const { dueDates, truncated } = buildCatchUpDueDates({
      createdAt: scheduledTask.createdAt,
      lastEnqueuedAt: scheduledTask.lastEnqueuedAt,
      now,
      scheduleCron: scheduledTask.scheduleCron,
      scheduleTimezone: scheduledTask.scheduleTimezone,
    });

    if (dueDates.length === 0) {
      continue;
    }

    await insertScheduledTaskJobs(
      dueDates.map((dueAt) => ({
        dueAt,
        id: crypto.randomUUID(),
        maxAttempts: MAX_JOB_ATTEMPTS,
        projectId: project.id,
        scheduledTaskId: scheduledTask.id,
      })),
    );

    await updateScheduledTask(scheduledTask.id, {
      lastEnqueuedAt: dueDates.at(-1) ?? scheduledTask.lastEnqueuedAt ?? null,
      ...(truncated
        ? {
            lastAlertedAt: now,
            lastError: `Scheduled task catch-up reached the ${MAX_CATCH_UP_RUNS} run cap.`,
          }
        : {}),
    });

    log.info("scheduled task jobs dispatched", {
      dueCount: dueDates.length,
      lastDueAt: dueDates.at(-1)?.toISOString() ?? null,
      projectId: project.id,
      scheduledTaskId: scheduledTask.id,
      truncated,
    });
  }
};

const queueScheduledTaskRun = async (input: {
  dueAt: Date;
  project: Awaited<ReturnType<typeof listEnabledScheduledTasksWithProjects>>[number]["project"];
  scheduledTask: Awaited<
    ReturnType<typeof listEnabledScheduledTasksWithProjects>
  >[number]["scheduledTask"];
  scheduledTaskJobId: string;
}) => {
  const executionUserId = input.scheduledTask.createdByUserId ?? input.project.userId;
  const [selectedProvider, providers] = await Promise.all([
    input.scheduledTask.providerId
      ? findUserLlmProvider(executionUserId, input.scheduledTask.providerId)
      : Promise.resolve(null),
    listUserLlmProviders(executionUserId),
  ]);
  const openCodeProvider =
    selectedProvider ?? providers.find((provider) => provider.isDefault) ?? providers[0];

  if (input.scheduledTask.providerId && !selectedProvider) {
    throw new Error("The configured provider for this scheduled task no longer exists.");
  }

  if (!openCodeProvider) {
    throw new Error("No saved provider is available for this scheduled task.");
  }

  const openCodeConfig = await resolveOpenCodeConfig({ provider: openCodeProvider });
  const draft = await Sandbox.startTask(
    {
      envVars: serializeProjectEnvEntries(parseStoredProjectEnvEntries(input.project.envVars)),
      openCodeConfig,
      prompt: input.scheduledTask.instructions,
      repoId: input.project.repoId,
      sourceBranch: input.scheduledTask.branchName ?? "",
    },
    executionUserId,
  ).match(
    (value) => value,
    (error) => {
      throw error;
    },
  );

  const title = await generateTaskTitle(draft.prompt, openCodeConfig);
  const createdTask = await insertTask({
    branchName: draft.sourceBranch,
    createdByUserId: executionUserId,
    envVars: draft.envVars ? JSON.stringify(draft.envVars) : null,
    id: draft.id,
    opencodeModel: openCodeConfig.model,
    opencodeProviderId: openCodeConfig.selectedProviderId,
    projectId: input.project.id,
    prompt: draft.prompt,
    repoId: draft.repoId,
    scheduledTaskId: input.scheduledTask.id,
    sandboxStatus: "pending",
    spawnSource: "scheduled",
    stage: `Queued scheduled task: ${input.scheduledTask.name}`,
    startedAt: new Date(draft.startedAt),
    status: draft.status,
    title,
  });

  await Sandbox.enqueueTaskMessage(createdTask.id, draft.prompt, "initial", executionUserId).match(
    () => undefined,
    (error) => {
      throw error;
    },
  );

  await markScheduledTaskJobSucceeded({
    createdTaskId: createdTask.id,
    dueAt: input.dueAt,
    jobId: input.scheduledTaskJobId,
    now: new Date(),
    scheduledTaskId: input.scheduledTask.id,
  });

  if (input.scheduledTask.runOnce) {
    await updateScheduledTask(input.scheduledTask.id, { enabled: 0 });
  }

  log.info("scheduled task job queued", {
    dueAt: input.dueAt.toISOString(),
    projectId: input.project.id,
    scheduledTaskId: input.scheduledTask.id,
    scheduledTaskJobId: input.scheduledTaskJobId,
    taskId: createdTask.id,
  });
};

const processScheduledTaskJobs = async () => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - JOB_LOCK_STALE_MS);

  await releaseStaleScheduledTaskJobs(staleBefore);

  for (;;) {
    const claimed = await claimNextScheduledTaskJob({
      now: new Date(),
      staleBefore,
      workerId: getWorkerId(),
    });

    if (!claimed) {
      break;
    }

    try {
      await queueScheduledTaskRun({
        dueAt: claimed.scheduledTaskJob.dueAt,
        project: claimed.project,
        scheduledTask: claimed.scheduledTask,
        scheduledTaskJobId: claimed.scheduledTaskJob.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (claimed.scheduledTaskJob.attempts >= claimed.scheduledTaskJob.maxAttempts) {
        await markScheduledTaskJobFailed({
          error: message,
          jobId: claimed.scheduledTaskJob.id,
          now: new Date(),
          scheduledTaskId: claimed.scheduledTask.id,
        });

        log.error("scheduled task job exhausted retries", {
          error: message,
          projectId: claimed.project.id,
          scheduledTaskId: claimed.scheduledTask.id,
          scheduledTaskJobId: claimed.scheduledTaskJob.id,
        });
        continue;
      }

      const nextAvailableAt = new Date(
        Date.now() + getRetryDelayMs(claimed.scheduledTaskJob.attempts),
      );

      await markScheduledTaskJobRetrying({
        error: message,
        jobId: claimed.scheduledTaskJob.id,
        nextAvailableAt,
      });

      log.warn("scheduled task job retry scheduled", {
        attempts: claimed.scheduledTaskJob.attempts,
        error: message,
        nextAvailableAt: nextAvailableAt.toISOString(),
        projectId: claimed.project.id,
        scheduledTaskId: claimed.scheduledTask.id,
        scheduledTaskJobId: claimed.scheduledTaskJob.id,
      });
    }
  }
};

export const runScheduledTaskWorkerTick = async () => {
  await dispatchDueScheduledTaskJobs();
  await processScheduledTaskJobs();
};

const runWorkerTickSafely = async () => {
  if (globalThis.__diaboloScheduledTaskWorkerRunning) {
    return globalThis.__diaboloScheduledTaskWorkerRunning;
  }

  globalThis.__diaboloScheduledTaskWorkerRunning = runScheduledTaskWorkerTick()
    .catch((error) => {
      log.error("scheduled task worker tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      globalThis.__diaboloScheduledTaskWorkerRunning = null;
    });

  return globalThis.__diaboloScheduledTaskWorkerRunning;
};

export const ensureScheduledTaskScheduler = () => {
  if (globalThis.__diaboloScheduledTaskWorkerStarted) {
    return;
  }

  globalThis.__diaboloScheduledTaskWorkerStarted = true;

  void runWorkerTickSafely();
  setInterval(() => {
    void runWorkerTickSafely();
  }, WORKER_POLL_MS);

  log.info("scheduled task worker started", {
    lockStaleMs: JOB_LOCK_STALE_MS,
    maxCatchUpRuns: MAX_CATCH_UP_RUNS,
    pollMs: WORKER_POLL_MS,
    workerId: getWorkerId(),
  });
};
