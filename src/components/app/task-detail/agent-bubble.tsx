import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  LoaderIcon,
  TerminalIcon,
} from "lucide-react";
import { useState } from "react";

import { TaskStatusBadge } from "@/components/app/task-status-badge";

import { AgentAvatar } from "./agent-avatar";
import { parseAgentMessages } from "./parsers";
import type { TaskData } from "./types";

export function AgentBubble({ task, isRunning }: { task: TaskData; isRunning: boolean }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const agentMessages = parseAgentMessages(task.agentMessages);

  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <AgentAvatar />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-4 py-3">
          {/* Status + stage */}
          <div className="flex items-center gap-2">
            <TaskStatusBadge status={task.status} />
            <span className="text-xs text-muted-foreground">{task.stage}</span>
          </div>

          {/* Agent text messages */}
          {agentMessages.length > 0 ? (
            <div className="flex flex-col gap-2">
              {agentMessages.map((msg, i) => (
                <div key={i} className="text-sm whitespace-pre-wrap">
                  {msg.text}
                </div>
              ))}
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-2">
              <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
            </div>
          ) : null}

          {/* Error */}
          {task.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Error</p>
              <p className="mt-0.5 text-xs text-destructive/80">{task.error}</p>
            </div>
          ) : null}

          {/* PR link */}
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

          {/* Logs toggle */}
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
                <div className="max-h-[300px] overflow-auto rounded-lg bg-[#0a0a0a] p-3 font-mono text-[11px] leading-relaxed text-emerald-400">
                  <pre className="break-all whitespace-pre-wrap">{task.logs}</pre>
                </div>
              ) : null}
            </div>
          ) : isRunning && agentMessages.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <TerminalIcon className="size-3" />
              <span>Waiting for logs...</span>
            </div>
          ) : null}
        </div>

        {/* Timestamp */}
        {task.completedAt ? (
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(task.completedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
