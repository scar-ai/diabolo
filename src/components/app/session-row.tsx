import { Link } from "@tanstack/react-router";
import { GitBranchIcon, LoaderIcon, Trash2Icon } from "lucide-react";
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
    <TableRow className="group" data-state={selected ? "selected" : undefined}>
      {onToggleSelect ? (
        <TableCell className="w-10">
          <div
            className={`transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
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
      <TableCell className="max-w-0 py-3">
        <Link
          to="/app/tasks/$taskId"
          params={{ taskId: session.id }}
          search={{ projectId: session.projectId }}
          className="flex min-w-0 flex-col gap-1.5"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground group-hover:underline">
              {session.promptPreview}
            </span>
            {session.spawnSource === "scheduled" ? (
              <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Scheduled
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {creator ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Avatar className="size-4">
                  {creator.image ? <AvatarImage src={creator.image} alt={creator.name} /> : null}
                  <AvatarFallback className="text-[8px]">
                    {creator.name.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-24 truncate">{creator.name}</span>
              </span>
            ) : null}
            {session.repoName ? (
              <span className="min-w-0 shrink truncate font-mono text-[11px]">
                {session.repoName}
              </span>
            ) : null}
            {session.branchName ? (
              <span className="flex min-w-0 shrink items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/90">
                <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{session.branchName}</span>
              </span>
            ) : null}
            {session.stage ? (
              <span className="min-w-0 flex-1 truncate text-muted-foreground/60">
                {session.stage}
              </span>
            ) : null}
          </div>
        </Link>
      </TableCell>
      <TableCell className="w-28">
        <TaskStatusBadge status={session.status} />
      </TableCell>
      <TableCell className="w-28 text-right">
        <span className="text-xs text-muted-foreground/70 tabular-nums">
          {session.startedAtLabel}
        </span>
      </TableCell>
      {onDelete ? (
        <TableCell className="w-12 text-right">
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Button
              variant="ghost"
              size="icon-xs"
              className={`text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 ${
                deleteOpen || isDeleting ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
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
        </TableCell>
      ) : null}
    </TableRow>
  );
}
