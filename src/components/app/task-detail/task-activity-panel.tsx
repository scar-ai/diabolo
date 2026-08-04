import { ChevronDownIcon, TerminalIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ParsedTaskEvent } from "@/lib/project/task-detail-selector";
import { useTaskLiveActivity } from "@/lib/session/use-task-live-activity";
import { formatTaskStage, formatToolActivity, readCurrentFocus } from "@/lib/task-activity";
import { cn } from "@/lib/utils";

import { TaskFileChanges } from "./task-file-changes";
import { TaskReasoningStream } from "./task-reasoning-stream";
import { TaskTodoList } from "./task-todo-list";
import { TaskToolCallList } from "./task-tool-call-list";

type ActivityEntry = {
  endedAt: number | null;
  label: string;
  sequence: number;
  startedAt: number;
  status: "completed" | "error" | "running";
};

/** How many steps stay visible before the timeline has to be expanded. */
const COLLAPSED_ENTRY_COUNT = 4;

/** Silence longer than this while running is worth flagging to the user. */
const STALL_THRESHOLD_MS = 120_000;

const getEventTime = (event: ParsedTaskEvent) => {
  const timestamp = event.payload.timestamp;
  return typeof timestamp === "number" ? timestamp : new Date(event.createdAt).getTime();
};

const buildActivityEntries = (
  runtimeEvents: ParsedTaskEvent[],
  stage: string | null | undefined,
  isRunning: boolean,
  hasError: boolean,
  runStartedAtMs: number | null,
) => {
  const entries: ActivityEntry[] = [];
  const toolEntries = new Map<string, ActivityEntry>();
  const firstEvent = runtimeEvents[0];
  const firstEventAt = firstEvent ? getEventTime(firstEvent) : null;

  for (const event of runtimeEvents) {
    if (event.type === "task_stage" && typeof event.payload.stage === "string") {
      entries.push({
        endedAt: getEventTime(event),
        label: formatTaskStage(event.payload.stage),
        sequence: event.sequence,
        startedAt: getEventTime(event),
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
      // A tool's start and end arrive as separate events, so the pair is what
      // gives each step a duration.
      endedAt: eventStatus === "running" ? null : getEventTime(event),
      label: formatToolActivity(event.payload),
      sequence: previous?.sequence ?? event.sequence,
      startedAt: previous?.startedAt ?? getEventTime(event),
      status: eventStatus,
    });
  }

  entries.push(...toolEntries.values());
  entries.sort((left, right) => left.sequence - right.sequence);

  const collapsed = entries.filter((entry, index) => entry.label !== entries[index - 1]?.label);
  const lastEntry = collapsed.at(-1);
  const currentStage = formatTaskStage(stage ?? "Working on task");

  if (isRunning && lastEntry?.status !== "running") {
    // A stage event is instantaneous, so the stage the run is *currently* in
    // has already been recorded as a completed step. Reopening that step is
    // what keeps "Agent is working" from being listed twice — once ticked off,
    // once live — which is the same step, not two.
    if (lastEntry && lastEntry.label === currentStage) {
      collapsed[collapsed.length - 1] = { ...lastEntry, endedAt: null, status: "running" };
    } else {
      collapsed.push({
        endedAt: null,
        label: currentStage,
        sequence: (lastEntry?.sequence ?? 0) + 1,
        // Every value here has to be derived from the run itself: this is
        // rebuilt on each poll, and a `Date.now()` fallback would restart the
        // live step's timer every couple of seconds instead of counting up.
        startedAt: lastEntry?.endedAt ?? runStartedAtMs ?? firstEventAt ?? Date.now(),
        status: "running",
      });
    }
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

/**
 * Live state is held per task but describes a single run, so each bubble shows
 * it only when it belongs to that bubble's message. An event without a message
 * id predates per-message attribution and is shown rather than dropped.
 */
const belongsToMessage = (eventMessageId: string | null, messageId: string | null | undefined) =>
  !messageId || !eventMessageId || eventMessageId === messageId;

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1_000
      ? `${(tokens / 1_000).toFixed(1)}k`
      : String(tokens);

/**
 * A small dot carrying the run's state, pinging while the agent is live. It is
 * the panel's only always-on motion, so a glance at it answers "is this alive".
 */
function StatusDot({ tone }: { tone: "error" | "running" | "success" }) {
  if (tone === "running") {
    return (
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info/60" />
        <span className="relative inline-flex size-2 rounded-full bg-info" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "error" ? "bg-destructive" : "bg-success/70",
      )}
    />
  );
}

export function TaskActivityPanel({
  completedAt,
  error,
  isRunning,
  logs,
  messageId,
  runtimeEvents,
  stage,
  startedAt,
  taskId,
}: {
  completedAt?: Date | string | null;
  error?: string | null;
  isRunning: boolean;
  logs?: string | null;
  messageId?: string | null;
  runtimeEvents: ParsedTaskEvent[];
  stage?: string | null;
  startedAt?: Date | string | null;
  taskId: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const liveActivity = useTaskLiveActivity(taskId);
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
  const firstEventAtMs = useMemo(
    () =>
      runtimeEvents.reduce<number | null>((earliest, event) => {
        const eventTime = getEventTime(event);
        return earliest === null || eventTime < earliest ? eventTime : earliest;
      }, null),
    [runtimeEvents],
  );
  const rowStartedAtMs = startedAt ? new Date(startedAt).getTime() : null;
  // Event payloads carry epoch milliseconds straight from the runtime, while a
  // message row carries a database timestamp. Nothing can be logged before the
  // run starts, so a row claiming a later start than its own first event is a
  // clock skew, and the events are the ones worth believing.
  const startedAtMs =
    rowStartedAtMs === null
      ? firstEventAtMs
      : firstEventAtMs === null
        ? rowStartedAtMs
        : Math.min(rowStartedAtMs, firstEventAtMs);
  const entries = useMemo(
    () => buildActivityEntries(runtimeEvents, stage, isRunning, Boolean(error), startedAtMs),
    [error, isRunning, runtimeEvents, stage, startedAtMs],
  );
  const currentSummary = useMemo(
    () => (isRunning ? readCurrentFocus(runtimeEvents) : null),
    [isRunning, runtimeEvents],
  );
  const timelineEntries = entries.filter(
    (entry, index) =>
      !(currentSummary && index === entries.length - 1 && entry.label === currentSummary),
  );
  const visibleEntries = timelineOpen
    ? timelineEntries
    : timelineEntries.slice(-COLLAPSED_ENTRY_COUNT);
  const hiddenEntryCount = timelineEntries.length - visibleEntries.length;
  const latestEventAt = runtimeEvents.reduce<number | null>((latest, event) => {
    const eventTime = getEventTime(event);
    return latest === null || eventTime > latest ? eventTime : latest;
  }, startedAtMs);
  const hasTechnicalDetails = toolCallCount > 0 || Boolean(logs);
  const reasoningBlocks =
    isRunning &&
    liveActivity.reasoning &&
    belongsToMessage(liveActivity.reasoning.messageId, messageId)
      ? liveActivity.reasoning.blocks
      : null;
  const usage =
    liveActivity.usage && belongsToMessage(liveActivity.usage.messageId, messageId)
      ? liveActivity.usage
      : null;
  const stalledForMs =
    isRunning && now !== null && latestEventAt !== null ? now - latestEventAt : 0;
  const isStalled = stalledForMs > STALL_THRESHOLD_MS;
  const tone = isRunning ? "running" : error ? "error" : "success";
  // A live run counts against the ticking clock; a finished one is pinned to
  // when it actually ended, so reloading the page still shows how long it took.
  const completedAtMs = completedAt ? new Date(completedAt).getTime() : null;
  const elapsedEndMs = isRunning ? now : (completedAtMs ?? now);
  const elapsedMs =
    startedAtMs === null || elapsedEndMs === null ? null : elapsedEndMs - startedAtMs;
  // Assembled as a list so the thin dividers between them stay even, however
  // many of these the run actually has to report.
  const metaItems = [
    elapsedMs !== null ? formatDuration(elapsedMs) : null,
    usage ? `${formatTokens(usage.totalTokens)} tokens` : null,
    toolCallCount > 0 ? `${toolCallCount} ${toolCallCount === 1 ? "step" : "steps"}` : null,
  ].filter((item): item is string => item !== null);

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
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/50">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-1">
        <span className="inline-flex items-center gap-2">
          <StatusDot tone={tone} />
          <span
            className={cn(
              "text-xs font-medium",
              tone === "error" ? "text-destructive" : "text-foreground",
            )}
          >
            {isRunning ? "Working" : error ? "Failed" : "Completed"}
          </span>
        </span>

        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground/60 tabular-nums">
          {metaItems.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="h-2.5 w-px bg-border" aria-hidden /> : null}
              {item}
            </span>
          ))}
          {isRunning && now !== null && latestEventAt !== null && isStalled ? (
            <span className="flex items-center gap-2 text-warning">
              {metaItems.length > 0 ? <span className="h-2.5 w-px bg-border" aria-hidden /> : null}
              {formatLastActivity(now - latestEventAt)}
            </span>
          ) : null}
        </span>
      </div>

      <div className="px-4 pb-3.5">
        {/* The headline: the one line answering "what is it doing right now". */}
        {currentSummary ? (
          <p className={cn("mt-1.5 text-sm leading-relaxed", isRunning && "status-shimmer")}>
            {currentSummary}
          </p>
        ) : null}

        {isStalled ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning/8 px-3 py-2 text-xs leading-relaxed text-warning">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            <span>
              No activity for {formatDuration(stalledForMs)}. The agent may be on a long-running
              step, or the sandbox may have stopped responding.
            </span>
          </p>
        ) : null}

        <TaskTodoList runtimeEvents={runtimeEvents} />

        {reasoningBlocks ? <TaskReasoningStream blocks={reasoningBlocks} /> : null}

        {visibleEntries.length > 0 ? (
          <ol className={cn("mt-3 flex flex-col", timelineOpen && "max-h-64 overflow-y-auto pr-1")}>
            {visibleEntries.map((entry, index) => {
              const isLast = index === visibleEntries.length - 1;
              const isActive = isRunning && isLast;
              // The live step counts up as it runs, so a slow one is visibly
              // slow rather than indistinguishable from a stuck one.
              const durationMs =
                entry.endedAt === null
                  ? isActive && now !== null
                    ? now - entry.startedAt
                    : null
                  : entry.endedAt - entry.startedAt;

              return (
                <li
                  key={`${entry.sequence}-${entry.label}`}
                  className={cn(
                    "relative flex items-start gap-2.5 pb-2.5 text-xs last:pb-0",
                    isActive ? "text-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {/* One continuous rail behind the markers reads as a single
                      run, where a column of separate icons reads as a list. */}
                  {isLast ? null : (
                    <span
                      className="absolute top-3 bottom-0 left-[3.5px] w-px bg-border/70"
                      aria-hidden
                    />
                  )}

                  <span className="relative mt-1.5 flex size-2 shrink-0 items-center justify-center">
                    {isActive ? (
                      <>
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info/50" />
                        <span className="relative size-2 rounded-full bg-info" />
                      </>
                    ) : (
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          entry.status === "error" ? "bg-destructive" : "bg-foreground/25",
                        )}
                      />
                    )}
                  </span>

                  <span className={cn("min-w-0 flex-1 leading-5", isActive && "font-medium")}>
                    {entry.label}
                  </span>

                  {/* Sub-second steps are noise; only slow ones are worth a label. */}
                  {durationMs !== null && durationMs >= 1_000 ? (
                    <span
                      className={cn(
                        "mt-px shrink-0 text-[11px] tabular-nums",
                        isActive ? "text-muted-foreground/70" : "text-muted-foreground/40",
                      )}
                    >
                      {formatDuration(durationMs)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        {hiddenEntryCount > 0 || timelineOpen ? (
          <button
            type="button"
            aria-expanded={timelineOpen}
            onClick={() => setTimelineOpen((current) => !current)}
            className="mt-2.5 text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground"
          >
            {timelineOpen ? "Show fewer steps" : `Show all ${timelineEntries.length} steps`}
          </button>
        ) : null}

        <TaskFileChanges runtimeEvents={runtimeEvents} />
      </div>

      {hasTechnicalDetails ? (
        <div className="border-t border-border/50">
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
            className="flex w-full items-center gap-1.5 px-4 py-2.5 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            <TerminalIcon className="size-3 shrink-0" />
            <span>
              Technical activity
              {toolCallCount > 0 ? ` · ${toolCallCount}` : ""}
            </span>
            <ChevronDownIcon
              className={cn(
                "ml-auto size-3.5 shrink-0 transition-transform",
                detailsOpen && "rotate-180",
              )}
            />
          </button>

          {detailsOpen ? (
            <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
              <TaskToolCallList runtimeEvents={runtimeEvents} />
              {logs ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium tracking-[0.16em] text-muted-foreground/50 uppercase">
                    Sandbox logs
                  </span>
                  <div className="max-h-75 overflow-auto rounded-xl bg-muted p-3 font-mono text-[11px] leading-relaxed text-success/80">
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
