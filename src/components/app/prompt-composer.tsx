import { CornerDownLeftIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function PromptComposer({
  canSubmit,
  className,
  disabled = false,
  footerLeft,
  headerContent,
  note,
  onChange,
  onSubmit,
  placeholder,
  submitAriaLabel = "Send",
  value,
}: {
  canSubmit: boolean;
  className?: string;
  disabled?: boolean;
  footerLeft?: ReactNode;
  headerContent?: ReactNode;
  note?: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitAriaLabel?: string;
  value: string;
}) {
  const formId = useId();

  return (
    <div className={cn("flex w-full max-w-3xl flex-col", className)}>
      {headerContent ? (
        <div className="relative z-0 -mb-3.5 overflow-hidden rounded-xl rounded-b-none border border-emerald-500/30 bg-emerald-50 px-3 pt-2 pb-5 dark:bg-emerald-950">
          {headerContent}
        </div>
      ) : null}

      {/* Shell — uses box-shadow for border so it overlaps tray cleanly */}
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="dock-shell relative z-10 overflow-hidden rounded-xl"
      >
        <div className="max-h-[240px] overflow-y-auto">
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              if (!canSubmit || disabled) return;
              event.preventDefault();
              onSubmit();
            }}
            placeholder={placeholder}
            disabled={disabled}
            className="min-h-12 resize-none border-0 bg-transparent px-4 py-3 text-sm text-foreground shadow-none ring-0 placeholder:text-muted-foreground/40 focus-visible:border-0 focus-visible:ring-0"
          />
        </div>
        <div className="flex items-center justify-end px-3 pb-2">
          <button
            type="submit"
            disabled={!canSubmit || disabled}
            className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-30"
            aria-label={submitAriaLabel}
          >
            <CornerDownLeftIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </form>

      {/* Tray — sits behind the shell with negative top margin */}
      {footerLeft || note ? (
        <div className="dock-tray relative z-0 -mt-3.5 overflow-hidden rounded-xl rounded-t-none border border-border px-3 pt-5 pb-2">
          {footerLeft ? <div className="flex items-center gap-1.5">{footerLeft}</div> : null}
          {note ? <p className="mt-1 text-xs text-muted-foreground/60">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export { PromptComposer };
