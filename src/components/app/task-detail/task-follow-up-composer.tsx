import { BookMarkedIcon, ChevronDownIcon, GitBranchIcon } from "lucide-react";

import { PromptComposer } from "@/components/app/prompt-composer";
import { Button } from "@/components/ui/button";
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
    <div className="shrink-0 bg-background px-4 py-3">
      <div className="mx-auto max-w-3xl">
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
              <Button
                variant="ghost"
                size="sm"
                disabled
                className="cursor-not-allowed gap-1 text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40"
              >
                <BookMarkedIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="max-w-40 truncate">{task.repoName ?? "Project"}</span>
                <ChevronDownIcon className="size-3 shrink-0 opacity-30" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled
                className="cursor-not-allowed gap-1 text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40"
              >
                <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="max-w-40 truncate">{task.branchName ?? "Used branch"}</span>
                <ChevronDownIcon className="size-3 shrink-0 opacity-30" aria-hidden="true" />
              </Button>
              <button
                type="button"
                disabled
                aria-pressed={!!task.quickTask}
                className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground/40 transition-colors hover:bg-transparent hover:text-muted-foreground/40"
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
  );
}
