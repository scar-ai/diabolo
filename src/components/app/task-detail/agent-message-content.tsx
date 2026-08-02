import { ClientTimeText } from "@/components/app/client-time";
import { Markdown } from "@/components/app/markdown";
import type { ParsedTaskArtifact, ParsedTaskEvent } from "@/lib/project/task-detail-selector";

import { TaskActivityPanel } from "./task-activity-panel";
import { TaskArtifactList } from "./task-artifact-list";

type AgentMessageContentProps = {
  artifacts: ParsedTaskArtifact[];
  combinedText: string;
  completedAt?: Date | string | null;
  error?: string | null;
  isRunning: boolean;
  logs?: string | null;
  runtimeEvents: ParsedTaskEvent[];
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
  runtimeEvents,
  stage,
  startedAt,
}: AgentMessageContentProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      <TaskActivityPanel
        error={error}
        isRunning={isRunning}
        logs={logs}
        runtimeEvents={runtimeEvents}
        stage={stage}
        startedAt={startedAt}
      />

      {combinedText ? (
        <div className="text-sm leading-relaxed text-foreground">
          <Markdown content={combinedText} />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs font-medium text-destructive">Error</p>
          <p className="mt-0.5 text-xs text-destructive/80">{error}</p>
        </div>
      ) : null}

      <TaskArtifactList artifacts={artifacts} />

      {completedAt || startedAt ? (
        <span className="text-[11px] text-muted-foreground/50">
          <ClientTimeText
            value={completedAt ?? startedAt!}
            options={{
              hour: "2-digit",
              minute: "2-digit",
            }}
          />
        </span>
      ) : null}
    </div>
  );
}
