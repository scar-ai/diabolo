import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { TaskStatusBadge } from "@/components/app/task-status-badge";
import type { TaskSummaryResult } from "@/project/query";

export type RunningTaskItemData = TaskSummaryResult;

export function RunningTaskItem({ task }: { task: RunningTaskItemData }) {
  return (
    <Link
      to="/app/tasks/$taskId"
      params={{ taskId: task.id }}
      className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/60"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{task.promptPreview}</span>
        <span className="text-xs text-muted-foreground/50">{task.runningSummaryLine}</span>
      </div>
      <TaskStatusBadge status={task.status} className="shrink-0" />
      <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
    </Link>
  );
}
