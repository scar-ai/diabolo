import { ChevronDownIcon, ChevronRightIcon, LoaderIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { TaskStatusBadge } from "@/components/app/task-status-badge";

import { AgentAvatar } from "./agent-avatar";
import type { ParsedFollowUp } from "./types";

export function FollowUpAgentBubble({ followUp }: { followUp: ParsedFollowUp }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const hasMessages = followUp.responseMessages.length > 0;
  const isRunning = followUp.status === "queued" || followUp.status === "running";

  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <AgentAvatar />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2">
            <TaskStatusBadge status={followUp.status} />
            <span className="text-xs text-muted-foreground">{followUp.stage}</span>
          </div>

          {hasMessages ? (
            <div className="flex flex-col gap-2">
              {followUp.responseMessages.map((message, index) => (
                <div key={index} className="text-sm whitespace-pre-wrap">
                  {message.text}
                </div>
              ))}
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-2">
              <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No OpenCode response captured.</div>
          )}

          {followUp.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Error</p>
              <p className="mt-0.5 text-xs text-destructive/80">{followUp.error}</p>
            </div>
          ) : null}

          {followUp.logs ? (
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
                  <pre className="break-all whitespace-pre-wrap">{followUp.logs}</pre>
                </div>
              ) : null}
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <TerminalIcon className="size-3" />
              <span>Waiting for logs...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <TerminalIcon className="size-3" />
              <span>No sandbox logs captured.</span>
            </div>
          )}
        </div>

        <span className="text-[10px] text-muted-foreground/50">
          {new Date(followUp.completedAt ?? followUp.startedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
