import "@tanstack/react-start/server-only";
import { CronExpressionParser } from "cron-parser";

import { Log } from "@/lib/log";
import { resolveOpenCodeConfig } from "@/lib/opencode/config";
import {
  insertTask,
  listEnabledScheduledTasksWithProjects,
  listScheduledTaskRuns,
  updateScheduledTask,
} from "@/lib/project/data";
import { parseStoredProjectEnvEntries, serializeProjectEnvEntries } from "@/lib/project/env";
import { Sandbox } from "@/lib/sandbox";
import { listUserLlmProviders } from "@/lib/user/data";

import { generateTaskTitle } from "./title";

const log = Log.create({ ns: "project.scheduler" });

const SCHEDULE_POLL_MS = 5_000;
const SCHEDULE_GRACE_MS = 90_000;

declare global {
  var __diaboloScheduledTaskSchedulerStarted: boolean | undefined;
  var __diaboloScheduledTaskSchedulerRunning: Promise<void> | null | undefined;
}

const getLatestRunMap = async (scheduledTaskIds: string[]) => {
  const runs = await listScheduledTaskRuns(scheduledTaskIds);
  const latestRuns = new Map<string, (typeof runs)[number]>();

  for (const run of runs) {
    if (!run.scheduledTaskId || latestRuns.has(run.scheduledTaskId)) {
      continue;
    }

    latestRuns.set(run.scheduledTaskId, run);
  }

  return latestRuns;
};

const getMostRecentScheduledAt = (scheduleCron: string, scheduleTimezone: string, now: Date) => {
  try {
    const expression = CronExpressionParser.parse(scheduleCron, {
      currentDate: now,
      tz: scheduleTimezone,
    });
    const previous = expression.prev();
    const previousIso = previous.toISOString();

    return previousIso ? new Date(previousIso) : null;
  } catch (error) {
    log.warn("invalid scheduled task expression", {
      error: error instanceof Error ? error.message : String(error),
      scheduleCron,
      scheduleTimezone,
    });
    return null;
  }
};

const processDueScheduledTasks = async () => {
  const schedules = await listEnabledScheduledTasksWithProjects();

  if (schedules.length === 0) {
    return;
  }

  const latestRuns = await getLatestRunMap(schedules.map((entry) => entry.scheduledTask.id));
  const now = new Date();

  for (const entry of schedules) {
    const { project, scheduledTask } = entry;
    const dueAt = getMostRecentScheduledAt(
      scheduledTask.scheduleCron,
      scheduledTask.scheduleTimezone,
      now,
    );

    if (!dueAt) {
      continue;
    }

    if (now.getTime() - dueAt.getTime() > SCHEDULE_GRACE_MS) {
      continue;
    }

    const latestRun = latestRuns.get(scheduledTask.id);

    if (latestRun && new Date(latestRun.startedAt).getTime() >= dueAt.getTime()) {
      continue;
    }

    const executionUserId = scheduledTask.createdByUserId ?? project.userId;

    try {
      const providers = await listUserLlmProviders(executionUserId);
      const openCodeProvider = providers.find((provider) => provider.isDefault) ?? providers[0];

      if (!openCodeProvider) {
        continue;
      }

      const openCodeConfig = resolveOpenCodeConfig({ provider: openCodeProvider });
      const draft = await Sandbox.startTask(
        {
          envVars: serializeProjectEnvEntries(parseStoredProjectEnvEntries(project.envVars)),
          openCodeConfig,
          prompt: scheduledTask.instructions,
          repoId: project.repoId,
          sourceBranch: scheduledTask.branchName ?? "",
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
        projectId: project.id,
        prompt: draft.prompt,
        repoId: draft.repoId,
        scheduledTaskId: scheduledTask.id,
        sandboxStatus: "pending",
        spawnSource: "scheduled",
        stage: `Queued scheduled task: ${scheduledTask.name}`,
        startedAt: new Date(draft.startedAt),
        status: draft.status,
        title,
      });

      await Sandbox.enqueueTaskMessage(
        createdTask.id,
        draft.prompt,
        "initial",
        executionUserId,
      ).match(
        () => undefined,
        (error) => {
          throw error;
        },
      );

      if (scheduledTask.runOnce) {
        await updateScheduledTask(scheduledTask.id, { enabled: 0 });
      }

      log.info("scheduled task queued", {
        dueAt: dueAt.toISOString(),
        projectId: project.id,
        scheduledTaskId: scheduledTask.id,
        taskId: createdTask.id,
      });
    } catch (error) {
      log.error("scheduled task failed to queue", {
        error: error instanceof Error ? error.message : String(error),
        projectId: project.id,
        scheduledTaskId: scheduledTask.id,
      });
    }
  }
};

const runSchedulerTick = async () => {
  if (globalThis.__diaboloScheduledTaskSchedulerRunning) {
    return globalThis.__diaboloScheduledTaskSchedulerRunning;
  }

  globalThis.__diaboloScheduledTaskSchedulerRunning = processDueScheduledTasks().finally(() => {
    globalThis.__diaboloScheduledTaskSchedulerRunning = null;
  });

  return globalThis.__diaboloScheduledTaskSchedulerRunning;
};

export const ensureScheduledTaskScheduler = () => {
  if (globalThis.__diaboloScheduledTaskSchedulerStarted) {
    return;
  }

  globalThis.__diaboloScheduledTaskSchedulerStarted = true;

  void runSchedulerTick();
  setInterval(() => {
    void runSchedulerTick();
  }, SCHEDULE_POLL_MS);

  log.info("scheduled task scheduler started", {
    graceMs: SCHEDULE_GRACE_MS,
    pollMs: SCHEDULE_POLL_MS,
  });
};
