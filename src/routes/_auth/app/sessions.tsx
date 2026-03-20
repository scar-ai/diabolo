import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageSquareIcon,
  CheckCircle2Icon,
  LoaderIcon,
  CircleDotIcon,
  XCircleIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Frame } from "@/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { $deleteTask, $listAllUserTasks } from "@/lib/project/functions";

type TaskRow = Awaited<ReturnType<typeof $listAllUserTasks>>[number];

const statusConfig = {
  queued: {
    label: "Queued",
    icon: CircleDotIcon,
    variant: "secondary" as const,
  },
  running: {
    label: "Running",
    icon: LoaderIcon,
    variant: "info" as const,
  },
  succeeded: {
    label: "Completed",
    icon: CheckCircle2Icon,
    variant: "success" as const,
  },
  failed: {
    label: "Failed",
    icon: XCircleIcon,
    variant: "error" as const,
  },
};

export const Route = createFileRoute("/_auth/app/sessions")({
  component: SessionsPage,
});

function SessionsPage() {
  const queryClient = useQueryClient();
  const listAllUserTasks = useServerFn($listAllUserTasks);
  const deleteTask = useServerFn($deleteTask);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tasksQuery = useQuery({
    queryFn: listAllUserTasks,
    queryKey: ["all-user-tasks", listAllUserTasks],
    refetchInterval: 5_000,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      deleteTask({ data: { projectId, taskId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
      toast.success("Session removed.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove session.");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: { projectId: string; taskId: string }[]) => {
      await Promise.all(ids.map((id) => deleteTask({ data: id })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
      setSelectedIds(new Set());
      toast.success("Sessions removed.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove sessions.");
    },
  });

  const sessions = tasksQuery.data ?? [];
  const runningSessions = sessions.filter((s) => s.status === "queued" || s.status === "running");
  const completedSessions = sessions.filter(
    (s) => s.status === "succeeded" || s.status === "failed",
  );

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkDelete() {
    const toDelete = completedSessions
      .filter((s) => selectedIds.has(s.id))
      .map((s) => ({ projectId: s.projectId, taskId: s.id }));
    if (toDelete.length > 0) bulkDeleteMutation.mutate(toDelete);
  }

  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-8 pb-16">
      <div className="w-full max-w-3xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sessions.length} total · {runningSessions.length} running
          </p>
        </div>

        {sessions.length === 0 && !tasksQuery.isPending ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <MessageSquareIcon className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              No sessions yet. Start a task from the home page.
            </p>
          </div>
        ) : null}

        {/* Running tasks section */}
        {runningSessions.length > 0 ? (
          <div className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              <span className="text-sm font-semibold text-foreground">
                Running ({runningSessions.length})
              </span>
            </div>
            <Frame className="w-full min-w-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Session</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-28">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runningSessions.map((session) => (
                    <SessionRow key={session.id} session={session} />
                  ))}
                </TableBody>
              </Table>
            </Frame>
          </div>
        ) : null}

        {/* Completed tasks section */}
        {completedSessions.length > 0 ? (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                History ({completedSessions.length})
              </span>
              {selectedIds.size > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={bulkDeleteMutation.isPending}
                  onClick={handleBulkDelete}
                >
                  {bulkDeleteMutation.isPending ? (
                    <LoaderIcon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2Icon className="size-3.5" aria-hidden="true" />
                  )}
                  Delete {selectedIds.size} selected
                </Button>
              ) : null}
            </div>
            <Frame className="w-full min-w-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10" />
                    <TableHead>Session</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completedSessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      selected={selectedIds.has(session.id)}
                      onToggleSelect={() => toggleSelected(session.id)}
                      onDelete={() =>
                        deleteMutation.mutate({ projectId: session.projectId, taskId: session.id })
                      }
                      isDeleting={
                        deleteMutation.isPending && deleteMutation.variables?.taskId === session.id
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </Frame>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function SessionRow({
  session,
  onDelete,
  onToggleSelect,
  selected = false,
  isDeleting = false,
}: {
  session: TaskRow;
  onDelete?: () => void;
  onToggleSelect?: () => void;
  selected?: boolean;
  isDeleting?: boolean;
}) {
  const status = session.status as keyof typeof statusConfig;
  const config = statusConfig[status] ?? statusConfig.queued;
  const StatusIcon = config.icon;
  const isRunning = status === "running" || status === "queued";

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
              onClick={(e) => e.stopPropagation()}
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
        <Badge variant={config.variant} size="sm" className="gap-1">
          <StatusIcon className={`size-3 ${isRunning ? "animate-spin" : ""}`} aria-hidden="true" />
          {config.label}
        </Badge>
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
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Remove session"
          >
            {isDeleting ? (
              <LoaderIcon className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2Icon className="size-3" aria-hidden="true" />
            )}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
