import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  TerminalIcon,
} from "lucide-react";
import { useState } from "react";

import { Markdown } from "@/components/app/markdown";
import { cn } from "@/lib/utils";

import type { TaskData } from "./types";

const THINKING_TEXT = "Thinking...";
const WAVE_CHARS = THINKING_TEXT.split("");

function ThinkingWave() {
  return (
    <span className="text-sm font-medium" aria-label="Thinking">
      {WAVE_CHARS.map((char, i) => (
        <span
          key={i}
          className={cn(
            "inline-block animate-[wave_2.2s_ease-in-out_infinite] text-white",
            char === " " && "w-1",
          )}
          style={{ animationDelay: `${i * 0.08}s` }}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

export function AgentBubble({ task, isRunning }: { task: TaskData; isRunning: boolean }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const combinedText = task.combinedAgentText;

  return (
    <div className="flex w-full flex-col gap-3">
      {task.stage ? <span className="text-xs text-muted-foreground">{task.stage}</span> : null}

      {combinedText ? (
        <div className="text-sm leading-relaxed text-foreground">
          <Markdown content={combinedText} />
        </div>
      ) : isRunning ? (
        <ThinkingWave />
      ) : null}

      {task.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">Error</p>
          <p className="mt-0.5 text-xs text-destructive/80">{task.error}</p>
        </div>
      ) : null}

      {task.prUrl ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
          <GitPullRequestIcon className="size-3.5 shrink-0 text-emerald-500" />
          <a
            href={task.prUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
          >
            View PR #{task.prNumber}
            <ExternalLinkIcon className="size-2.5" />
          </a>
        </div>
      ) : null}

      {task.logs ? (
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
              <pre className="break-all whitespace-pre-wrap">{task.logs}</pre>
            </div>
          ) : null}
        </div>
      ) : isRunning && !combinedText ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
          <TerminalIcon className="size-3" />
          <span>Waiting for logs...</span>
        </div>
      ) : null}

      {task.completedAt ? (
        <span className="text-[11px] text-muted-foreground/50">
          {new Date(task.completedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ) : null}
    </div>
  );
}
