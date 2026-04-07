import { AgentMessageContent } from "./agent-message-content";
import type { ParsedFollowUp } from "./types";

export function FollowUpAgentBubble({ followUp }: { followUp: ParsedFollowUp }) {
  const combinedText = followUp.responseMessages
    .map((m) => m.text)
    .join("\n\n")
    .trim();
  const isRunning = followUp.status === "pending" || followUp.status === "processing";

  return (
    <AgentMessageContent
      artifacts={followUp.artifacts}
      combinedText={combinedText}
      completedAt={followUp.completedAt}
      error={followUp.error}
      isRunning={isRunning}
      logs={followUp.logs}
      stage={followUp.stage}
      startedAt={followUp.startedAt}
    />
  );
}
