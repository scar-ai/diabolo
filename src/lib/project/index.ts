import { errAsync, okAsync, ResultAsync } from "neverthrow";
import * as R from "remeda";

import { Github } from "@/lib/github";
import { Log } from "@/lib/log";
import {
  modelSupportsReasoningEffort,
  normalizeReasoningEffort,
} from "@/lib/models/reasoning-effort";
import { type OpenCodeConfig } from "@/lib/opencode/config";
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
import {
  generateProjectSshKeyPair,
  normalizeSshPrivateKey,
  normalizeSshPublicKey,
} from "@/lib/project/ssh";
import { fromPromise } from "@/lib/result";
import { Sandbox } from "@/lib/sandbox";
import {
  findNextPendingTaskMessage,
  findProcessingTaskMessage,
  findTaskDiffFile,
  listTaskDiffFileSummaries,
} from "@/lib/sandbox/store";
import { normalizeSandboxTierId } from "@/lib/sandbox/tiers";
import { detectRepoSkills, type DetectedRepoSkillEntry } from "@/lib/skills/repository";
import { resolveUserProvider } from "@/lib/user/provider-resolution";

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
  RUNNING_TASK_STATUSES,
  type TaskMessageRecord as TTaskMessageRecord,
  type TaskRecord as TTaskRecord,
  type TaskSummaryRecord as TTaskSummaryRecord,
} from "./shared";
import { buildFallbackTaskTitle } from "./title";

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

  /** Require delete permission: creator, or org owner for org-shared projects. */
  const requireProjectDeleteAccess = (projectId: string, userId: string) =>
    requireUserProject(projectId, userId).andThen((project) => {
      if (project.userId === userId) {
        return okAsync(project);
      }

      if (!project.sharedWithOrgId) {
        return errAsync(new Error("You do not have permission to delete this project."));
      }

      return Org.getMembershipInOrgForUser(project.sharedWithOrgId, userId).andThen((membership) =>
        membership?.role === "owner"
          ? okAsync(project)
          : errAsync(new Error("You do not have permission to delete this project.")),
      );
    });

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

  const deleteTaskWithSandboxCleanup = async (value: TTaskRecord) => {
    if (RUNNING_TASK_STATUSES.has(value.status)) {
      throw new Error("Running sessions cannot be removed.");
    }

    if (value.sandboxId) {
      await Sandbox.destroySandbox(value.sandboxId).match(
        () => {
          log.debug("task sandbox destroyed before task deletion", {
            projectId: value.projectId,
            sandboxId: value.sandboxId,
            taskId: value.id,
          });
        },
        (error) => {
          log.warn("task sandbox destruction failed before task deletion", {
            error: error.message,
            projectId: value.projectId,
            sandboxId: value.sandboxId,
            taskId: value.id,
          });
        },
      );
    }

    await deleteTask(value.id, value.projectId);
  };

  const resolveTaskOpenCodeConfig = (
    userId: string,
    providerRecordId?: string | null,
    model?: string | null,
  ): ResultAsync<OpenCodeConfig, Error> =>
    resolveUserProvider({
      model: model ?? null,
      providerRecordId: providerRecordId ?? null,
      userId,
    }).map(({ openCodeConfig }) => openCodeConfig);

  const startTaskSandboxDraft = (input: {
    model?: string | null;
    project: ProjectRecord;
    prompt: string;
    providerRecordId?: string | null;
    sourceBranch: string;
    userId: string;
  }) =>
    resolveUserProvider({
      model: input.model ?? null,
      providerRecordId: input.providerRecordId ?? null,
      userId: input.userId,
    }).andThen(({ openCodeConfig }) =>
      Sandbox.startTask(
        {
          envVars: serializeProjectEnvEntries(parseStoredProjectEnvEntries(input.project.envVars)),
          openCodeConfig,
          prompt: input.prompt,
          repoId: input.project.repoId,
          sourceBranch: input.sourceBranch,
        },
        input.userId,
      ).map((draft) => ({
        draft,
        openCodeConfig,
      })),
    );

  const requireTaskReadyForQueuedPrompt = (taskId: string): ResultAsync<void, Error> =>
    fromPromise(
      Promise.all([findProcessingTaskMessage(taskId), findNextPendingTaskMessage(taskId)]),
    ).andThen(([processingMessage, pendingMessage]) => {
      if (processingMessage) {
        return errAsync(new Error("This task is already processing a prompt."));
      }

      if (pendingMessage) {
        return errAsync(new Error("This task already has a queued prompt."));
      }

      return okAsync(undefined);
    });

  const resolveTaskMessageOverrides = (
    openCodeConfig: OpenCodeConfig,
    input?: {
      reasoningEffort?: string | null;
    },
  ) => {
    const reasoningEffort = normalizeReasoningEffort(input?.reasoningEffort);

    if (reasoningEffort && !modelSupportsReasoningEffort(openCodeConfig.model)) {
      throw new Error("The selected model does not support reasoning effort overrides.");
    }

    return {
      model: openCodeConfig.model,
      reasoningEffort,
    };
  };

  const insertSandboxTask = (input: {
    createdByUserId?: string | null;
    draft: Sandbox.TaskJob;
    openCodeConfig: OpenCodeConfig;
    projectId: string;
    values?: Partial<Parameters<typeof insertTask>[0]>;
  }) =>
    fromPromise(
      insertTask({
        branchName: input.draft.sourceBranch,
        createdByUserId: input.createdByUserId ?? null,
        envVars: input.draft.envVars ? JSON.stringify(input.draft.envVars) : null,
        id: input.draft.id,
        opencodeModel: input.openCodeConfig.model,
        opencodeProviderId: input.openCodeConfig.selectedProviderId,
        projectId: input.projectId,
        prompt: input.draft.prompt,
        repoId: input.draft.repoId,
        sandboxStatus: "pending",
        stage: input.draft.stage,
        startedAt: new Date(input.draft.startedAt),
        status: input.draft.status,
        title: buildFallbackTaskTitle(input.draft.prompt),
        ...input.values,
      }),
    );

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
      log.debug("project created", { projectId: value.id });
      return value;
    });

  export const listProjectsForUser = (userId: string): ResultAsync<ProjectRecord[], Error> =>
    fromPromise(listProjects(userId)).map((projects) =>
      projects.map((project) => ({
        ...project,
        sshPrivateKey: null,
        sshPublicKey: null,
      })),
    );

  export const getProjectForUser = (
    projectId: string,
    userId: string,
  ): ResultAsync<
    ProjectRecord & {
      envEntries: ProjectEnvEntry[];
      hasSshPrivateKey: boolean;
      repoSkills: DetectedRepoSkillEntry[];
      skills: ProjectSkillEntry[];
      repoDefaultBranch: string | null;
      repoDescription: string | null;
      repoFullName: string | null;
      repoHtmlUrl: string | null;
    },
    Error
  > =>
    requireUserProject(projectId, userId).andThen((value) =>
      Github.getRepoForUser(value.repoId, userId).andThen((repo) =>
        detectRepoSkills({
          defaultBranch: repo?.defaultBranch ?? null,
          repoHtmlUrl: repo?.htmlUrl ?? null,
          repoId: value.repoId,
          userId,
        }).map((repoSkills) => ({
          ...value,
          envEntries: parseStoredProjectEnvEntries(value.envVars),
          repoSkills,
          skills: parseStoredProjectSkills(value.agentSkills),
          repoDefaultBranch: repo?.defaultBranch ?? null,
          repoDescription: repo?.description ?? null,
          repoFullName: repo?.fullName ?? null,
          repoHtmlUrl: repo?.htmlUrl ?? null,
          hasSshPrivateKey: Boolean(value.sshPrivateKey),
          sshPrivateKey: null,
        })),
      ),
    );

  export const deleteProjectForUser = (
    projectId: string,
    userId: string,
    projectName: string,
  ): ResultAsync<void, Error> =>
    requireProjectDeleteAccess(projectId, userId)
      .andThen((project) => {
        if (project.name !== projectName) {
          return errAsync(new Error("Project name confirmation does not match."));
        }

        return okAsync(project);
      })
      .andThen(() => fromPromise(deleteProject(projectId)))
      .map(() => {
        log.debug("project deleted", { projectId });
      });

  export const updateProjectSettingsForUser = (input: {
    envEntries: ProjectEnvEntry[];
    projectId: string;
    shareWithOrganisation: boolean;
    skills: ProjectSkillEntry[];
    sshPrivateKey?: string | null;
    sshPublicKey: string | null;
    userId: string;
  }): ResultAsync<ProjectRecord, Error> =>
    requireOwnedProject(input.projectId, input.userId).andThen((project) =>
      Org.getMembershipForUser(input.userId).andThen((membership) => {
        if (input.shareWithOrganisation && !membership) {
          return errAsync(new Error("Join an organisation before sharing projects with it."));
        }

        const normalizedSshPrivateKey =
          input.sshPrivateKey === undefined
            ? undefined
            : normalizeSshPrivateKey(input.sshPrivateKey);
        const sshPrivateKeyUpdate =
          normalizedSshPrivateKey === undefined ? {} : { sshPrivateKey: normalizedSshPrivateKey };
        const sshPublicKey = normalizeSshPublicKey(input.sshPublicKey);
        const effectiveSshPrivateKey =
          normalizedSshPrivateKey === undefined ? project.sshPrivateKey : normalizedSshPrivateKey;

        if (sshPublicKey && !effectiveSshPrivateKey) {
          return errAsync(new Error("A public key requires its matching private key."));
        }

        return fromPromise(
          updateProject(input.projectId, {
            agentSkills: JSON.stringify(normalizeProjectSkills(input.skills)),
            envVars: JSON.stringify(normalizeProjectEnvEntries(input.envEntries)),
            sharedWithOrgId: input.shareWithOrganisation ? (membership?.orgId ?? null) : null,
            ...sshPrivateKeyUpdate,
            sshPublicKey,
          }),
        )
          .andThen((value) => (value ? okAsync(value) : errAsync(new Error("Project not found."))))
          .map((value) => ({ ...value, sshPrivateKey: null }));
      }),
    );

  export const generateSshKeyForProject = (
    projectId: string,
    userId: string,
  ): ResultAsync<{ publicKey: string }, Error> =>
    requireOwnedProject(projectId, userId).andThen(() =>
      fromPromise(generateProjectSshKeyPair()).andThen((keyPair) =>
        fromPromise(
          updateProject(projectId, {
            sshPrivateKey: keyPair.privateKey,
            sshPublicKey: keyPair.publicKey,
          }),
        ).andThen((value) =>
          value
            ? okAsync({ publicKey: keyPair.publicKey })
            : errAsync(new Error("Project not found.")),
        ),
      ),
    );

  export const createTaskForUser = (input: {
    providerId?: string | null;
    projectId: string;
    prompt: string;
    reasoningEffort?: string | null;
    sandboxTier?: string | null;
    sourceBranch: string;
    userId: string;
  }): ResultAsync<TaskRecord, Error> => {
    const op = log.child({ projectId: input.projectId, userId: input.userId });

    return requireUserProject(input.projectId, input.userId)
      .andThen((project) =>
        startTaskSandboxDraft({
          project,
          prompt: input.prompt,
          providerRecordId: input.providerId ?? null,
          sourceBranch: input.sourceBranch,
          userId: input.userId,
        }),
      )
      .andThen(({ draft, openCodeConfig }) => {
        const messageOverrides = resolveTaskMessageOverrides(openCodeConfig, {
          reasoningEffort: input.reasoningEffort ?? null,
        });

        return insertSandboxTask({
          createdByUserId: input.userId,
          draft,
          openCodeConfig,
          projectId: input.projectId,
          values: { sandboxTier: normalizeSandboxTierId(input.sandboxTier) },
        }).andThen((createdTask) =>
          Sandbox.enqueueTaskMessage(createdTask.id, draft.prompt, "initial", {
            createdByUserId: input.userId,
            ...messageOverrides,
          }).map(() => createdTask),
        );
      })
      .map((value) => {
        op.debug("task created", { taskId: value.id });
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
        startTaskSandboxDraft({
          project,
          prompt: input.prompt,
          providerRecordId: scheduledTask.providerId ?? null,
          sourceBranch: input.sourceBranch,
          userId: input.userId,
        }).map(({ draft, openCodeConfig }) => ({
          draft,
          openCodeConfig,
          scheduledTask,
        })),
      )
      .andThen(({ draft, openCodeConfig }) => {
        const messageOverrides = resolveTaskMessageOverrides(openCodeConfig);

        return insertSandboxTask({
          createdByUserId: input.userId,
          draft,
          openCodeConfig,
          projectId: input.projectId,
          values: {
            scheduledTaskId: input.scheduledTaskId,
            spawnSource: "scheduled",
          },
        }).andThen((createdTask) =>
          Sandbox.enqueueTaskMessage(createdTask.id, draft.prompt, "initial", {
            createdByUserId: input.userId,
            ...messageOverrides,
          }).map(() => createdTask),
        );
      })
      .map((value) => {
        op.debug("scheduled task run created", { taskId: value.id });
        return value;
      });
  };

  export const createScheduledTaskForUser = (input: {
    branchName?: string | null;
    instructions: string;
    name: string;
    projectId: string;
    providerId?: string | null;
    runOnce?: boolean;
    scheduleCron: string;
    scheduleTimezone: string;
    userId: string;
  }): ResultAsync<ScheduledTaskRecord, Error> => {
    ensureScheduledTaskScheduler();

    return requireUserProject(input.projectId, input.userId).andThen(() =>
      resolveTaskOpenCodeConfig(input.userId, input.providerId ?? null).andThen(() =>
        fromPromise(
          insertScheduledTask({
            branchName: input.branchName ?? null,
            consecutiveFailures: 0,
            createdByUserId: input.userId,
            id: crypto.randomUUID(),
            instructions: input.instructions,
            name: input.name,
            projectId: input.projectId,
            providerId: input.providerId ?? null,
            runOnce: input.runOnce ? 1 : 0,
            scheduleCron: input.scheduleCron,
            scheduleTimezone: input.scheduleTimezone,
          }),
        ),
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
    providerId?: string | null;
    runOnce: boolean;
    scheduleCron: string;
    scheduleTimezone: string;
    scheduledTaskId: string;
    userId: string;
  }): ResultAsync<ScheduledTaskRecord, Error> =>
    requireUserProject(input.projectId, input.userId)
      .andThen(() => requireScheduledTaskForProject(input.projectId, input.scheduledTaskId))
      .andThen(() => resolveTaskOpenCodeConfig(input.userId, input.providerId ?? null))
      .andThen(() =>
        fromPromise(
          updateScheduledTask(input.scheduledTaskId, {
            branchName: input.branchName ?? null,
            consecutiveFailures: 0,
            instructions: input.instructions,
            lastAlertedAt: null,
            lastEnqueuedAt: null,
            lastError: null,
            lastFailureAt: null,
            lastRunAt: null,
            name: input.name,
            providerId: input.providerId ?? null,
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
        log.debug("scheduled task deleted", { projectId, scheduledTaskId });
      });

  export const createTaskDraftForUser = (input: {
    providerId?: string | null;
    projectId: string;
    prompt: string;
    reasoningEffort?: string | null;
    sandboxTier?: string | null;
    sourceBranch: string;
    userId: string;
  }): ResultAsync<{ messageId: string; task: TaskRecord }, Error> =>
    requireUserProject(input.projectId, input.userId)
      .andThen((project) =>
        startTaskSandboxDraft({
          project,
          prompt: input.prompt,
          providerRecordId: input.providerId ?? null,
          sourceBranch: input.sourceBranch,
          userId: input.userId,
        }),
      )
      .andThen(({ draft, openCodeConfig }) =>
        insertSandboxTask({
          createdByUserId: input.userId,
          draft,
          openCodeConfig,
          projectId: input.projectId,
          values: { sandboxTier: normalizeSandboxTierId(input.sandboxTier) },
        }).andThen((task) => {
          const messageOverrides = resolveTaskMessageOverrides(openCodeConfig, {
            reasoningEffort: input.reasoningEffort ?? null,
          });

          return Sandbox.createTaskMessageDraft(task.id, draft.prompt, "initial", {
            createdByUserId: input.userId,
            ...messageOverrides,
          }).map((message) => ({
            messageId: message.id,
            task,
          }));
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
    reasoningEffort?: string | null;
    title: string;
  }): ResultAsync<TaskRecord, Error> =>
    fromPromise(findTaskWithProject(input.parentTaskId)).andThen((value) => {
      if (!value) {
        return errAsync(new Error("Parent task not found."));
      }

      const parentTask = value.task;
      const branchName = parentTask.branchName ?? "main";
      const childRepoId = parentTask.repoId ?? value.project.repoId;
      const executionUserId = parentTask.createdByUserId ?? value.project.userId;

      return fromPromise(assertParentCanSpawn(parentTask, value.project)).andThen(() =>
        resolveTaskOpenCodeConfig(
          executionUserId,
          parentTask.opencodeProviderId ?? null,
          input.model ?? parentTask.opencodeModel ?? null,
        ).andThen((openCodeConfig) => {
          const messageOverrides = resolveTaskMessageOverrides(openCodeConfig, {
            reasoningEffort: input.reasoningEffort ?? null,
          });

          return Sandbox.startTask(
            {
              envVars: serializeProjectEnvEntries(
                parseStoredProjectEnvEntries(value.project.envVars),
              ),
              openCodeConfig,
              prompt: input.prompt,
              repoId: childRepoId,
              sourceBranch: branchName,
            },
            executionUserId,
          ).andThen((draft) =>
            insertSandboxTask({
              createdByUserId: executionUserId,
              draft,
              openCodeConfig,
              projectId: parentTask.projectId,
              values: {
                branchName,
                parentTaskId: input.parentTaskId,
                repoId: childRepoId,
                spawnDepth: parentTask.spawnDepth + 1,
                spawnSource: "agent",
                stage: input.title.trim()
                  ? `Queued child task: ${input.title.trim()}`
                  : draft.stage,
                title: buildFallbackTaskTitle(input.prompt),
              },
            }).andThen((createdTask) =>
              Sandbox.enqueueTaskMessage(createdTask.id, input.prompt, "initial", {
                ...messageOverrides,
              }).andThen(() =>
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
          );
        }),
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
      .andThen((value) => fromPromise(deleteTaskWithSandboxCleanup(value)))
      .map(() => {
        log.debug("task deleted", { projectId, taskId });
      });

  export const deleteTaskForUser = (taskId: string, userId: string): ResultAsync<void, Error> =>
    requireTaskForUser(taskId, userId)
      .andThen(({ task: value }) => fromPromise(deleteTaskWithSandboxCleanup(value)))
      .map(() => {
        log.debug("task deleted by user", { taskId });
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
        log.debug("task terminated", { projectId, taskId });
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

  export const listTaskDiffFilesForUser = (input: {
    messageId: string;
    taskId: string;
    userId: string;
  }) =>
    requireTaskForUser(input.taskId, input.userId).andThen(() =>
      fromPromise(listTaskDiffFileSummaries(input.taskId, input.messageId)),
    );

  export const getTaskDiffFilePatchForUser = (input: {
    diffFileId: string;
    taskId: string;
    userId: string;
  }) =>
    requireTaskForUser(input.taskId, input.userId)
      .andThen(() => fromPromise(findTaskDiffFile(input.diffFileId)))
      .andThen((file) =>
        file && file.taskId === input.taskId
          ? okAsync({
              filePath: file.filePath,
              isBinary: file.isBinary === 1,
              patch: file.patch ?? "",
              truncated: file.truncated === 1,
            })
          : errAsync(new Error("Diff file not found.")),
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
        log.debug("task terminated by user", { taskId });
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
    options: {
      model?: string | null;
      reasoningEffort?: string | null;
    },
    userId: string,
  ): ResultAsync<TaskRecord, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      requireTaskReadyForQueuedPrompt(value.id).andThen(() =>
        fromPromise(queueFollowUpPrompt(value, prompt, options, userId)).map((updated) => {
          log.debug("follow-up queued", { taskId });
          return updated;
        }),
      ),
    );

  export const prepareTaskFollowUpForUser = (
    taskId: string,
    prompt: string,
    options: {
      model?: string | null;
      reasoningEffort?: string | null;
    },
    userId: string,
  ): ResultAsync<{ messageId: string; task: TaskRecord }, Error> =>
    requireTaskForUser(taskId, userId).andThen(({ task: value }) =>
      requireTaskReadyForQueuedPrompt(value.id).andThen(() =>
        resolveTaskOpenCodeConfig(
          userId,
          value.opencodeProviderId ?? null,
          options.model ?? value.opencodeModel ?? null,
        ).andThen((openCodeConfig) => {
          const messageOverrides = resolveTaskMessageOverrides(openCodeConfig, {
            reasoningEffort: options.reasoningEffort ?? null,
          });

          return fromPromise(
            updateTask(value.id, {
              completedAt: null,
              error: null,
              lastHeartbeatAt: new Date(),
              sandboxStatus: value.sandboxId ? "ready" : "pending",
              stage: "Queued prompt",
              status: "queued",
            }),
          ).andThen((updatedTask) =>
            Sandbox.createTaskMessageDraft(value.id, prompt.trim(), "follow_up", {
              createdByUserId: userId,
              ...messageOverrides,
            }).map((message) => ({
              messageId: message.id,
              task: updatedTask ?? value,
            })),
          );
        }),
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
              RUNNING_TASK_STATUSES.has(value.status)
                ? syncTaskRuntime(value)
                : Promise.resolve(value),
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
              RUNNING_TASK_STATUSES.has(value.status)
                ? syncTaskSummaryRuntime(value)
                : Promise.resolve(value),
            ),
          ),
        ),
      );
    });
}
