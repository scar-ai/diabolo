import { ClientTimeText } from "@/components/app/client-time";
import type {
  ParsedAgentMessage,
  ParsedTaskArtifact,
  ParsedTaskEvent,
} from "@/lib/project/task-detail-selector";

import { AgentTextStream } from "./agent-text-stream";
import { TaskActivityPanel } from "./task-activity-panel";
import { TaskArtifactList } from "./task-artifact-list";

type AgentMessageContentProps = {
  artifacts: ParsedTaskArtifact[];
  completedAt?: Date | string | null;
  error?: string | null;
  isRunning: boolean;
  logs?: string | null;
  messageId?: string | null;
  responseMessages: ParsedAgentMessage[];
  runtimeEvents: ParsedTaskEvent[];
  stage?: string | null;
  startedAt?: Date | string | null;
  taskId: string;
};

export function AgentMessageContent({
  artifacts,
  completedAt,
  error,
  isRunning,
  logs,
  messageId,
  responseMessages,
  runtimeEvents,
  stage,
  startedAt,
  taskId,
}: AgentMessageContentProps) {
  // A finished run with no text at all is a failure worth showing: without this
  // the bubble renders blank and looks like the UI dropped the response.
  const hasNoResponse =
    !isRunning && !error && !responseMessages.some((message) => message.text.trim());

  return (
    <div className="flex w-full flex-col gap-3">
      <TaskActivityPanel
        completedAt={completedAt}
        error={error}
        isRunning={isRunning}
        logs={logs}
        messageId={messageId}
        runtimeEvents={runtimeEvents}
        stage={stage}
        startedAt={startedAt}
        taskId={taskId}
      />

      <AgentTextStream isRunning={isRunning} messages={responseMessages} />

      {hasNoResponse ? (
        <p className="text-sm text-muted-foreground italic">
          The agent finished without returning a message.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2">
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
