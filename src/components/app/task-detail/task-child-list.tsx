import { Link } from "@tanstack/react-router";

import { ClientTimeText } from "@/components/app/client-time";
import { TaskStatusBadge } from "@/components/app/task-status-badge";

type ChildTask = {
  id: string;
  sandboxStatus: string;
  stage: string;
  status: string;
  title: string | null;
  updatedAt: Date | string;
};

export function TaskChildList({ projectId, tasks }: { projectId: string; tasks: ChildTask[] }) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Sub-tasks
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((child) => (
          <Link
            key={child.id}
            to="/app/tasks/$taskId"
            params={{ taskId: child.id }}
            search={{ projectId }}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2 transition-colors hover:bg-background"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {child.title ?? child.stage}
              </div>
              <div className="text-xs text-muted-foreground/65">
                {child.sandboxStatus} · {child.stage} ·{" "}
                <ClientTimeText
                  value={child.updatedAt}
                  options={{
                    hour: "2-digit",
                    minute: "2-digit",
                  }}
                />
              </div>
            </div>
            <TaskStatusBadge status={child.status} className="shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}
