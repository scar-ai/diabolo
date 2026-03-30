import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { HouseIcon, LoaderIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import { SessionRow } from "@/components/app/session-row";
import type { CollaboratorMap } from "@/components/app/task-detail/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  allUserTaskSummariesQueryOptions,
  projectCollaboratorsQueryOptions,
  projectsQueryOptions,
  taskKeys,
} from "@/lib/project/queries";

type SessionsSearch = {
  projectId?: string;
};

export const Route = createFileRoute("/_auth/app/sessions")({
  validateSearch: (search): SessionsSearch => ({
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData({
        ...allUserTaskSummariesQueryOptions(context.user.id),
        revalidateIfStale: true,
      }),
      context.queryClient.ensureQueryData({
        ...projectsQueryOptions(context.user.id),
        revalidateIfStale: true,
      }),
    ]);
  },
  component: SessionsPage,
});

function SessionsPage() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const deleteTask = useServerFn($deleteTask);
  const setHeaderSlots = useSetHeaderSlots();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const tasksQuery = useQuery({
    ...allUserTaskSummariesQueryOptions(user.id),
    refetchInterval: 5_000,
  });
  const projectsQuery = useQuery(projectsQueryOptions(user.id));
  const currentProject =
    (projectsQuery.data ?? []).find((project) => project.id === search.projectId) ?? null;

  const collaboratorsQuery = useQuery({
    ...projectCollaboratorsQueryOptions(search.projectId ?? ""),
    enabled: Boolean(search.projectId),
  });
  const collaboratorMap: CollaboratorMap = new Map(
    (collaboratorsQuery.data ?? []).map((c) => [c.userId, c.user]),
  );

  useEffect(() => {
    setHeaderSlots({
      left: (
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            to="/app/projects"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <HouseIcon className="size-4" />
            Home
          </Link>
          {currentProject ? (
            <>
              <span className="text-muted-foreground/40">/</span>
              <Link
                to="/app"
                search={{ projectId: currentProject.id }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {currentProject.name}
              </Link>
            </>
          ) : null}
          <span className="text-muted-foreground/40">/</span>
          <span className="font-medium text-foreground">Sessions</span>
        </nav>
      ),
      projectId: currentProject?.id ?? null,
      projectName: currentProject?.name ?? null,
      right: null,
    });
    return () => setHeaderSlots({ left: null, projectId: null, projectName: null, right: null });
  }, [currentProject, setHeaderSlots]);

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

  const sessions = search.projectId
    ? (tasksQuery.data ?? []).filter((session) => session.projectId === search.projectId)
    : (tasksQuery.data ?? []);
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
    setConfirmBulkDelete(false);
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
                    <SessionRow
                      key={session.id}
                      collaborators={collaboratorMap}
                      session={session}
                    />
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
                <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={bulkDeleteMutation.isPending}
                    onClick={() => setConfirmBulkDelete(true)}
                  >
                    {bulkDeleteMutation.isPending ? (
                      <LoaderIcon className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2Icon className="size-3.5" aria-hidden="true" />
                    )}
                    Delete {selectedIds.size} selected
                  </Button>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete {selectedIds.size} {selectedIds.size === 1 ? "session" : "sessions"}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        You are about to permanently delete {selectedIds.size}{" "}
                        {selectedIds.size === 1 ? "session" : "sessions"}. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        disabled={bulkDeleteMutation.isPending}
                        onClick={handleBulkDelete}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
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
                      collaborators={collaboratorMap}
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
