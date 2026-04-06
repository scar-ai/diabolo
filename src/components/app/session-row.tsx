import { Link } from "@tanstack/react-router";
import { LoaderIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { CollaboratorMap } from "@/components/app/task-detail/types";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import type { TaskSummaryResult } from "@/lib/project/queries";

export type SessionRowData = TaskSummaryResult;

export function SessionRow({
  collaborators,
  session,
  onDelete,
  onToggleSelect,
  selected = false,
  isDeleting = false,
}: {
  collaborators?: CollaboratorMap;
  session: SessionRowData;
  onDelete?: () => void;
  onToggleSelect?: () => void;
  selected?: boolean;
  isDeleting?: boolean;
}) {
  const creator =
    session.createdByUserId && collaborators
      ? (collaborators.get(session.createdByUserId) ?? null)
      : null;
  const [deleteOpen, setDeleteOpen] = useState(false);

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
          search={{ projectId: session.projectId }}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground group-hover:underline">
              {session.promptPreview}
            </span>
            {session.spawnSource === "scheduled" ? (
              <span className="rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Scheduled
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
            {session.sessionSummaryLine ? <span>{session.sessionSummaryLine}</span> : null}
            {creator ? (
              <span className="flex items-center gap-1">
                <span>·</span>
                <Avatar className="size-3.5">
                  {creator.image ? <AvatarImage src={creator.image} alt={creator.name} /> : null}
                  <AvatarFallback className="text-[8px]">
                    {creator.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span>{creator.name}</span>
              </span>
            ) : null}
          </div>
        </Link>
      </TableCell>
      <TableCell className="w-28">
        <TaskStatusBadge status={session.status} />
      </TableCell>
      <TableCell className="w-28">
        <span className="text-xs text-muted-foreground/60">{session.startedAtLabel}</span>
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
