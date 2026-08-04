import { FileDiffIcon } from "lucide-react";
import { useMemo } from "react";

import type { ParsedTaskEvent } from "@/lib/project/task-detail-selector";
import { getWrittenFilePath } from "@/lib/task-activity";

const MAX_VISIBLE_FILES = 6;

/**
 * Files the run has written to, newest last. Derived from tool arguments the
 * client already has, so it stays accurate without any extra server state.
 */
const readWrittenFiles = (runtimeEvents: ParsedTaskEvent[]) => {
  const files = new Set<string>();

  for (const event of runtimeEvents) {
    if (event.type !== "tool_call" && event.type !== "tool_result") {
      continue;
    }

    const filePath = getWrittenFilePath(event.payload);

    if (filePath) {
      files.add(filePath);
    }
  }

  return [...files];
};

const toDisplayName = (filePath: string) => filePath.split("/").at(-1) || filePath;

export function TaskFileChanges({ runtimeEvents }: { runtimeEvents: ParsedTaskEvent[] }) {
  const files = useMemo(() => readWrittenFiles(runtimeEvents), [runtimeEvents]);

  if (files.length === 0) {
    return null;
  }

  const visible = files.slice(-MAX_VISIBLE_FILES);
  const hiddenCount = files.length - visible.length;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 pr-0.5 text-[11px] text-muted-foreground/60">
        <FileDiffIcon className="size-3 shrink-0" />
        {files.length} {files.length === 1 ? "file" : "files"}
      </span>

      {visible.map((filePath) => (
        <span
          key={filePath}
          title={filePath}
          className="max-w-45 truncate rounded-full bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70"
        >
          {toDisplayName(filePath)}
        </span>
      ))}

      {hiddenCount > 0 ? (
        <span className="text-[10px] text-muted-foreground/40">+{hiddenCount}</span>
      ) : null}
    </div>
  );
}
