import type { $listAllUserTaskSummaries } from "./functions";

type AllUserTaskSummariesResult = Awaited<ReturnType<typeof $listAllUserTaskSummaries>>;

const formatTaskSummaryDate = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const getTaskPromptPreview = (prompt: string, maxLength: number) =>
  prompt.split("\n")[0]?.slice(0, maxLength) ?? "";

const createTaskSummaryLine = ({
  branchName,
  repoName,
  sandboxStatus,
  stage,
  spawnSource,
}: {
  branchName: string | null;
  repoName: string | null;
  sandboxStatus: string;
  spawnSource: string;
  stage: string;
}) =>
  [
    repoName,
    branchName,
    spawnSource === "scheduled" ? "scheduled" : null,
    sandboxStatus !== "ready" ? sandboxStatus : null,
    stage,
  ]
    .filter(Boolean)
    .join(" · ");

const selectTaskSummaries = (tasks: AllUserTaskSummariesResult) => {
  const childMap = new Map<string, AllUserTaskSummariesResult>();

  for (const summary of tasks) {
    if (!summary.parentTaskId) {
      continue;
    }

    const bucket = childMap.get(summary.parentTaskId) ?? [];
    bucket.push(summary);
    childMap.set(summary.parentTaskId, bucket);
  }

  return tasks.map((task) => {
    const children = childMap.get(task.id) ?? [];
    const activeChildren = children.filter(
      (child) => child.status === "queued" || child.status === "running",
    );

    return {
      ...task,
      activeChildCount: activeChildren.length,
      childCount: children.length,
      hasActiveChildren: activeChildren.length > 0,
      isChildTask: Boolean(task.parentTaskId),
      promptPreview: getTaskPromptPreview(task.title || task.prompt, 80),
      runningSummaryLine: `${task.repoName ?? "-"} · ${task.sandboxStatus} · ${task.stage}`,
      sessionSummaryLine: createTaskSummaryLine(task),
      startedAtLabel: formatTaskSummaryDate(task.startedAt),
    };
  });
};

export type TaskSummaryResult = ReturnType<typeof selectTaskSummaries>[number];
export { selectTaskSummaries };
