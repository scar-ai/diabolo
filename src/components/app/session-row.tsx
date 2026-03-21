import { Link } from "@tanstack/react-router";
import { LoaderIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { TaskStatusBadge } from "@/components/app/task-status-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";

export type SessionRowData = {
  id: string;
  prompt: string;
  quickTask: boolean;
  repoName: string | null;
  branchName: string | null;
  stage: string;
  startedAt: Date | string;
  projectId: string;
  status: string;
};

const runningStatuses = new Set(["queued", "running"]);

export function SessionRow({
  session,
  onDelete,
  onToggleSelect,
  selected = false,
  isDeleting = false,
}: {
  session: SessionRowData;
  onDelete?: () => void;
  onToggleSelect?: () => void;
  selected?: boolean;
  isDeleting?: boolean;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isRunning = runningStatuses.has(session.status);

  return (
    <TableRow className="group">
      {onToggleSelect ? (
        <TableCell className="w-10">
          <div
            className={`transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect()}
              aria-label="Select session"
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </TableCell>
      ) : null}
      <TableCell className="max-w-0">
        <Link
          to="/app/tasks/$taskId"
          params={{ taskId: session.id }}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground group-hover:underline">
              {session.prompt.split("\n")[0]?.slice(0, 80)}
            </span>
            {session.quickTask ? (
              <Badge variant="outline" size="sm">
                Quick
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
            {session.repoName ? <span className="font-mono">{session.repoName}</span> : null}
            {session.branchName ? (
              <>
                {session.repoName ? <span>·</span> : null}
                <span className="font-mono">{session.branchName}</span>
              </>
            ) : null}
            {isRunning && session.stage ? (
              <>
                <span>·</span>
                <span className="italic">{session.stage}</span>
              </>
            ) : null}
          </div>
        </Link>
      </TableCell>
      <TableCell className="w-28">
        <TaskStatusBadge status={session.status} />
      </TableCell>
      <TableCell className="w-28">
        <span className="text-xs text-muted-foreground/60">
          {new Date(session.startedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </TableCell>
      <TableCell className="w-12 text-right">
        {onDelete ? (
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDeleteOpen(true);
              }}
              aria-label="Remove session"
            >
              {isDeleting ? (
                <LoaderIcon className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2Icon className="size-3" aria-hidden="true" />
              )}
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete session?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the session from your history. The task data cannot be recovered.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogClose
                  variant="destructive"
                  disabled={isDeleting}
                  onClick={() => onDelete()}
                >
                  {isDeleting ? (
                    <LoaderIcon className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    "Delete"
                  )}
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
