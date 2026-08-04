import { Markdown } from "@/components/app/markdown";
import type { ParsedAgentMessage } from "@/lib/project/task-detail-selector";
import { cn } from "@/lib/utils";

/**
 * Renders the agent's text as the ordered blocks it produced.
 *
 * The agent emits one block per model step: narration while it works, then the
 * answer it hands back. Intermediate blocks appear live, each closed by a
 * separator, and the last block becomes the final response once the run ends —
 * so the answer is never glued to the reasoning that led to it.
 */
export function AgentTextStream({
  isRunning,
  messages,
}: {
  isRunning: boolean;
  messages: ParsedAgentMessage[];
}) {
  const blocks = messages.filter((message) => message.text.trim());

  if (blocks.length === 0) {
    return null;
  }

  // While the agent is still working, the newest block is simply the latest
  // thing it said — it only becomes the final response once the run is over.
  const finalMessage = isRunning ? null : blocks.at(-1);
  const intermediate = finalMessage ? blocks.slice(0, -1) : blocks;

  return (
    <div className="flex w-full flex-col">
      {intermediate.map((message, index) => {
        const isStreaming = isRunning && index === intermediate.length - 1;

        return (
          <div key={`${message.timestamp}-${index}`} className="flex flex-col gap-2.5">
            <div
              className={cn(
                "text-sm leading-relaxed",
                isStreaming ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Markdown content={message.text} />
            </div>

            <div className="mb-3 flex items-center gap-2" aria-hidden>
              <span className="h-px flex-1 bg-border/60" />
              {isStreaming ? (
                <span className="size-1.5 animate-pulse rounded-full bg-info/70" />
              ) : null}
            </div>
          </div>
        );
      })}

      {finalMessage ? (
        <div className="text-[15px] leading-relaxed text-foreground">
          <Markdown content={finalMessage.text} />
        </div>
      ) : null}
    </div>
  );
}
