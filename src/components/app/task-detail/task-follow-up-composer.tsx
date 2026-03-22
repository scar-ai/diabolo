import { BookMarkedIcon, ChevronDownIcon, GitBranchIcon } from "lucide-react";

import { PromptComposer } from "@/components/app/prompt-composer";
import { Checkbox } from "@/components/ui/checkbox";

import type { TaskData } from "./types";

export function TaskFollowUpComposer({
  canSubmit,
  disabled,
  isPending,
  onChange,
  onSubmit,
  task,
  value,
}: {
  canSubmit: boolean;
  disabled: boolean;
  isPending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  task: TaskData;
  value: string;
}) {
  const sandboxAlive = Boolean(task.sandboxId);
  const taskIsRunning = task.status === "queued" || task.status === "running";

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background from-40% to-transparent" />
      <div className="fixed inset-x-0 bottom-6 flex justify-center px-4">
        <div className="w-full max-w-3xl">
          <PromptComposer
            value={value}
            onChange={onChange}
            onSubmit={onSubmit}
            placeholder={
              taskIsRunning && !sandboxAlive
                ? "Waiting for task to finish..."
                : sandboxAlive
                  ? "Send a follow-up..."
                  : "Send a follow-up to restart the sandbox..."
            }
            canSubmit={canSubmit}
            disabled={disabled}
            submitAriaLabel={isPending ? "Sending..." : "Send"}
            footerLeft={
              <>
                <button
                  type="button"
                  disabled
                  className="flex cursor-not-allowed items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground/40 transition-colors"
                >
                  <BookMarkedIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-40 truncate">{task.repoName ?? "Project"}</span>
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled
                  className="flex cursor-not-allowed items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground/40 transition-colors"
                >
                  <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-40 truncate">{task.branchName ?? "Unknown branch"}</span>
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled
                  aria-pressed={!!task.quickTask}
                  className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground/40 transition-colors"
                >
                  <Checkbox
                    checked={!!task.quickTask}
                    disabled
                    aria-label="Quick task mode"
                    className="pointer-events-none size-3.5"
                  />
                  <span>Quick task</span>
                </button>
              </>
            }
          />
        </div>
      </div>
    </>
  );
}
