import { CheckCircle2Icon, LoaderCircleIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { useMemo } from "react";

import type { ParsedTaskEvent } from "@/lib/project/task-detail-selector";
import { cn } from "@/lib/utils";

type ToolCallEntry = {
  args: unknown;
  callId: string;
  error: string;
  output: string;
  sequence: number;
  status: string;
  title: string;
  tool: string;
};

const formatStructuredValue = (value: unknown) => {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
};

const buildToolCallEntries = (runtimeEvents: ParsedTaskEvent[]) => {
  const entries = new Map<string, ToolCallEntry>();

  for (const event of runtimeEvents) {
    if (event.type !== "tool_call" && event.type !== "tool_result") {
      continue;
    }

    const callId =
      typeof event.payload.callId === "string" && event.payload.callId
        ? event.payload.callId
        : `tool-${event.sequence}`;
    const existing = entries.get(callId) ?? {
      args: null,
      callId,
      error: "",
      output: "",
      sequence: event.sequence,
      status: "pending",
      title: "",
      tool: "",
    };

    entries.set(callId, {
      ...existing,
      args: "args" in event.payload ? event.payload.args : existing.args,
      error:
        typeof event.payload.error === "string" && event.payload.error
          ? event.payload.error
          : existing.error,
      output:
        typeof event.payload.output === "string" && event.payload.output
          ? event.payload.output
          : existing.output,
      status:
        typeof event.payload.status === "string" && event.payload.status
          ? event.payload.status
          : existing.status,
      title:
        typeof event.payload.title === "string" && event.payload.title
          ? event.payload.title
          : existing.title,
      tool:
        typeof event.payload.tool === "string" && event.payload.tool
          ? event.payload.tool
          : existing.tool,
    });
  }

  return Array.from(entries.values()).sort((left, right) => left.sequence - right.sequence);
};

const getStatusLabel = (status: string) => {
  if (status === "completed") {
    return "Completed";
  }

  if (status === "error") {
    return "Failed";
  }

  if (status === "running") {
    return "Running";
  }

  return "Pending";
};

export function TaskToolCallList({ runtimeEvents }: { runtimeEvents: ParsedTaskEvent[] }) {
  const toolCalls = useMemo(() => buildToolCallEntries(runtimeEvents), [runtimeEvents]);

  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.18em] text-muted-foreground/70 uppercase">
        <WrenchIcon className="size-3" />
        <span>Tool Calls</span>
      </div>

      {toolCalls.map((toolCall) => {
        const argsText = formatStructuredValue(toolCall.args);
        const outputText = formatStructuredValue(toolCall.output);
        const errorText = formatStructuredValue(toolCall.error);
        const isError = toolCall.status === "error";
        const isComplete = toolCall.status === "completed";
        const isRunning = !isError && !isComplete;

        return (
          <div key={toolCall.callId} className="rounded-xl bg-foreground/[0.03] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {toolCall.title || toolCall.tool || "Tool call"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground/60">
                  {toolCall.tool || "tool"}
                  {toolCall.callId ? ` · ${toolCall.callId}` : ""}
                </p>
              </div>

              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium",
                  isError && "bg-destructive/10 text-destructive",
                  isComplete && "bg-success/10 text-success",
                  isRunning && "bg-info/10 text-info",
                )}
              >
                {isError ? (
                  <TriangleAlertIcon className="size-3" />
                ) : isComplete ? (
                  <CheckCircle2Icon className="size-3" />
                ) : (
                  <LoaderCircleIcon className="size-3 animate-spin" />
                )}
                <span>{getStatusLabel(toolCall.status)}</span>
              </span>
            </div>

            {argsText ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground/60 uppercase">
                  Arguments
                </span>
                <pre className="max-h-44 overflow-auto rounded-lg bg-background/80 px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground/80">
                  {argsText}
                </pre>
              </div>
            ) : null}

            {outputText ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground/60 uppercase">
                  Result
                </span>
                <pre className="max-h-52 overflow-auto rounded-lg bg-background/80 px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground/80">
                  {outputText}
                </pre>
              </div>
            ) : null}

            {errorText ? (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="text-[11px] font-medium tracking-[0.16em] text-destructive/80 uppercase">
                  Error
                </span>
                <pre className="max-h-44 overflow-auto rounded-lg border border-destructive/20 bg-destructive/6 px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-destructive/90">
                  {errorText}
                </pre>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
