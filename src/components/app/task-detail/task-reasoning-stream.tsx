import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const PREVIEW_LENGTH = 140;

/**
 * The model's live thinking.
 *
 * Collapsed by default and never persisted: this exists to answer "what is it
 * doing right now", and it disappears once the run produces its answer.
 */
export function TaskReasoningStream({ blocks }: { blocks: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const text = blocks.join("\n\n").trim();

  useEffect(() => {
    const element = scrollRef.current;

    if (isOpen && element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [isOpen, text]);

  if (!text) {
    return null;
  }

  const tail = text.slice(-PREVIEW_LENGTH).replace(/\s+/g, " ").trim();

  return (
    <div className="mt-3 border-l border-border/70 pl-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        <span className="shrink-0 font-medium tracking-[0.16em] uppercase">Thinking</span>
        {isOpen ? null : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/40 italic">{tail}</span>
        )}
        <ChevronDownIcon
          className={cn("ml-auto size-3 shrink-0 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen ? (
        <div ref={scrollRef} className="mt-2 max-h-52 overflow-auto">
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground/70">
            {text}
          </p>
        </div>
      ) : null}
    </div>
  );
}
