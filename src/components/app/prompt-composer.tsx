import { CornerDownLeftIcon, PaperclipIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useRef } from "react";

import { useAttachmentDropRegistration } from "@/components/app/attachment-drop";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function PromptComposer({
  attachments,
  canSubmit,
  className,
  disabled = false,
  footerLeft,
  footerRight,
  headerContent,
  onAddAttachments,
  note,
  onChange,
  onRemoveAttachment,
  onSubmit,
  placeholder,
  submitAriaLabel = "Send",
  value,
}: {
  attachments?: Array<{ id: string; name: string; sizeLabel?: string }>;
  canSubmit: boolean;
  className?: string;
  disabled?: boolean;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  headerContent?: ReactNode;
  onAddAttachments?: (files: File[]) => void;
  note?: ReactNode;
  onChange: (value: string) => void;
  onRemoveAttachment?: (id: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitAriaLabel?: string;
  value: string;
}) {
  const formId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  useAttachmentDropRegistration(!disabled ? onAddAttachments : undefined);

  return (
    <div className={cn("flex w-full max-w-3xl flex-col", className)}>
      {headerContent ? (
        <div className="relative z-0 -mb-3.5 overflow-hidden rounded-xl rounded-b-none border border-emerald-500/30 bg-emerald-50 px-3 pt-2 pb-5 dark:bg-emerald-950">
          {headerContent}
        </div>
      ) : null}

      {attachments?.length ? (
        <div className="mb-3 flex flex-wrap gap-2 px-1">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-xs shadow-xs"
            >
              <PaperclipIcon className="size-3" aria-hidden="true" />
              <span className="max-w-48 truncate">{attachment.name}</span>
              {attachment.sizeLabel ? (
                <span className="text-muted-foreground/70">{attachment.sizeLabel}</span>
              ) : null}
              {onRemoveAttachment ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemoveAttachment(attachment.id)}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
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
          {onAddAttachments ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);

                  if (files.length > 0) {
                    onAddAttachments(files);
                  }

                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
                className="mr-auto flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Attach files"
              >
                <PaperclipIcon className="size-3.5" aria-hidden="true" />
              </button>
            </>
          ) : null}
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
      {footerLeft || footerRight || note ? (
        <div className="dock-tray relative z-0 -mt-3.5 overflow-hidden rounded-xl rounded-t-none border border-border px-3 pt-5 pb-2">
          {footerLeft || footerRight ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">{footerLeft}</div>
              {footerRight ? <div className="shrink-0">{footerRight}</div> : null}
            </div>
          ) : null}
          {note ? <p className="mt-1 text-xs text-muted-foreground/60">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export { PromptComposer };
