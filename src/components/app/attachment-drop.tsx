import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type AttachmentDropHandler = (files: File[]) => void;

type AttachmentDropContextValue = {
  registerHandler: (handler: AttachmentDropHandler) => () => void;
};

const AttachmentDropContext = createContext<AttachmentDropContextValue | null>(null);

export function AttachmentDropProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<AttachmentDropHandler | null>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const handleDragEnter = (event: DragEvent) => {
      if (!handlerRef.current || !hasFiles(event)) {
        return;
      }

      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!handlerRef.current || !hasFiles(event)) {
        return;
      }

      event.preventDefault();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!handlerRef.current || !hasFiles(event)) {
        return;
      }

      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);

      if (dragDepthRef.current === 0) {
        setIsDraggingFiles(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!handlerRef.current || !hasFiles(event)) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);

      const files = Array.from(event.dataTransfer?.files ?? []);

      if (files.length > 0) {
        handlerRef.current(files);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  return (
    <AttachmentDropContext.Provider
      value={{
        registerHandler: (handler) => {
          handlerRef.current = handler;

          return () => {
            if (handlerRef.current === handler) {
              handlerRef.current = null;
              dragDepthRef.current = 0;
              setIsDraggingFiles(false);
            }
          };
        },
      }}
    >
      {children}
      {isDraggingFiles ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md">
          <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border bg-card/90 px-16 py-12 text-center shadow-2xl">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted ring-1 ring-border">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-foreground"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">Drop to attach</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Images and files will be added to your prompt
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </AttachmentDropContext.Provider>
  );
}

export function useAttachmentDropRegistration(handler?: AttachmentDropHandler) {
  const context = useContext(AttachmentDropContext);

  useEffect(() => {
    if (!context || !handler) {
      return;
    }

    return context.registerHandler(handler);
  }, [context, handler]);
}
