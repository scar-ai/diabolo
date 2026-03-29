import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import {
  QuickTaskDetail,
  TaskConversation,
  TaskFollowUpComposer,
  TaskHeaderActions,
} from "@/components/app/task-detail";
import type { CollaboratorMap } from "@/components/app/task-detail/types";
import { Button } from "@/components/ui/button";
import {
  $destroyTaskSandboxById,
  $runFollowUpById,
  $terminateQuickTaskById,
  $terminateTaskById,
} from "@/lib/project/functions";
import {
  projectCollaboratorsQueryOptions,
  projectDetailQueryOptions,
  type TaskDetailResult,
  taskDetailQueryOptions,
  taskKeys,
} from "@/lib/project/queries";
import { useTaskStream } from "@/lib/project/use-task-stream";

const TERMINAL_STATUSES = new Set(["failed", "succeeded"]);

export const Route = createFileRoute("/_auth/app/tasks/$taskId")({
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData({
      ...taskDetailQueryOptions(params.taskId),
      revalidateIfStale: true,
    });
  },
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { taskId } = Route.useParams();
  const queryClient = useQueryClient();
  const terminateTask = useServerFn($terminateTaskById);
  const terminateQuickTask = useServerFn($terminateQuickTaskById);
  const destroySandbox = useServerFn($destroyTaskSandboxById);
  const runFollowUp = useServerFn($runFollowUpById);
  const setHeaderSlots = useSetHeaderSlots();

  const [followUpInput, setFollowUpInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskQuery = useQuery({
    ...taskDetailQueryOptions(taskId),
    refetchInterval: (query) => {
      const data = query.state.data as TaskDetailResult | undefined;
      if (!data || TERMINAL_STATUSES.has(data.status)) return false;
      return 2_000;
    },
  });

  const terminateMutation = useMutation({
    mutationFn: () => terminateTask({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Task terminated.");
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to terminate task.");
    },
  });

  const destroyMutation = useMutation({
    mutationFn: () => destroySandbox({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Sandbox destroyed.");
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to destroy sandbox.");
    },
  });

  const terminateQuickTaskMutation = useMutation({
    mutationFn: () => terminateQuickTask({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Quick task stopped and sandbox destroyed.");
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop quick task.");
    },
  });

  const followUpMutation = useMutation({
    mutationFn: (prompt: string) => runFollowUp({ data: { taskId, prompt } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start follow-up.");
    },
  });

  const task = taskQuery.data as TaskDetailResult | undefined;
  const projectQuery = useQuery({
    ...projectDetailQueryOptions(task?.projectId ?? ""),
    enabled: Boolean(task?.projectId),
  });
  const collaboratorsQuery = useQuery({
    ...projectCollaboratorsQueryOptions(task?.projectId ?? ""),
    enabled: Boolean(task?.projectId),
  });
  const collaboratorMap: CollaboratorMap = new Map(
    (collaboratorsQuery.data ?? []).map((c) => [c.userId, c.user]),
  );
  useTaskStream(taskId, true);
  const isRunning = task && !TERMINAL_STATUSES.has(task.status);
  const isCompleted = task && TERMINAL_STATUSES.has(task.status);
  const sandboxAlive = isCompleted && task.sandboxId;
  const isQuickTask = task?.quickTask === true;
  const taskTitle = task?.title ?? task?.repoName ?? "Task";
  const projectName = projectQuery.data?.name ?? null;
  const canSendFollowUp = Boolean(
    isCompleted && !isQuickTask && followUpInput.trim().length >= 10 && !followUpMutation.isPending,
  );

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (distanceFromBottom < 120) {
      scrollToBottom();
    }
  }, [
    task?.logs,
    task?.stage,
    task?.status,
    task?.parsedFollowUpHistory,
    task?.children,
    scrollToBottom,
  ]);

  const terminatePending = terminateMutation.isPending;
  const terminateMutate = terminateMutation.mutate;
  const destroyPending = destroyMutation.isPending;
  const destroyMutate = destroyMutation.mutate;

  useEffect(() => {
    setHeaderSlots({
      left: taskTitle ? (
        <span className="truncate text-sm font-medium text-foreground">{taskTitle}</span>
      ) : null,
      projectId: task?.projectId ?? null,
      projectName,
      right: (
        <>
          <Button
            render={<Link to="/app/projects" search={{}} />}
            variant="ghost"
            size="sm"
            nativeButton={false}
          >
            Back to home screen
          </Button>
          <TaskHeaderActions
            destroyPending={destroyPending}
            onDestroy={() => destroyMutate()}
            onTerminate={() => terminateMutate()}
            sandboxAlive={!!sandboxAlive}
            taskIsRunning={!!isRunning}
            terminatePending={terminatePending}
          />
        </>
      ),
    });
    return () => setHeaderSlots({ left: null, projectId: null, projectName: null, right: null });
  }, [
    task?.projectId,
    task?.id,
    taskTitle,
    projectName,
    isRunning,
    sandboxAlive,
    terminatePending,
    terminateMutate,
    destroyPending,
    destroyMutate,
    setHeaderSlots,
  ]);

  const handleSendFollowUp = () => {
    if (!canSendFollowUp) return;
    const prompt = followUpInput.trim();
    setFollowUpInput("");
    followUpMutation.mutate(prompt);
  };

  if (!task && taskQuery.isPending) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center">
        <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!task) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">Task not found.</p>
        <Button render={<Link to="/app" />} variant="outline" size="sm" nativeButton={false}>
          Back to home
        </Button>
      </main>
    );
  }

  const followUps = task.parsedFollowUpHistory;
  const pendingFollowUpPrompt =
    followUpMutation.isPending &&
    followUpMutation.variables &&
    followUps.at(-1)?.prompt !== followUpMutation.variables
      ? followUpMutation.variables
      : null;

  if (isQuickTask) {
    return (
      <QuickTaskDetail
        isStopping={terminateQuickTaskMutation.isPending}
        onStop={() => terminateQuickTaskMutation.mutate()}
        task={task}
      />
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <TaskConversation
        collaborators={collaboratorMap}
        followUps={followUps}
        pendingFollowUpPrompt={pendingFollowUpPrompt}
        scrollRef={scrollRef}
        task={task}
        taskIsRunning={!!isRunning}
      />

      {isCompleted || isRunning ? (
        <TaskFollowUpComposer
          canSubmit={canSendFollowUp}
          disabled={Boolean(isRunning && !sandboxAlive)}
          isPending={followUpMutation.isPending}
          onChange={setFollowUpInput}
          onSubmit={handleSendFollowUp}
          task={task}
          value={followUpInput}
        />
      ) : null}
    </main>
  );
}
