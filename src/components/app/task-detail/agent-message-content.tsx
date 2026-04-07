import { ChevronDownIcon, ChevronRightIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { Markdown } from "@/components/app/markdown";
import type { ParsedTaskArtifact } from "@/lib/project/task-detail-selector";

import { ThinkingWave } from "./agent-bubble";
import { TaskArtifactList } from "./task-artifact-list";

type AgentMessageContentProps = {
  artifacts: ParsedTaskArtifact[];
  combinedText: string;
  completedAt?: Date | string | null;
  error?: string | null;
  isRunning: boolean;
  logs?: string | null;
  stage?: string | null;
  startedAt?: Date | string | null;
};

export function AgentMessageContent({
  artifacts,
  combinedText,
  completedAt,
  error,
  isRunning,
  logs,
  stage,
  startedAt,
}: AgentMessageContentProps) {
  const [logsOpen, setLogsOpen] = useState(false);

  return (
    <div className="flex w-full flex-col gap-3">
      {combinedText ? (
        <div className="text-sm leading-relaxed text-foreground">
          <Markdown content={combinedText} />
        </div>
      ) : isRunning ? (
        <ThinkingWave text={stage ? `${stage}...` : undefined} />
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">Error</p>
          <p className="mt-0.5 text-xs text-destructive/80">{error}</p>
        </div>
      ) : null}

      {logs ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setLogsOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <TerminalIcon className="size-3" />
            <span>Sandbox logs</span>
            {isRunning ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            ) : null}
            {logsOpen ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </button>
          {logsOpen ? (
            <div className="max-h-75 overflow-auto rounded-lg bg-[#0a0a0a] p-3 font-mono text-[11px] leading-relaxed text-emerald-400">
              <pre className="break-all whitespace-pre-wrap">{logs}</pre>
            </div>
          ) : null}
        </div>
      ) : isRunning && !combinedText ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
          <TerminalIcon className="size-3" />
          <span>Waiting for logs...</span>
        </div>
      ) : null}

      <TaskArtifactList artifacts={artifacts} />

      {completedAt || startedAt ? (
        <span className="text-[11px] text-muted-foreground/50">
          {new Date(completedAt ?? startedAt!).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ) : null}
    </div>
  );
}
