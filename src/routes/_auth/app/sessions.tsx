import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LoaderIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SessionRow } from "@/components/app/session-row";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Frame } from "@/components/ui/frame";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { $deleteTask } from "@/lib/project/functions";
import { allUserTaskSummariesQueryOptions, taskKeys } from "@/lib/project/queries";

export const Route = createFileRoute("/_auth/app/sessions")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      ...allUserTaskSummariesQueryOptions(context.user.id),
      revalidateIfStale: true,
    });
  },
  component: SessionsPage,
});

function SessionsPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const deleteTask = useServerFn($deleteTask);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const tasksQuery = useQuery({
    ...allUserTaskSummariesQueryOptions(user.id),
    refetchInterval: 5_000,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      deleteTask({ data: { projectId, taskId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
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
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
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
        {sessions.length === 0 && !tasksQuery.isPending ? (
          <Empty className="min-h-[48vh] border-0 bg-transparent py-16">
            <EmptyContent>
              <EmptyHeader>
                <EmptyMedia variant="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M7 9.5A4.5 4.5 0 0 1 11.5 5h2.75A2.75 2.75 0 0 1 17 7.75V10"
                      className="stroke-current"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6.5 19.5H4.75A1.75 1.75 0 0 1 3 17.75V9.25A1.75 1.75 0 0 1 4.75 7.5h9.5A1.75 1.75 0 0 1 16 9.25V11"
                      className="stroke-current"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14.5 14.25 20 10.75v6.5l-5.5-3Z"
                      className="stroke-current"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8 12h4"
                      className="stroke-current"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                    <path
                      d="M8 14.5h2.5"
                      className="stroke-current"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </EmptyMedia>
                <EmptyTitle>Nothing to see here.</EmptyTitle>
              </EmptyHeader>
              <EmptyDescription>
                Get back to work. The session graveyard is empty for now.
              </EmptyDescription>
            </EmptyContent>
          </Empty>
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
