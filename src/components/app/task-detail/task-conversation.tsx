import { ArrowDownIcon } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { AgentBubble } from "./agent-bubble";
import { FollowUpAgentBubble } from "./follow-up-agent-bubble";
import { TaskChildList } from "./task-child-list";
import type { CollaboratorMap, ParsedFollowUp, TaskData } from "./types";
import { UserBubble } from "./user-bubble";

export function TaskConversation({
  collaborators,
  followUps,
  pendingFollowUpPrompt,
  scrollRef,
  task,
  taskIsRunning,
}: {
  collaborators?: CollaboratorMap;
  followUps: ParsedFollowUp[];
  pendingFollowUpPrompt: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  task: TaskData;
  taskIsRunning: boolean;
}) {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setIsAtBottom(entry.isIntersecting), {
      rootMargin: "-200px 0px 0px 0px",
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const scrollToBottom = () => {
    sentinelRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const taskCreator = task.createdByUserId
    ? (collaborators?.get(task.createdByUserId) ?? null)
    : null;

  return (
    <>
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto">
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-6",
            task.prUrl ? "pb-48" : "pb-38",
          )}
        >
          <UserBubble text={task.prompt} timestamp={task.startedAt} user={taskCreator} />
          <AgentBubble task={task} isRunning={taskIsRunning} />
          <TaskChildList projectId={task.projectId} tasks={task.children} />
          {followUps.map((followUp) => {
            const followUpCreator = followUp.createdByUserId
              ? (collaborators?.get(followUp.createdByUserId) ?? null)
              : null;

            return (
              <div key={followUp.id} className="flex flex-col gap-10">
                <UserBubble
                  text={followUp.prompt}
                  timestamp={followUp.startedAt}
                  user={followUpCreator}
                />
                <FollowUpAgentBubble followUp={followUp} />
              </div>
            );
          })}
          {pendingFollowUpPrompt ? <UserBubble text={pendingFollowUpPrompt} /> : null}
          <div ref={sentinelRef} className="h-px" />
        </div>
      </div>

      {!isAtBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          className="fixed bottom-52 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Scroll to bottom"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      ) : null}
    </>
  );
}
