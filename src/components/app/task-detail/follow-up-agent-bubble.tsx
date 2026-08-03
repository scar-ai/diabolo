import { AgentMessageContent } from "./agent-message-content";
import type { ParsedFollowUp } from "./types";

export function FollowUpAgentBubble({
  followUp,
  taskId,
}: {
  followUp: ParsedFollowUp;
  taskId: string;
}) {
  const isRunning = followUp.status === "pending" || followUp.status === "processing";

  return (
    <AgentMessageContent
      artifacts={followUp.artifacts}
      completedAt={followUp.completedAt}
      error={followUp.error}
      isRunning={isRunning}
      logs={followUp.logs}
      messageId={followUp.id}
      responseMessages={followUp.responseMessages}
      runtimeEvents={followUp.runtimeEvents}
      stage={followUp.stage}
      startedAt={followUp.startedAt}
      taskId={taskId}
    />
  );
}
