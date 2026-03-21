import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function UserBubble({
  text,
  userName,
  userImage,
  initials,
  timestamp,
}: {
  text: string;
  userName?: string | null;
  userImage?: string | null;
  initials: string;
  timestamp?: Date | string;
}) {
  return (
    <div className="flex max-w-[85%] flex-row-reverse items-start gap-3 self-end">
      <Avatar className="size-7 shrink-0 border border-border">
        {userImage ? <AvatarImage src={userImage} alt={userName ?? ""} /> : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col items-end gap-1">
        <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
        </div>
        {timestamp ? (
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
