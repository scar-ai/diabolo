import { ChevronDownIcon, ChevronRightIcon, LoaderIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { Markdown } from "@/components/app/markdown";

import type { ParsedFollowUp } from "./types";

export function FollowUpAgentBubble({ followUp }: { followUp: ParsedFollowUp }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const combinedText = followUp.responseMessages.map((m) => m.text).join("\n\n");
  const isRunning = followUp.status === "queued" || followUp.status === "running";

  return (
    <div className="flex w-full flex-col gap-3">
      <span className="text-xs text-muted-foreground">{followUp.stage}</span>

      {combinedText ? (
        <div className="text-sm leading-relaxed text-foreground">
          <Markdown content={combinedText} />
        </div>
      ) : isRunning ? (
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" />
          <span>Thinking...</span>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No response captured.</div>
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
      ) : null}

      <span className="text-[11px] text-muted-foreground/50">
        {new Date(followUp.completedAt ?? followUp.startedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}
