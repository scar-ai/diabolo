import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ParsedTaskEvent } from "@/lib/project/task-detail-selector";
import { formatTaskStage, formatToolActivity } from "@/lib/task-activity";
import { cn } from "@/lib/utils";

import { TaskToolCallList } from "./task-tool-call-list";

type ActivityEntry = {
  label: string;
  sequence: number;
  status: "completed" | "error" | "running";
};

const getEventTime = (event: ParsedTaskEvent) => {
  const timestamp = event.payload.timestamp;
  return typeof timestamp === "number" ? timestamp : new Date(event.createdAt).getTime();
};

const buildActivityEntries = (
  runtimeEvents: ParsedTaskEvent[],
  stage: string | null | undefined,
  isRunning: boolean,
  hasError: boolean,
) => {
  const entries: ActivityEntry[] = [];
  const toolEntries = new Map<string, ActivityEntry>();

  for (const event of runtimeEvents) {
    if (event.type === "task_stage" && typeof event.payload.stage === "string") {
      entries.push({
        label: formatTaskStage(event.payload.stage),
        sequence: event.sequence,
        status: "completed",
      });
      continue;
    }

    if (event.type !== "tool_call" && event.type !== "tool_result") {
      continue;
    }

    const callId =
      typeof event.payload.callId === "string" && event.payload.callId
        ? event.payload.callId
        : `tool-${event.sequence}`;
    const eventStatus =
      event.payload.status === "error"
        ? "error"
        : event.type === "tool_result" || event.payload.status === "completed"
          ? "completed"
          : "running";
    const previous = toolEntries.get(callId);
    toolEntries.set(callId, {
      label: formatToolActivity(event.payload),
      sequence: previous?.sequence ?? event.sequence,
      status: eventStatus,
    });
  }

  entries.push(...toolEntries.values());
  entries.sort((left, right) => left.sequence - right.sequence);

  const collapsed = entries.filter((entry, index) => entry.label !== entries[index - 1]?.label);
  const lastEntry = collapsed.at(-1);
  const currentStage = formatTaskStage(stage ?? "Working on task");

  if (isRunning && (!lastEntry || lastEntry.status !== "running")) {
    collapsed.push({
      label: currentStage,
      sequence: (lastEntry?.sequence ?? 0) + 1,
      status: "running",
    });
  }

  if (!isRunning) {
    const completedEntries = collapsed.map((entry) => ({
      ...entry,
      status: entry.status === "running" ? ("completed" as const) : entry.status,
    }));
    const lastCompletedEntry = completedEntries.at(-1);

    if (hasError && lastCompletedEntry) {
      lastCompletedEntry.status = "error";
    }

    return completedEntries;
  }

  return collapsed;
};

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
};

const formatLastActivity = (ageMs: number) => {
  const seconds = Math.max(0, Math.floor(ageMs / 1_000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
};

export function TaskActivityPanel({
  error,
  isRunning,
  logs,
  runtimeEvents,
  stage,
  startedAt,
}: {
  error?: string | null;
  isRunning: boolean;
  logs?: string | null;
  runtimeEvents: ParsedTaskEvent[];
  stage?: string | null;
  startedAt?: Date | string | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const toolCallCount = useMemo(
    () =>
      new Set(
        runtimeEvents.flatMap((event) =>
          event.type === "tool_call" || event.type === "tool_result"
            ? [
                typeof event.payload.callId === "string" && event.payload.callId
                  ? event.payload.callId
                  : `tool-${event.sequence}`,
              ]
            : [],
        ),
      ).size,
    [runtimeEvents],
  );
  const entries = useMemo(
    () => buildActivityEntries(runtimeEvents, stage, isRunning, Boolean(error)),
    [error, isRunning, runtimeEvents, stage],
  );
  const visibleEntries = entries.slice(-4);
  const latestEventAt = runtimeEvents.reduce<number | null>(
    (latest, event) => {
      const eventTime = getEventTime(event);
      return latest === null || eventTime > latest ? eventTime : latest;
    },
    startedAt ? new Date(startedAt).getTime() : null,
  );
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : null;
  const hasTechnicalDetails = toolCallCount > 0 || Boolean(logs);

  useEffect(() => {
    if (!isRunning) return;

    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = window.setInterval(updateNow, 1_000);
    return () => window.clearInterval(interval);
  }, [isRunning]);

  if (!isRunning && !hasTechnicalDetails) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/25 p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          {isRunning ? (
            <LoaderCircleIcon className="size-3.5 animate-spin text-sky-600" />
          ) : error ? (
            <TriangleAlertIcon className="size-3.5 text-destructive" />
          ) : (
            <CheckCircle2Icon className="size-3.5 text-emerald-600" />
          )}
          {isRunning ? "Working" : error ? "Failed" : "Completed"}
        </span>
        {now !== null && startedAtMs !== null ? (
          <span className="text-muted-foreground">· {formatDuration(now - startedAtMs)}</span>
        ) : null}
        {isRunning && now !== null && latestEventAt !== null ? (
          <span className="text-muted-foreground/70">
            · last activity {formatLastActivity(now - latestEventAt)}
          </span>
        ) : null}
      </div>

      {visibleEntries.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-2">
          {visibleEntries.map((entry, index) => {
            const isActive = isRunning && index === visibleEntries.length - 1;
            return (
              <li
                key={`${entry.sequence}-${entry.label}`}
                className={cn(
                  "flex items-start gap-2 text-xs",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {entry.status === "error" ? (
                  <CircleIcon className="mt-0.5 size-3.5 fill-destructive text-destructive" />
                ) : isActive ? (
                  <LoaderCircleIcon className="mt-0.5 size-3.5 animate-spin text-sky-600" />
                ) : (
                  <CheckCircle2Icon className="mt-0.5 size-3.5 text-emerald-600/80" />
                )}
                <span className={cn(isActive && "font-medium")}>{entry.label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {hasTechnicalDetails ? (
        <div className="mt-3 border-t border-border/60 pt-2.5">
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <TerminalIcon className="size-3" />
            <span>
              {detailsOpen ? "Hide" : "Show"} technical activity
              {toolCallCount > 0 ? ` (${toolCallCount})` : ""}
            </span>
            {isRunning ? (
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            ) : null}
            {detailsOpen ? (
              <ChevronDownIcon className="size-3" />
            ) : (
              <ChevronRightIcon className="size-3" />
            )}
          </button>

          {detailsOpen ? (
            <div className="mt-3 flex flex-col gap-3">
              <TaskToolCallList runtimeEvents={runtimeEvents} />
              {logs ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground/70 uppercase">
                    Sandbox logs
                  </span>
                  <div className="max-h-75 overflow-auto rounded-lg bg-[#0a0a0a] p-3 font-mono text-[11px] leading-relaxed text-emerald-400">
                    <pre className="break-all whitespace-pre-wrap">{logs}</pre>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
