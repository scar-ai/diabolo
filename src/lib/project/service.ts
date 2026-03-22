import { getSignedInGithubRepo } from "@/lib/github/server";
import {
  destroySandbox,
  getSandboxTask,
  runSandboxTaskFollowUp,
  startSandboxTask,
  terminateSandboxTask,
} from "@/lib/sandbox/server";

import {
  deleteProject,
  deleteTask,
  findProject,
  findProjectTask,
  findTask,
  findUserTask,
  insertProject,
  insertTask,
  listProjectIds,
  listProjects,
  listProjectTasks,
  listUserTaskSummaries,
  listUserTasks,
  type TaskRecord,
  type TaskSummaryRecord,
  updateTask,
} from "./db";

const RUNNING_TASK_STATUSES = new Set(["queued", "running"]);

const requireUserProject = async (projectId: string, userId: string) => {
  const project = await findProject(projectId, userId);

  if (!project) {
    throw new Error("Project not found.");
  }

  return project;
};

const requireTaskForProject = async (projectId: string, taskId: string) => {
  const task = await findProjectTask(taskId, projectId);

  if (!task) {
    throw new Error("Task not found.");
  }

  return task;
};

const requireTaskForUser = async (taskId: string, userId: string) => {
  const task = await findUserTask(taskId, userId);

  if (!task) {
    throw new Error("Task not found.");
  }

  return task;
};

const toSerializedJobPatch = (job: Awaited<ReturnType<typeof getSandboxTask>>) => ({
  agentMessages: job.agentMessages.length > 0 ? JSON.stringify(job.agentMessages) : null,
  branchName: job.branchName ?? job.sourceBranch ?? null,
  completedAt: job.completedAt ? new Date(job.completedAt) : null,
  error: job.error ?? null,
  followUpHistory: job.followUpHistory.length > 0 ? JSON.stringify(job.followUpHistory) : null,
  logs: job.logs ?? null,
  prNumber: job.prNumber ?? null,
  prUrl: job.prUrl ?? null,
  repoName: job.repoName ?? null,
  repoUrl: job.repoUrl ?? null,
  sandboxId: job.sandboxId ?? null,
  sandboxName: job.sandboxName ?? null,
  sandboxPath: job.sandboxPath ?? null,
  stage: job.stage,
  status: job.status,
});

const pickTaskSummary = (task: TaskRecord): TaskSummaryRecord => ({
  branchName: task.branchName,
  completedAt: task.completedAt,
  createdAt: task.createdAt,
  id: task.id,
  projectId: task.projectId,
  prompt: task.prompt,
  quickTask: task.quickTask,
  repoName: task.repoName,
  sandboxId: task.sandboxId,
  stage: task.stage,
  startedAt: task.startedAt,
  status: task.status,
  updatedAt: task.updatedAt,
});

const syncTaskWithJob = async (task: TaskRecord, userId?: string) => {
  try {
    const job = await getSandboxTask(task.id, userId);
    return updateTask(task.id, toSerializedJobPatch(job));
  } catch {
    if (!RUNNING_TASK_STATUSES.has(task.status)) {
      return task;
    }

    return updateTask(task.id, {
      completedAt: new Date(),
      error: "Task worker was not available. Start the task again.",
      stage: "Task failed",
      status: "failed",
    });
  }
};

const syncTaskSummaryWithJob = async (task: TaskSummaryRecord, userId?: string) =>
  pickTaskSummary(await syncTaskWithJob(task as TaskRecord, userId));

export const createProjectForUser = (input: { name: string; repoId: string; userId: string }) =>
  insertProject({
    id: crypto.randomUUID(),
    name: input.name,
    repoId: input.repoId,
    userId: input.userId,
  });

export const listProjectsForUser = (userId: string) => listProjects(userId);

export const getProjectForUser = async (projectId: string, userId: string) => {
  const project = await requireUserProject(projectId, userId);
  const repo = await getSignedInGithubRepo(project.repoId);

  return {
    ...project,
    repoDefaultBranch: repo?.defaultBranch ?? null,
    repoDescription: repo?.description ?? null,
    repoFullName: repo?.fullName ?? null,
    repoHtmlUrl: repo?.htmlUrl ?? null,
  };
};

export const deleteProjectForUser = async (projectId: string, userId: string) => {
  await requireUserProject(projectId, userId);
  await deleteProject(projectId);
};

export const createTaskForUser = async (input: {
  projectId: string;
  prompt: string;
  quickTask: boolean;
  sourceBranch: string;
  userId: string;
}) => {
  const project = await requireUserProject(input.projectId, input.userId);

  const job = await startSandboxTask(
    {
      prompt: input.prompt,
      quickTask: input.quickTask,
      repoId: project.repoId,
      sourceBranch: input.sourceBranch,
    },
    input.userId,
  );

  return insertTask({
    branchName: job.sourceBranch,
    id: job.id,
    projectId: input.projectId,
    prompt: job.prompt,
    quickTask: job.quickTask,
    repoId: job.repoId,
    stage: job.stage,
    startedAt: new Date(job.startedAt),
    status: job.status,
  });
};

export const listTasksForProject = async (projectId: string, userId: string) => {
  await requireUserProject(projectId, userId);
  return listProjectTasks(projectId);
};

export const getTaskForProject = async (projectId: string, taskId: string, userId: string) => {
  await requireUserProject(projectId, userId);
  return syncTaskWithJob(await requireTaskForProject(projectId, taskId), userId);
};

export const deleteTaskForProject = async (projectId: string, taskId: string, userId: string) => {
  await requireUserProject(projectId, userId);

  const task = await requireTaskForProject(projectId, taskId);

  if (RUNNING_TASK_STATUSES.has(task.status)) {
    throw new Error("Running sessions cannot be removed.");
  }

  await deleteTask(taskId, projectId);
};

const terminateTaskRecord = async (taskId: string) => {
  try {
    await terminateSandboxTask(taskId);
  } catch {}

  return updateTask(taskId, {
    completedAt: new Date(),
    error: "Task was terminated by user.",
    stage: "Terminated",
    status: "failed",
  });
};

export const terminateTaskForProject = async (
  projectId: string,
  taskId: string,
  userId: string,
) => {
  await requireUserProject(projectId, userId);
  await requireTaskForProject(projectId, taskId);
  return terminateTaskRecord(taskId);
};

export const getTaskForUser = async (taskId: string, userId: string) => {
  const { task } = await requireTaskForUser(taskId, userId);
  return syncTaskWithJob(task, userId);
};

export const terminateTaskForUser = async (taskId: string, userId: string) => {
  const { task } = await requireTaskForUser(taskId, userId);
  return terminateTaskRecord(task.id);
};

export const terminateQuickTaskForUser = async (taskId: string, userId: string) => {
  const { task } = await requireTaskForUser(taskId, userId);

  if (!task.quickTask) {
    throw new Error("This action is only available for quick tasks.");
  }

  try {
    await terminateSandboxTask(task.id);
  } catch {}

  if (task.sandboxId) {
    try {
      await destroySandbox(task.sandboxId);
    } catch {}
  }

  return updateTask(task.id, {
    completedAt: new Date(),
    error: "Quick task was stopped by user.",
    sandboxId: null,
    sandboxName: null,
    sandboxPath: null,
    stage: "Quick task stopped",
    status: "failed",
  });
};

export const destroyTaskSandboxForUser = async (taskId: string, userId: string) => {
  const { task } = await requireTaskForUser(taskId, userId);

  if (task.sandboxId) {
    await destroySandbox(task.sandboxId);
  }

  return updateTask(task.id, {
    sandboxId: null,
    sandboxName: null,
    sandboxPath: null,
    stage: "Sandbox stopped",
  });
};

export const runTaskFollowUpForUser = async (taskId: string, prompt: string, userId: string) => {
  const { task } = await requireTaskForUser(taskId, userId);

  if (task.quickTask) {
    throw new Error("Quick tasks are read-only.");
  }

  await updateTask(task.id, {
    stage: "Running follow-up task",
    status: "running",
  });

  await runSandboxTaskFollowUp(task.id, prompt.trim(), userId);

  const latestTask = await findTask(task.id);

  if (!latestTask) {
    throw new Error("Task not found.");
  }

  return syncTaskWithJob(latestTask, userId);
};

export const listAllTasksForUser = async (userId: string) => {
  const projectIds = await listProjectIds(userId);

  if (projectIds.length === 0) {
    return [];
  }

  const tasks = await listUserTasks(projectIds.map(({ id }) => id));

  return Promise.all(
    tasks.map((task) =>
      RUNNING_TASK_STATUSES.has(task.status) ? syncTaskWithJob(task, userId) : task,
    ),
  );
};

export const listAllTaskSummariesForUser = async (userId: string) => {
  const projectIds = await listProjectIds(userId);

  if (projectIds.length === 0) {
    return [];
  }

  const tasks = await listUserTaskSummaries(projectIds.map(({ id }) => id));

  return Promise.all(
    tasks.map((task) =>
      RUNNING_TASK_STATUSES.has(task.status) ? syncTaskSummaryWithJob(task, userId) : task,
    ),
  );
};
