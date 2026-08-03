import { CheckIcon, XIcon } from "lucide-react";
import { useMemo } from "react";

import type { ParsedTaskEvent } from "@/lib/project/task-detail-selector";
import { readLatestTodos, type TodoItem } from "@/lib/task-activity";
import { cn } from "@/lib/utils";

export function TaskTodoList({ runtimeEvents }: { runtimeEvents: ParsedTaskEvent[] }) {
  const todos = useMemo(() => readLatestTodos(runtimeEvents), [runtimeEvents]);

  if (!todos) {
    return null;
  }

  const completed = todos.filter((todo) => todo.status === "completed").length;

  return (
    <div className="mt-3 rounded-xl bg-foreground/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <p className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground/60 uppercase">
          Plan
        </p>
        {/* The bar carries the progress; the count is there to be exact. */}
        <span className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-foreground/8">
          <span
            className="block h-full rounded-full bg-success/60 transition-[width] duration-500"
            style={{ width: `${Math.round((completed / todos.length) * 100)}%` }}
          />
        </span>
        <span className="text-[11px] text-muted-foreground/60 tabular-nums">
          {completed}/{todos.length}
        </span>
      </div>

      <ol className="mt-2.5 flex flex-col gap-1.5">
        {todos.map((todo, index) => (
          <li
            key={`${index}-${todo.content}`}
            className={cn(
              "flex items-start gap-2 text-xs leading-5",
              todo.status === "in_progress" && "font-medium text-foreground",
              todo.status === "completed" && "text-muted-foreground/50",
              todo.status === "cancelled" && "text-muted-foreground/40 line-through",
              todo.status === "pending" && "text-muted-foreground/70",
            )}
          >
            <TodoMarker status={todo.status} />
            <span className="min-w-0 flex-1">{todo.content}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Status markers sized to a single text line. Only the item in progress gets
 * colour, so the list has exactly one thing drawing the eye.
 */
function TodoMarker({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-success/60" />;
  }

  if (status === "cancelled") {
    return <XIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/30" />;
  }

  if (status === "in_progress") {
    return (
      <span className="relative mt-[7px] flex size-1.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info/50" />
        <span className="relative inline-flex size-1.5 rounded-full bg-info" />
      </span>
    );
  }

  return <span className="mt-[7px] size-1.5 shrink-0 rounded-full border border-foreground/20" />;
}
