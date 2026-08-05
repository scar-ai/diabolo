import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronRightIcon, FileDiffIcon, LoaderIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { taskDiffFilesQueryOptions, taskDiffPatchQueryOptions } from "@/lib/project/queries";
import { formatDiffChangeType, parseDiffLines } from "@/lib/task-diff";
import { cn } from "@/lib/utils";

type DiffFileSummary = {
  additions: number;
  changeType: string;
  deletions: number;
  filePath: string;
  id: string;
  isBinary: number;
  previousPath: string | null;
  truncated: number;
};

const splitPath = (filePath: string) => {
  const index = filePath.lastIndexOf("/");

  return index === -1
    ? { directory: "", name: filePath }
    : { directory: filePath.slice(0, index + 1), name: filePath.slice(index + 1) };
};

const changeTypeAccent = (changeType: string) =>
  changeType === "added"
    ? "text-success"
    : changeType === "deleted"
      ? "text-destructive"
      : changeType === "renamed"
        ? "text-info"
        : "text-muted-foreground";

function DiffStat({
  additions,
  className,
  deletions,
}: {
  additions: number;
  className?: string;
  deletions: number;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 tabular-nums", className)}>
      <span className="text-success">+{additions}</span>
      <span className="text-destructive">−{deletions}</span>
    </span>
  );
}

function DiffFileContent({ diffFileId, taskId }: { diffFileId: string; taskId: string }) {
  const patchQuery = useQuery(taskDiffPatchQueryOptions(taskId, diffFileId));
  const lines = useMemo(
    () => (patchQuery.data ? parseDiffLines(patchQuery.data.patch) : []),
    [patchQuery.data],
  );

  if (patchQuery.isPending) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground/60">
        <LoaderIcon className="size-3 animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (patchQuery.isError) {
    return <p className="px-4 py-3 text-[11px] text-destructive">This diff could not be loaded.</p>;
  }

  if (patchQuery.data?.isBinary) {
    return (
      <p className="px-4 py-3 text-[11px] text-muted-foreground/60">
        Binary file — no text diff to show.
      </p>
    );
  }

  if (lines.length === 0) {
    return (
      <p className="px-4 py-3 text-[11px] text-muted-foreground/60">
        No line changes recorded for this file.
      </p>
    );
  }

  return (
    <div className="max-h-125 overflow-auto border-t border-border/40 bg-muted/40">
      <table className="w-full border-collapse font-mono text-[11px] leading-[1.7]">
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={index}
              className={cn(
                line.type === "addition" && "bg-success/10",
                line.type === "deletion" && "bg-destructive/10",
                line.type === "hunk" && "bg-info/8 text-info",
              )}
            >
              <td className="w-10 shrink-0 border-r border-border/40 px-2 text-right align-top text-muted-foreground/40 tabular-nums select-none">
                {line.oldLineNumber ?? ""}
              </td>
              <td className="w-10 shrink-0 border-r border-border/40 px-2 text-right align-top text-muted-foreground/40 tabular-nums select-none">
                {line.newLineNumber ?? ""}
              </td>
              <td
                className={cn(
                  "px-3 align-top whitespace-pre-wrap",
                  line.type === "addition" && "text-success",
                  line.type === "deletion" && "text-destructive",
                  line.type === "context" && "text-foreground/80",
                )}
              >
                <span className="text-muted-foreground/40 select-none">
                  {line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " "}
                </span>
                {line.content}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {patchQuery.data?.truncated ? (
        <p className="border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground/60">
          This diff was too large to store in full and has been truncated.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The run's file changes, kept behind a single button: a finished task usually
 * touches more files than anyone wants dumped into the conversation, and the
 * patches are only fetched once a file is actually opened.
 */
export function TaskDiffPanel({
  additions,
  deletions,
  fileCount,
  messageId,
  taskId,
}: {
  additions: number;
  deletions: number;
  fileCount: number;
  messageId: string;
  taskId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openFileId, setOpenFileId] = useState<string | null>(null);
  const filesQuery = useQuery({
    ...taskDiffFilesQueryOptions(taskId, messageId),
    enabled: isOpen,
  });
  const files: DiffFileSummary[] = filesQuery.data ?? [];

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/50">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-4 py-3 text-xs transition-colors hover:bg-accent/40"
      >
        <FileDiffIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <span className="font-medium text-foreground">
          {fileCount} {fileCount === 1 ? "file" : "files"} changed
        </span>
        <DiffStat additions={additions} className="text-[11px]" deletions={deletions} />
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen ? (
        <div className="border-t border-border/50">
          {filesQuery.isPending ? (
            <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground/60">
              <LoaderIcon className="size-3 animate-spin" />
              Loading changed files…
            </div>
          ) : filesQuery.isError ? (
            <p className="px-4 py-3 text-[11px] text-destructive">
              The changed files could not be loaded.
            </p>
          ) : files.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-muted-foreground/60">
              No file changes were recorded for this run.
            </p>
          ) : (
            <ul className="flex flex-col">
              {files.map((file) => {
                const { directory, name } = splitPath(file.filePath);
                const isFileOpen = openFileId === file.id;

                return (
                  <li key={file.id} className="border-b border-border/40 last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={isFileOpen}
                      onClick={() => setOpenFileId(isFileOpen ? null : file.id)}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-accent/40"
                      title={
                        file.previousPath
                          ? `${file.previousPath} → ${file.filePath}`
                          : file.filePath
                      }
                    >
                      <ChevronRightIcon
                        className={cn(
                          "size-3 shrink-0 text-muted-foreground/40 transition-transform",
                          isFileOpen && "rotate-90",
                        )}
                      />
                      <span
                        className={cn(
                          "w-16 shrink-0 text-[10px] tracking-wide uppercase",
                          changeTypeAccent(file.changeType),
                        )}
                      >
                        {formatDiffChangeType(file.changeType)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        <span className="text-muted-foreground/50">{directory}</span>
                        <span className="text-foreground">{name}</span>
                      </span>
                      {file.isBinary === 1 ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground/50">
                          binary
                        </span>
                      ) : (
                        <DiffStat
                          additions={file.additions}
                          className="text-[10px]"
                          deletions={file.deletions}
                        />
                      )}
                    </button>

                    {isFileOpen ? <DiffFileContent diffFileId={file.id} taskId={taskId} /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
