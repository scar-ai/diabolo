import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";

import { RunningTaskItem } from "@/components/app/running-task-item";
import type { TaskSummaryResult } from "@/lib/project/queries";

export function RunningTasksPanel({
  projectId,
  tasks,
}: {
  projectId?: string | null;
  tasks: TaskSummaryResult[];
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="w-full text-left">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold text-foreground">Running ({tasks.length})</span>
        </div>
        <Link
          to="/app/sessions"
          search={projectId ? { projectId } : {}}
          className="flex items-center gap-1 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
        >
          All sessions <ArrowRightIcon className="size-3" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <RunningTaskItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
