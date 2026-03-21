export function UserBubble({
  text,
  timestamp,
}: {
  text: string;
  userName?: string | null;
  userImage?: string | null;
  initials?: string;
  timestamp?: Date | string;
}) {
  return (
    <div className="flex w-full flex-col items-end">
      <div className="w-fit max-w-[min(82%,64ch)]">
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm break-words whitespace-pre-wrap text-foreground">
          {text}
        </div>
      </div>
      {timestamp ? (
        <span className="mt-1 text-[11px] text-muted-foreground/50">
          {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : null}
    </div>
  );
}
