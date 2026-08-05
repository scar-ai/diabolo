import { cn } from "@/lib/utils";

import { AgentMessageContent } from "./agent-message-content";
import type { TaskData } from "./types";

export function ThinkingWave({ text = "Thinking..." }: { text?: string }) {
  const chars = text.split("");
  return (
    <span className="text-sm font-medium" aria-label={text}>
      {chars.map((char, i) => (
        <span
          key={i}
          className={cn(
            "inline-block animate-[wave_2.2s_ease-in-out_infinite] text-foreground",
            char === " " && "w-1",
          )}
          style={{ animationDelay: `${i * 0.08}s` }}
        >
          {char}
        </span>
      ))}
    </span>
  );
}

export function AgentBubble({ task, isRunning }: { task: TaskData; isRunning: boolean }) {
  const initialMessage = task.parsedConversation[0];

  return (
    <AgentMessageContent
      artifacts={initialMessage?.artifacts ?? []}
      completedAt={initialMessage?.completedAt ?? task.completedAt}
      diffAdditions={initialMessage?.diffAdditions}
      diffDeletions={initialMessage?.diffDeletions}
      diffFileCount={initialMessage?.diffFileCount}
      error={task.error}
      isRunning={isRunning}
      logs={task.logs}
      messageId={initialMessage?.id ?? null}
      responseMessages={task.parsedAgentMessages}
      runtimeEvents={initialMessage?.runtimeEvents ?? []}
      stage={task.stage}
      startedAt={initialMessage?.startedAt ?? task.startedAt}
      taskId={task.id}
    />
  );
}
