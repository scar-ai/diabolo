import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarClockIcon,
  Clock3Icon,
  CpuIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ScheduledTaskDialog,
  type ScheduledTaskDialogInput,
} from "@/components/app/scheduled-task-dialog";
import { TaskStatusBadge } from "@/components/app/task-status-badge";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Frame } from "@/components/ui/frame";
import { githubBranchesQueryOptions } from "@/lib/github/queries";
import {
  $createScheduledTask,
  $deleteScheduledTask,
  $updateScheduledTask,
} from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectScheduledTasksQueryOptions,
  scheduledTaskKeys,
  serverTimeQueryOptions,
  type TaskSummaryResult,
} from "@/lib/project/queries";
import { describeSchedule } from "@/lib/project/scheduled-tasks";

export function ScheduledTasksSection({
  projectDefaultBranch,
  projectId,
  providers,
  repoFullName,
  userId,
}: {
  projectDefaultBranch: string;
  projectId: string;
  providers: Array<{
    id: string;
    isDefault: boolean;
    name: string;
    providerId: string;
    providerModel: string;
    scope?: string;
  }>;
  repoFullName: string | null;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const createScheduledTask = useServerFn($createScheduledTask);
  const updateScheduledTask = useServerFn($updateScheduledTask);
  const deleteScheduledTask = useServerFn($deleteScheduledTask);

  const [scheduledTaskDialogOpen, setScheduledTaskDialogOpen] = useState(false);
  const [editingScheduledTaskId, setEditingScheduledTaskId] = useState<string | null>(null);
  const [deletingScheduledTaskId, setDeletingScheduledTaskId] = useState<string | null>(null);

  const scheduledTasksQuery = useQuery({
    ...projectScheduledTasksQueryOptions(projectId),
    enabled: Boolean(projectId),
  });
  const serverTimeQuery = useQuery({
    ...serverTimeQueryOptions(),
    refetchInterval: 30_000,
  });
  const branchesQuery = useQuery({
    ...githubBranchesQueryOptions(userId, repoFullName ?? ""),
    enabled: Boolean(repoFullName),
  });
  // Re-use cached task summaries to compute latest scheduled runs
  const tasksQuery = useQuery({
    ...allUserTaskSummariesQueryOptions(userId),
    refetchInterval: (query) => {
      const tasks = (query.state.data ?? []) as TaskSummaryResult[];
      return tasks.some(
        (t) => t.status === "queued" || t.status === "running" || t.hasActiveChildren,
      )
        ? 5_000
        : 30_000;
    },
  });

  const scheduledTasks = scheduledTasksQuery.data ?? [];
  const allTasks = tasksQuery.data ?? [];
  const projectTasks = allTasks.filter((t) => t.projectId === projectId);
  const defaultProviderId =
    providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? null;

  const latestScheduledRuns = new Map<string, (typeof projectTasks)[number]>();
  for (const task of projectTasks) {
    if (!task.scheduledTaskId || latestScheduledRuns.has(task.scheduledTaskId)) continue;
    latestScheduledRuns.set(task.scheduledTaskId, task);
  }

  const serverTimeLabel = serverTimeQuery.data?.iso
    ? new Date(serverTimeQuery.data.iso).toLocaleString("en-US", {
        day: "numeric",
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        month: "short",
        second: "2-digit",
        year: "numeric",
      })
    : null;

  const editingScheduledTask =
    editingScheduledTaskId === null
      ? null
      : (scheduledTasks.find((st) => st.id === editingScheduledTaskId) ?? null);
  const dialogMode = editingScheduledTask ? "edit" : "create";

  const createScheduledTaskMutation = useMutation({
    mutationFn: async (input: ScheduledTaskDialogInput) =>
      createScheduledTask({ data: { ...input, projectId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scheduledTaskKeys.list(projectId) });
      setScheduledTaskDialogOpen(false);
      toast.success("Scheduled task created.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create scheduled task.");
    },
  });

  const updateScheduledTaskMutation = useMutation({
    mutationFn: async (input: ScheduledTaskDialogInput & { scheduledTaskId: string }) =>
      updateScheduledTask({ data: { ...input, projectId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scheduledTaskKeys.list(projectId) });
      setEditingScheduledTaskId(null);
      setScheduledTaskDialogOpen(false);
      toast.success("Scheduled task updated.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update scheduled task.");
    },
  });

  const deleteScheduledTaskMutation = useMutation({
    mutationFn: async (scheduledTaskId: string) =>
      deleteScheduledTask({ data: { projectId, scheduledTaskId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scheduledTaskKeys.list(projectId) });
      setDeletingScheduledTaskId(null);
      toast.success("Scheduled task deleted.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete scheduled task.");
    },
  });

  const dialogPending =
    createScheduledTaskMutation.isPending || updateScheduledTaskMutation.isPending;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">Scheduled tasks</span>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditingScheduledTaskId(null);
            setScheduledTaskDialogOpen(true);
          }}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          New scheduled task
        </Button>
      </div>

      <Frame className="w-full min-w-0">
        <div className="divide-y divide-border/60">
          {scheduledTasks.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No scheduled tasks yet. Create one to automate repeatable work on this project.
            </div>
          ) : (
            scheduledTasks.map((scheduledTask) => {
              const latestRun = latestScheduledRuns.get(scheduledTask.id);
              const provider =
                providers.find((entry) => entry.id === scheduledTask.providerId) ??
                providers.find((entry) => entry.id === defaultProviderId) ??
                null;

              return (
                <div
                  key={scheduledTask.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {scheduledTask.name}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {scheduledTask.runOnce ? (
                        <Badge variant="secondary" size="sm">
                          Run once
                        </Badge>
                      ) : (
                        <Badge variant="outline" size="sm">
                          Recurring
                        </Badge>
                      )}
                      {!scheduledTask.enabled ? (
                        <Badge variant="warning" size="sm">
                          Disabled
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {describeSchedule(scheduledTask.scheduleCron)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {scheduledTask.scheduleTimezone}
                      {" · "}
                      {scheduledTask.branchName ?? `Project default (${projectDefaultBranch})`}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CpuIcon className="size-3" aria-hidden="true" />
                      <span>
                        {provider
                          ? `${provider.name} · ${provider.providerId}/${provider.providerModel}`
                          : "Selected provider unavailable"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/80">
                      <Clock3Icon className="size-3" aria-hidden="true" />
                      <span>Server time: {serverTimeLabel ?? "loading..."}</span>
                    </div>
                    <div className="mt-2">
                      {latestRun ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>Latest run</span>
                          <TaskStatusBadge status={latestRun.status} />
                          <Link
                            to="/app/tasks/$taskId"
                            params={{ taskId: latestRun.id }}
                            search={{ projectId }}
                            className="text-foreground underline-offset-4 hover:underline"
                          >
                            View session
                          </Link>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          No session started from this schedule yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex max-w-md items-start gap-3">
                    <div className="min-w-0 text-sm text-muted-foreground">
                      {scheduledTask.instructions}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          setEditingScheduledTaskId(scheduledTask.id);
                          setScheduledTaskDialogOpen(true);
                        }}
                        aria-label="Edit scheduled task"
                      >
                        <PencilIcon className="size-3" aria-hidden="true" />
                      </Button>
                      <AlertDialog
                        open={deletingScheduledTaskId === scheduledTask.id}
                        onOpenChange={(open) =>
                          setDeletingScheduledTaskId(open ? scheduledTask.id : null)
                        }
                      >
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                          disabled={deleteScheduledTaskMutation.isPending}
                          onClick={() => setDeletingScheduledTaskId(scheduledTask.id)}
                          aria-label="Delete scheduled task"
                        >
                          {deleteScheduledTaskMutation.isPending &&
                          deleteScheduledTaskMutation.variables === scheduledTask.id ? (
                            <LoaderIcon className="size-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2Icon className="size-3" aria-hidden="true" />
                          )}
                        </Button>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete scheduled task?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove "{scheduledTask.name}".
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={deleteScheduledTaskMutation.isPending}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              disabled={deleteScheduledTaskMutation.isPending}
                              onClick={() => deleteScheduledTaskMutation.mutate(scheduledTask.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Frame>

      <ScheduledTaskDialog
        key={`${dialogMode}:${editingScheduledTask?.id ?? "new"}:${scheduledTaskDialogOpen ? "open" : "closed"}`}
        branches={(branchesQuery.data ?? []).map((b) => b.name)}
        defaultBranch={projectDefaultBranch}
        defaultProviderId={defaultProviderId}
        initialValue={
          editingScheduledTask
            ? {
                ...editingScheduledTask,
                branchName: editingScheduledTask.branchName ?? null,
                providerId: editingScheduledTask.providerId ?? null,
                runOnce: Boolean(editingScheduledTask.runOnce),
              }
            : null
        }
        isPending={dialogPending}
        mode={dialogMode}
        onOpenChange={(open) => {
          setScheduledTaskDialogOpen(open);
          if (!open) setEditingScheduledTaskId(null);
        }}
        onSubmit={(input) => {
          if (editingScheduledTask) {
            updateScheduledTaskMutation.mutate({
              ...input,
              scheduledTaskId: editingScheduledTask.id,
            });
          } else {
            createScheduledTaskMutation.mutate(input);
          }
        }}
        open={scheduledTaskDialogOpen}
        providers={providers}
      />
    </div>
  );
}
