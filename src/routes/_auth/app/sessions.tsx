import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LoaderIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Frame } from "@/components/ui/frame";
import { Input } from "@/components/ui/input";
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [query, setQuery] = useState("");

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

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (session: (typeof sessions)[number]) => {
    if (!normalizedQuery) return true;
    return [session.promptPreview, session.repoName, session.branchName, session.stage].some(
      (field) => field?.toLowerCase().includes(normalizedQuery),
    );
  };

  const matchingSessions = sessions.filter(matchesQuery);
  const runningSessions = matchingSessions.filter(
    (s) => s.status === "queued" || s.status === "running",
  );
  const completedSessions = matchingSessions.filter(
    (s) => s.status === "succeeded" || s.status === "failed",
  );
  const selectedVisibleIds = completedSessions.filter((s) => selectedIds.has(s.id));

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected =
    completedSessions.length > 0 && completedSessions.every((s) => selectedIds.has(s.id));

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(completedSessions.map((s) => s.id)));
  }

  function handleBulkDelete() {
    const toDelete = selectedVisibleIds.map((s) => ({ projectId: s.projectId, taskId: s.id }));
    if (toDelete.length > 0) bulkDeleteMutation.mutate(toDelete);
    setConfirmBulkDelete(false);
  }

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-border/60 px-6">
        <h1 className="text-base font-medium text-foreground">
          Sessions
          {currentProject ? (
            <span className="ml-1.5 text-muted-foreground/60">— {currentProject.name}</span>
          ) : null}
        </h1>
        <div className="relative ml-auto w-full max-w-64">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
            className="h-8 ps-8 pe-8 text-sm"
          />
          {query ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <XIcon className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-4 pt-8 pb-16">
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

          {sessions.length > 0 && matchingSessions.length === 0 ? (
            <Empty className="min-h-[48vh] border-0 bg-transparent py-16">
              <EmptyContent>
                <EmptyHeader>
                  <EmptyMedia variant="icon" aria-hidden="true">
                    <SearchIcon />
                  </EmptyMedia>
                  <EmptyTitle>No matching sessions</EmptyTitle>
                </EmptyHeader>
                <EmptyDescription>
                  Nothing matches “{query.trim()}”. Try a different repo, branch, or title.
                </EmptyDescription>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}

          {/* Running tasks section */}
          {runningSessions.length > 0 ? (
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Running
                </span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {runningSessions.length}
                </span>
              </div>
              <Frame className="w-full min-w-0">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs">Session</TableHead>
                      <TableHead className="w-28 text-xs">Status</TableHead>
                      <TableHead className="w-28 text-right text-xs">Started</TableHead>
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
              <div className="mb-3 flex h-8 items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    History
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                    {completedSessions.length}
                  </span>
                </div>
                {selectedVisibleIds.length > 0 ? (
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
                      Delete {selectedVisibleIds.length} selected
                    </Button>
                    <AlertDialogContent size="sm">
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete {selectedVisibleIds.length}{" "}
                          {selectedVisibleIds.length === 1 ? "session" : "sessions"}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          You are about to permanently delete {selectedVisibleIds.length}{" "}
                          {selectedVisibleIds.length === 1 ? "session" : "sessions"}. This cannot be
                          undone.
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
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          indeterminate={selectedVisibleIds.length > 0 && !allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all sessions"
                        />
                      </TableHead>
                      <TableHead className="text-xs">Session</TableHead>
                      <TableHead className="w-28 text-xs">Status</TableHead>
                      <TableHead className="w-28 text-right text-xs">Date</TableHead>
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
                          deleteMutation.mutate({
                            projectId: session.projectId,
                            taskId: session.id,
                          })
                        }
                        isDeleting={
                          deleteMutation.isPending &&
                          deleteMutation.variables?.taskId === session.id
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
    </>
  );
}
