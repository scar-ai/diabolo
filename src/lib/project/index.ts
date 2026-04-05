import { errAsync, okAsync, ResultAsync } from "neverthrow";
import * as R from "remeda";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import { type OpenCodeConfig, resolveOpenCodeConfig } from "@/lib/opencode/config";
import { Org } from "@/lib/org";
import {
  normalizeProjectEnvEntries,
  parseStoredProjectEnvEntries,
  serializeProjectEnvEntries,
  type ProjectEnvEntry,
} from "@/lib/project/env";
import { ensureScheduledTaskScheduler } from "@/lib/project/scheduler.server";
import {
  normalizeProjectSkills,
  parseStoredProjectSkills,
  type ProjectSkillEntry,
} from "@/lib/project/skills";
import { fromPromise } from "@/lib/result";
import { Sandbox } from "@/lib/sandbox";
import { findUserLlmProvider, listUserLlmProviders } from "@/lib/user/data";

import {
  deleteScheduledTask,
  deleteProject,
  deleteTask,
  findOwnedProject,
  findProject,
  findProjectScheduledTask,
  findProjectTask,
  findTask,
  findTaskWithProject,
  findUserTask,
  insertProject,
  insertScheduledTask,
  insertTask,
  listChildTaskSummaries,
  listProjectIds,
  listProjectScheduledTasks,
  listProjectTasks,
  listProjects,
  listUserTaskSummaries,
  listUserTasks,
  updateProject,
  updateScheduledTask,
  updateTask,
  type ProjectRecord as TProjectRecord,
  type TaskForUserRecord as TTaskForUserRecord,
} from "./data";
import {
  assertParentCanSpawn,
  buildTaskDetail,
  destroyTaskSandboxRecord,
  publishChildTaskUpdate,
  queueFollowUpPrompt,
  syncTaskRuntime,
  syncTaskSummaryRuntime,
  terminateTaskRecord,
  type TaskDetailRecord as TTaskDetailRecord,
} from "./runtime";
import {
  buildTaskTitle,
  RUNNING_TASK_STATUSES,
  type TaskMessageRecord as TTaskMessageRecord,
  type TaskRecord as TTaskRecord,
  type TaskSummaryRecord as TTaskSummaryRecord,
} from "./shared";
import { generateTaskTitle } from "./title";

const log = Log.create({ ns: "project" });

export type { ProjectId, TaskId } from "./shared";
export { ProjectMembers } from "./members";

export namespace Project {
  export type ProjectRecord = TProjectRecord;
  export type TaskRecord = TTaskRecord;
  export type ScheduledTaskRecord = import("./data").ScheduledTaskRecord;
  export type TaskMessageRecord = TTaskMessageRecord;
  export type TaskSummaryRecord = TTaskSummaryRecord;
  export type TaskForUserRecord = TTaskForUserRecord;
  export type TaskDetailRecord = TTaskDetailRecord;

  /** Require project access: owner OR member. Used by most operations. */
  const requireUserProject = (projectId: string, userId: string) =>
    fromPromise(findProject(projectId, userId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Project not found.")),
    );

  /** Require project ownership. Used by privileged operations (delete, settings). */
  const requireOwnedProject = (projectId: string, userId: string) =>
    fromPromise(findOwnedProject(projectId, userId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Project not found.")),
    );

  const requireTaskForProject = (projectId: string, taskId: string) =>
    fromPromise(findProjectTask(taskId, projectId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Task not found.")),
    );

  const requireTaskForUser = (taskId: string, userId: string) =>
    fromPromise(findUserTask(taskId, userId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Task not found.")),
    );

  const requireScheduledTaskForProject = (projectId: string, scheduledTaskId: string) =>
    fromPromise(findProjectScheduledTask(scheduledTaskId, projectId)).andThen((value) =>
      value ? okAsync(value) : errAsync(new Error("Scheduled task not found.")),
    );

  const resolveTaskOpenCodeConfig = (
    userId: string,
    providerRecordId?: string | null,
    model?: string | null,
  ): ResultAsync<OpenCodeConfig, Error> =>
    fromPromise(
      Promise.all([
        providerRecordId ? findUserLlmProvider(userId, providerRecordId) : Promise.resolve(null),
        listUserLlmProviders(userId),
      ]),
    ).andThen(([provider, providers]) => {
      if (providerRecordId && !provider) {
        return errAsync(new Error("Selected provider was not found."));
      }

      const resolvedProvider =
        provider ?? providers.find((value) => value.isDefault) ?? providers[0] ?? null;

      if (!resolvedProvider) {
        return errAsync(new Error("Add at least one provider in Settings before starting a task."));
      }

      try {
        return okAsync(
          resolveOpenCodeConfig({
            model,
            provider: resolvedProvider,
          }),
        );
      } catch (error) {
        return errAsync(error instanceof Error ? error : new Error(String(error)));
      }
    });

  export const createProjectForUser = (input: {
    name: string;
    repoId: string;
    userId: string;
  }): ResultAsync<ProjectRecord, Error> =>
    fromPromise(
      insertProject({
        id: crypto.randomUUID(),
        name: input.name,
        repoId: input.repoId,
        userId: input.userId,
      }),
    ).map((value) => {
      log.info("project created", { projectId: value.id });
      return value;
    });

  export const listProjectsForUser = (userId: string): ResultAsync<ProjectRecord[], Error> =>
    fromPromise(listProjects(userId));

  export const getProjectForUser = (
    projectId: string,
    userId: string,
  ): ResultAsync<
    ProjectRecord & {
      envEntries: ProjectEnvEntry[];
      skills: ProjectSkillEntry[];
      repoDefaultBranch: string | null;
      repoDescription: string | null;
      repoFullName: string | null;
      repoHtmlUrl: string | null;
    },
    Error
  > =>
    requireUserProject(projectId, userId).andThen((value) =>
      Github.getRepo(value.repoId).map((repo) => ({
        ...value,
        envEntries: parseStoredProjectEnvEntries(value.envVars),
        skills: parseStoredProjectSkills(value.agentSkills),
        repoDefaultBranch: repo?.defaultBranch ?? null,
        repoDescription: repo?.description ?? null,
        repoFullName: repo?.fullName ?? null,
        repoHtmlUrl: repo?.htmlUrl ?? null,
      })),
    );

  export const deleteProjectForUser = (
    projectId: string,
    userId: string,
  ): ResultAsync<void, Error> =>
    requireOwnedProject(projectId, userId)
      .andThen(() => fromPromise(deleteProject(projectId)))
      .map(() => {
        log.info("project deleted", { projectId });
      });

  export const updateProjectSettingsForUser = (input: {
    envEntries: ProjectEnvEntry[];
    projectId: string;
    shareWithOrganisation: boolean;
    skills: ProjectSkillEntry[];
    userId: string;
  }): ResultAsync<ProjectRecord, Error> =>
    requireOwnedProject(input.projectId, input.userId).andThen(() =>
      Org.getMembershipForUser(input.userId).andThen((membership) => {
        if (input.shareWithOrganisation && !membership) {
          return errAsync(new Error("Join an organisation before sharing projects with it."));
        }

        return fromPromise(
          updateProject(input.projectId, {
            agentSkills: JSON.stringify(normalizeProjectSkills(input.skills)),
            envVars: JSON.stringify(normalizeProjectEnvEntries(input.envEntries)),
            sharedWithOrgId: input.shareWithOrganisation ? (membership?.orgId ?? null) : null,
          }),
        ).andThen((value) => (value ? okAsync(value) : errAsync(new Error("Project not found."))));
      }),
    );

  export const createTaskForUser = (input: {
    providerId?: string | null;
    projectId: string;
    prompt: string;
    sourceBranch: string;
    userId: string;
  }): ResultAsync<TaskRecord, Error> => {
    const op = log.child({ projectId: input.projectId, userId: input.userId });

    return requireUserProject(input.projectId, input.userId)
      .andThen((value) =>
        resolveTaskOpenCodeConfig(input.userId, input.providerId ?? null).map((openCodeConfig) => ({
          openCodeConfig,
          project: value,
        })),
      )
      .andThen(({ openCodeConfig, project }) =>
        Sandbox.startTask(
          {
            envVars: serializeProjectEnvEntries(parseStoredProjectEnvEntries(project.envVars)),
            openCodeConfig,
            prompt: input.prompt,
            repoId: project.repoId,
            sourceBranch: input.sourceBranch,
          },
          input.userId,
        ).map((draft) => ({ draft, openCodeConfig })),
      )
      .andThen(({ draft, openCodeConfig }) =>
        fromPromise(generateTaskTitle(draft.prompt, openCodeConfig)).andThen((title) =>
          fromPromise(
            insertTask({
              branchName: draft.sourceBranch,
              createdByUserId: input.userId,
              envVars: draft.envVars ? JSON.stringify(draft.envVars) : null,
              id: draft.id,
              opencodeModel: openCodeConfig.model,
              opencodeProviderId: openCodeConfig.selectedProviderId,
              projectId: input.projectId,
              prompt: draft.prompt,
              repoId: draft.repoId,
              sandboxStatus: "pending",
              stage: draft.stage,
              startedAt: new Date(draft.startedAt),
              status: draft.status,
              title,
            }),
          ).andThen((createdTask) =>
            Sandbox.enqueueTaskMessage(createdTask.id, draft.prompt, "initial", input.userId).map(
              () => createdTask,
            ),
          ),
        ),
      )
      .map((value) => {
        op.info("task created", { taskId: value.id });
        return value;
      });
  };

  export const createTaskForScheduledTask = (input: {
    projectId: string;
    prompt: string;
    scheduledTaskId: string;
    sourceBranch: string;
    userId: string;
  }): ResultAsync<TaskRecord, Error> => {
    const op = log.child({
      projectId: input.projectId,
      scheduledTaskId: input.scheduledTaskId,
      userId: input.userId,
    });

    return requireUserProject(input.projectId, input.userId)
      .andThen((project) =>
        requireScheduledTaskForProject(input.projectId, input.scheduledTaskId).map(
          (scheduledTask) => ({
            project,
            scheduledTask,
          }),
        ),
      )
      .andThen(({ project, scheduledTask }) =>
        resolveTaskOpenCodeConfig(input.userId).map((openCodeConfig) => ({
          openCodeConfig,
          project,
          scheduledTask,
        })),
      )
      .andThen(({ openCodeConfig, project, scheduledTask }) =>
        Sandbox.startTask(
          {
            envVars: serializeProjectEnvEntries(parseStoredProjectEnvEntries(project.envVars)),
            openCodeConfig,
            prompt: input.prompt,
            repoId: project.repoId,
            sourceBranch: input.sourceBranch,
          },
          input.userId,
        ).map((draft) => ({ draft, openCodeConfig, scheduledTask })),
      )
      .andThen(({ draft, openCodeConfig }) =>
        fromPromise(generateTaskTitle(draft.prompt, openCodeConfig)).andThen((title) =>
          fromPromise(
            insertTask({
              branchName: draft.sourceBranch,
              createdByUserId: input.userId,
              envVars: draft.envVars ? JSON.stringify(draft.envVars) : null,
              id: draft.id,
              opencodeModel: openCodeConfig.model,
              opencodeProviderId: openCodeConfig.selectedProviderId,
              projectId: input.projectId,
              prompt: draft.prompt,
              repoId: draft.repoId,
              scheduledTaskId: input.scheduledTaskId,
              sandboxStatus: "pending",
              spawnSource: "scheduled",
              stage: draft.stage,
              startedAt: new Date(draft.startedAt),
              status: draft.status,
              title,
            }),
          ).andThen((createdTask) =>
            Sandbox.enqueueTaskMessage(createdTask.id, draft.prompt, "initial", input.userId).map(
              () => createdTask,
            ),
          ),
        ),
      )
      .map((value) => {
        op.info("scheduled task run created", { taskId: value.id });
        return value;
      });
  };

  export const createScheduledTaskForUser = (input: {
    branchName?: string | null;
    instructions: string;
    name: string;
    projectId: string;
    runOnce?: boolean;
    scheduleCron: string;
    scheduleTimezone: string;
    userId: string;
  }): ResultAsync<ScheduledTaskRecord, Error> => {
    ensureScheduledTaskScheduler();

    return requireUserProject(input.projectId, input.userId).andThen(() =>
      fromPromise(
        insertScheduledTask({
          branchName: input.branchName ?? null,
          createdByUserId: input.userId,
          id: crypto.randomUUID(),
          instructions: input.instructions,
          name: input.name,
          projectId: input.projectId,
          runOnce: input.runOnce ? 1 : 0,
          scheduleCron: input.scheduleCron,
          scheduleTimezone: input.scheduleTimezone,
        }),
      ),
    );
  };

  export const listScheduledTasksForProject = (
    projectId: string,
    userId: string,
  ): ResultAsync<ScheduledTaskRecord[], Error> => {
    ensureScheduledTaskScheduler();

    return requireUserProject(projectId, userId).andThen(() =>
      fromPromise(listProjectScheduledTasks(projectId)),
    );
  };

  export const updateScheduledTaskForUser = (input: {
    branchName?: string | null;
    instructions: string;
    name: string;
    projectId: string;
    runOnce: boolean;
    scheduleCron: string;
    scheduleTimezone: string;
    scheduledTaskId: string;
    userId: string;
  }): ResultAsync<ScheduledTaskRecord, Error> =>
    requireUserProject(input.projectId, input.userId)
      .andThen(() => requireScheduledTaskForProject(input.projectId, input.scheduledTaskId))
      .andThen(() =>
        fromPromise(
          updateScheduledTask(input.scheduledTaskId, {
            branchName: input.branchName ?? null,
            instructions: input.instructions,
            name: input.name,
            runOnce: input.runOnce ? 1 : 0,
            scheduleCron: input.scheduleCron,
            scheduleTimezone: input.scheduleTimezone,
          }),
        ),
      );

  export const deleteScheduledTaskForUser = (
    projectId: string,
    scheduledTaskId: string,
    userId: string,
  ): ResultAsync<void, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireScheduledTaskForProject(projectId, scheduledTaskId))
      .andThen(() => fromPromise(deleteScheduledTask(scheduledTaskId, projectId)))
      .map(() => {
        log.info("scheduled task deleted", { projectId, scheduledTaskId });
      });

  export const createTaskDraftForUser = (input: {
    providerId?: string | null;
    projectId: string;
    prompt: string;
    sourceBranch: string;
    userId: string;
  }): ResultAsync<{ messageId: string; task: TaskRecord }, Error> =>
    requireUserProject(input.projectId, input.userId)
      .andThen((value) =>
        resolveTaskOpenCodeConfig(input.userId, input.providerId ?? null).map((openCodeConfig) => ({
          openCodeConfig,
          project: value,
        })),
      )
      .andThen(({ openCodeConfig, project }) =>
        Sandbox.startTask(
          {
            envVars: serializeProjectEnvEntries(parseStoredProjectEnvEntries(project.envVars)),
            openCodeConfig,
            prompt: input.prompt,
            repoId: project.repoId,
            sourceBranch: input.sourceBranch,
          },
          input.userId,
        ).map((draft) => ({ draft, openCodeConfig })),
      )
      .andThen(({ draft, openCodeConfig }) =>
        fromPromise(
          insertTask({
            branchName: draft.sourceBranch,
            createdByUserId: input.userId,
            envVars: draft.envVars ? JSON.stringify(draft.envVars) : null,
            id: draft.id,
            opencodeModel: openCodeConfig.model,
            opencodeProviderId: openCodeConfig.selectedProviderId,
            projectId: input.projectId,
            prompt: draft.prompt,
            repoId: draft.repoId,
            sandboxStatus: "pending",
            stage: draft.stage,
            startedAt: new Date(draft.startedAt),
            status: draft.status,
            title: null,
          }),
        ).andThen((task) => {
          void generateTaskTitle(draft.prompt, openCodeConfig).then((title) =>
            updateTask(task.id, { title }),
          );
          return Sandbox.createTaskMessageDraft(task.id, draft.prompt, "initial", input.userId).map(
            (message) => ({
              messageId: message.id,
              task,
            }),
          );
        }),
      );

  export const queueTaskMessageForTask = (
    taskId: string,
    messageId: string,
    prompt: string,
  ): ResultAsync<void, Error> => Sandbox.queueTaskMessage(taskId, messageId, prompt);

  export const createChildTaskForTask = (input: {
    model?: string | null;
    parentTaskId: string;
    prompt: string;
    title: string;
  }): ResultAsync<TaskRecord, Error> =>
    fromPromise(findTaskWithProject(input.parentTaskId)).andThen((value) => {
      if (!value) {
        return errAsync(new Error("Parent task not found."));
      }

      const parentTask = value.task;
      const branchName = parentTask.branchName ?? "main";
      const childRepoId = parentTask.repoId ?? value.project.repoId;

      return fromPromise(assertParentCanSpawn(parentTask, value.project)).andThen(() =>
        Sandbox.startTask(
          {
            envVars: serializeProjectEnvEntries(
              parseStoredProjectEnvEntries(value.project.envVars),
            ),
            prompt: input.prompt,
            repoId: childRepoId,
            sourceBranch: branchName,
          },
          value.project.userId,
        ).andThen((draft) =>
          fromPromise(
            insertTask({
              branchName,
              envVars: draft.envVars ? JSON.stringify(draft.envVars) : null,
              id: draft.id,
              opencodeModel: input.model ?? parentTask.opencodeModel ?? null,
              opencodeProviderId: parentTask.opencodeProviderId ?? null,
              parentTaskId: input.parentTaskId,
              projectId: parentTask.projectId,
              prompt: input.prompt,
              repoId: childRepoId,
              sandboxStatus: "pending",
              spawnDepth: parentTask.spawnDepth + 1,
              spawnSource: "agent",
              stage: input.title.trim() ? `Queued child task: ${input.title.trim()}` : draft.stage,
              startedAt: new Date(draft.startedAt),
              status: draft.status,
              title: input.title.trim() || buildTaskTitle(input.prompt),
            }),
          ).andThen((createdTask) =>
            Sandbox.enqueueTaskMessage(createdTask.id, input.prompt, "initial").andThen(() =>
              fromPromise(
                publishChildTaskUpdate({
                  childTaskId: createdTask.id,
                  parentTaskId: input.parentTaskId,
                  sandboxStatus: createdTask.sandboxStatus,
                  stage: createdTask.stage,
                  status: createdTask.status,
                  title: createdTask.title,
                }),
              ).map(() => createdTask),
            ),
          ),
        ),
      );
    });

  export const listTasksForProject = (
    projectId: string,
    userId: string,
  ): ResultAsync<TaskRecord[], Error> =>
    requireUserProject(projectId, userId).andThen(() => fromPromise(listProjectTasks(projectId)));

  export const listChildTasksForUser = (
    parentTaskId: string,
    userId: string,
  ): ResultAsync<TaskSummaryRecord[], Error> =>
    requireTaskForUser(parentTaskId, userId).andThen(() =>
      fromPromise(listChildTaskSummaries(parentTaskId)),
    );

  export const getTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen((value) => fromPromise(syncTaskRuntime(value)));

  export const deleteTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<void, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen((value) => {
        if (RUNNING_TASK_STATUSES.has(value.status)) {
          return errAsync(new Error("Running sessions cannot be removed."));
        }

        return fromPromise(deleteTask(taskId, projectId));
      })
      .map(() => {
        log.info("task deleted", { projectId, taskId });
      });

  export const terminateTaskForProject = (
    projectId: string,
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireUserProject(projectId, userId)
      .andThen(() => requireTaskForProject(projectId, taskId))
      .andThen(() => fromPromise(terminateTaskRecord(taskId)))
      .map((value) => {
        log.info("task terminated", { projectId, taskId });
        return value;
      });

  export const getTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskDetailRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      fromPromise(syncTaskRuntime(value)).andThen((latest) =>
        fromPromise(buildTaskDetail(latest.id)),
      ),
    );

  export const getTaskRuntimeById = (taskId: string): ResultAsync<TaskRecord, Error> =>
    fromPromise(findTask(taskId)).andThen((task) =>
      task ? okAsync(task) : errAsync(new Error("Task not found.")),
    );

  export const terminateTaskForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(() =>
      fromPromise(terminateTaskRecord(taskId)).map((value) => {
        log.info("task terminated by user", { taskId });
        return value;
      }),
    );

  export const destroyTaskSandboxForUser = (
    taskId: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      fromPromise(destroyTaskSandboxRecord(value)),
    );

  export const runTaskFollowUpForUser = (
    taskId: string,
    prompt: string,
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      fromPromise(queueFollowUpPrompt(value, prompt, userId)).map((updated) => {
        log.info("follow-up queued", { taskId });
        return updated;
      }),
    );

  export const prepareTaskFollowUpForUser = (
    taskId: string,
    prompt: string,
    userId: string,
  ): ResultAsync<{ messageId: string; task: TaskRecord }, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      fromPromise(
        updateTask(value.id, {
          completedAt: null,
          error: null,
          lastHeartbeatAt: new Date(),
          sandboxStatus: value.sandboxId ? "ready" : "pending",
          stage: "Queued prompt",
          status: "queued",
        }),
      ).andThen((updatedTask) =>
        Sandbox.createTaskMessageDraft(value.id, prompt.trim(), "follow_up", userId).map(
          (message) => ({
            messageId: message.id,
            task: updatedTask ?? value,
          }),
        ),
      ),
    );

  export const listAllTasksForUser = (userId: string): ResultAsync<TaskRecord[], Error> =>
    fromPromise(listProjectIds(userId)).andThen((ids) => {
      if (ids.length === 0) {
        return okAsync([] as TaskRecord[]);
      }

      const projectIds = R.map(ids, R.prop("id"));

      return fromPromise(listUserTasks(projectIds)).andThen((values) =>
        fromPromise(
          Promise.all(
            R.map(values, (value) =>
              RUNNING_TASK_STATUSES.has(value.status) ? syncTaskRuntime(value) : value,
            ),
          ),
        ),
      );
    });

  export const listAllTaskSummariesForUser = (
    userId: string,
  ): ResultAsync<TaskSummaryRecord[], Error> =>
    fromPromise(listProjectIds(userId)).andThen((ids) => {
      if (ids.length === 0) {
        return okAsync([] as TaskSummaryRecord[]);
      }

      const projectIds = R.map(ids, R.prop("id"));

      return fromPromise(listUserTaskSummaries(projectIds)).andThen((values) =>
        fromPromise(
          Promise.all(
            R.map(values, (value) =>
              RUNNING_TASK_STATUSES.has(value.status) ? syncTaskSummaryRuntime(value) : value,
            ),
          ),
        ),
      );
    });
}
