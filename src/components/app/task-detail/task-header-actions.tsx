import { LoaderIcon, SquareIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

export function TaskHeaderActions({
  destroyPending,
  onDestroy,
  onTerminate,
  sandboxAlive,
  terminatePending,
  taskIsRunning,
}: {
  destroyPending: boolean;
  onDestroy: () => void;
  onTerminate: () => void;
  sandboxAlive: boolean;
  terminatePending: boolean;
  taskIsRunning: boolean;
}) {
  return (
    <>
      {taskIsRunning ? (
        <Button variant="destructive" size="sm" disabled={terminatePending} onClick={onTerminate}>
          {terminatePending ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <SquareIcon className="size-3.5" />
          )}
          {terminatePending ? "Stopping..." : "Terminate"}
        </Button>
      ) : null}
      {sandboxAlive ? (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={destroyPending}
          onClick={onDestroy}
        >
          {destroyPending ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <Trash2Icon className="size-3.5" />
          )}
          {destroyPending ? "Destroying..." : "Destroy Sandbox"}
        </Button>
      ) : null}
    </>
  );
}
