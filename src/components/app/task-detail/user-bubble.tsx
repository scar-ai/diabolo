import { ClientTimeText } from "@/components/app/client-time";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type UserInfo = {
  id: string;
  name: string;
  image: string | null;
};

export function UserBubble({
  text,
  timestamp,
  user,
}: {
  text: string;
  timestamp?: Date | string;
  user?: UserInfo | null;
}) {
  return (
    <div className="flex w-full flex-col items-end gap-1">
      {user ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground/70">{user.name}</span>
          <Avatar className="size-5 border border-border">
            {user.image ? <AvatarImage src={user.image} alt={user.name} /> : null}
            <AvatarFallback className="text-[10px]">
              {user.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      ) : null}
      <div className="w-fit max-w-[min(82%,64ch)]">
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm break-words whitespace-pre-wrap text-foreground">
          {text}
        </div>
      </div>
      {timestamp ? (
        <span className="text-[11px] text-muted-foreground/50">
          <ClientTimeText value={timestamp} options={{ hour: "2-digit", minute: "2-digit" }} />
        </span>
      ) : null}
    </div>
  );
}
