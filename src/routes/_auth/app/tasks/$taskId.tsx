import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LoaderIcon } from "lucide-react";
import { HouseIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import {
  TaskConversation,
  TaskFollowUpComposer,
  TaskHeaderActions,
} from "@/components/app/task-detail";
import type { CollaboratorMap } from "@/components/app/task-detail/types";
import { Button } from "@/components/ui/button";
import { $destroyTaskSandboxById, $terminateTaskById } from "@/lib/project/functions";
import {
  projectCollaboratorsQueryOptions,
  projectDetailQueryOptions,
  type TaskDetailResult,
  taskDetailQueryOptions,
  taskKeys,
} from "@/lib/project/queries";
import { useTaskStream } from "@/lib/project/use-task-stream";

const TERMINAL_STATUSES = new Set(["failed", "succeeded"]);

type PendingAttachment = {
  file: File;
  id: string;
};

const formatAttachmentSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
  const destroySandbox = useServerFn($destroyTaskSandboxById);
  const setHeaderSlots = useSetHeaderSlots();

  const [followUpInput, setFollowUpInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
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

  const followUpMutation = useMutation({
    mutationFn: async (data: { attachments: File[]; prompt: string }) => {
      const formData = new FormData();
      formData.set("prompt", data.prompt);

      for (const file of data.attachments) {
        formData.append("attachments", file);
      }

      const response = await fetch(`/api/tasks/${taskId}/follow-up`, {
        body: formData,
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "Failed to start follow-up.",
        );
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      setAttachments([]);
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
  const taskTitle = task?.title ?? task?.repoName ?? "Task";
  const projectName = projectQuery.data?.name ?? null;
  const canSendFollowUp = Boolean(
    isCompleted && followUpInput.trim().length >= 10 && !followUpMutation.isPending,
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
      left: (
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            to="/app/projects"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <HouseIcon className="size-4" />
            Home
          </Link>
          {projectName ? (
            <>
              <span className="text-muted-foreground/40">/</span>
              <Link
                to="/app"
                search={{ projectId: task?.projectId }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {projectName}
              </Link>
            </>
          ) : null}
          {taskTitle ? (
            <>
              <span className="text-muted-foreground/40">/</span>
              <span className="max-w-48 truncate font-medium text-foreground">{taskTitle}</span>
            </>
          ) : null}
        </nav>
      ),
      projectId: task?.projectId ?? null,
      projectName,
      right: (
        <TaskHeaderActions
          destroyPending={destroyPending}
          onDestroy={() => destroyMutate()}
          onTerminate={() => terminateMutate()}
          sandboxAlive={!!sandboxAlive}
          taskIsRunning={!!isRunning}
          terminatePending={terminatePending}
        />
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
    followUpMutation.mutate({
      attachments: attachments.map((attachment) => attachment.file),
      prompt,
    });
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
    followUps.at(-1)?.prompt !== followUpMutation.variables.prompt
      ? followUpMutation.variables.prompt
      : null;

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
          attachments={attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.file.name,
            sizeLabel: formatAttachmentSize(attachment.file.size),
          }))}
          canSubmit={canSendFollowUp}
          disabled={Boolean(isRunning && !sandboxAlive)}
          isPending={followUpMutation.isPending}
          onAddAttachments={(files) => {
            setAttachments((current) => [
              ...current,
              ...Array.from(files).map((file) => ({
                file,
                id: crypto.randomUUID(),
              })),
            ]);
          }}
          onChange={setFollowUpInput}
          onRemoveAttachment={(id) =>
            setAttachments((current) => current.filter((attachment) => attachment.id !== id))
          }
          onSubmit={handleSendFollowUp}
          task={task}
          value={followUpInput}
        />
      ) : null}
    </main>
  );
}
