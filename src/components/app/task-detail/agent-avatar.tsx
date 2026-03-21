import { BotIcon } from "lucide-react";

export function AgentAvatar() {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
      <BotIcon className="size-3.5 text-muted-foreground" />
    </div>
  );
}
