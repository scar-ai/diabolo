import { CornerDownLeftIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function PromptComposer({
  canSubmit,
  className,
  disabled = false,
  footerLeft,
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
  note?: ReactNode;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitAriaLabel?: string;
  value: string;
}) {
  const formId = useId();

  return (
    <div
      className={cn(
        "flex w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-border bg-muted/40",
        className,
      )}
    >
      <div className="m-1.5 mb-0 rounded-xl bg-background">
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="relative">
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
                className="max-h-[240px] border-0 bg-transparent px-4 py-3.5 text-foreground shadow-none placeholder:text-muted-foreground/40 focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
          </div>
        </form>
      </div>

      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-1.5">{footerLeft}</div>
        <button
          type="submit"
          form={formId}
          disabled={!canSubmit || disabled}
          className={`flex size-8 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-30`}
          aria-label={submitAriaLabel}
        >
          <CornerDownLeftIcon className="size-4" aria-hidden="true" />
        </button>
      </div>

      {note ? <p className="px-4 pb-2 text-xs text-muted-foreground/60">{note}</p> : null}
    </div>
  );
}

export { PromptComposer };
