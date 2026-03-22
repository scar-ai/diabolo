import type { RefObject } from "react";

import { AgentBubble } from "./agent-bubble";
import { FollowUpAgentBubble } from "./follow-up-agent-bubble";
import type { ParsedFollowUp, TaskData } from "./types";
import { UserBubble } from "./user-bubble";

export function TaskConversation({
  followUps,
  pendingFollowUpPrompt,
  scrollRef,
  task,
  taskIsRunning,
}: {
  followUps: ParsedFollowUp[];
  pendingFollowUpPrompt: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  task: TaskData;
  taskIsRunning: boolean;
}) {
  return (
    <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-6 pb-8">
        <UserBubble text={task.prompt} timestamp={task.startedAt} />
        <AgentBubble task={task} isRunning={taskIsRunning} />
        {followUps.map((followUp) => (
          <div key={followUp.id} className="flex flex-col gap-10">
            <UserBubble text={followUp.prompt} timestamp={followUp.startedAt} />
            <FollowUpAgentBubble followUp={followUp} />
          </div>
        ))}
        {pendingFollowUpPrompt ? <UserBubble text={pendingFollowUpPrompt} /> : null}
      </div>
    </div>
  );
}
