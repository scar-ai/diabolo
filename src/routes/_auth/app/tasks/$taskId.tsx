import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BookMarkedIcon,
  ChevronDownIcon,
  GitBranchIcon,
  LoaderIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PromptComposer } from "@/components/app/prompt-composer";
import {
  AgentBubble,
  FollowUpAgentBubble,
  parseFollowUpHistory,
  QuickTaskDetail,
  UserBubble,
} from "@/components/app/task-detail";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  $destroyTaskSandboxById,
  $runFollowUpById,
  $terminateQuickTaskById,
  $terminateTaskById,
} from "@/lib/project/functions";
import { taskDetailQueryOptions } from "@/lib/project/queries";

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

  const [followUpInput, setFollowUpInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskQuery = useQuery({
    ...taskDetailQueryOptions(taskId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || TERMINAL_STATUSES.has(data.status)) return false;
      return 2_000;
    },
  });

  const terminateMutation = useMutation({
    mutationFn: () => terminateTask({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Task terminated.");
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to terminate task.");
    },
  });

  const destroyMutation = useMutation({
    mutationFn: () => destroySandbox({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Sandbox destroyed.");
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to destroy sandbox.");
    },
  });

  const terminateQuickTaskMutation = useMutation({
    mutationFn: () => terminateQuickTask({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Quick task stopped and sandbox destroyed.");
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop quick task.");
    },
  });

  const followUpMutation = useMutation({
    mutationFn: (prompt: string) => runFollowUp({ data: { taskId, prompt } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start follow-up.");
    },
  });

  const task = taskQuery.data;
  const isRunning = task && !TERMINAL_STATUSES.has(task.status);
  const isCompleted = task && TERMINAL_STATUSES.has(task.status);
  const sandboxAlive = isCompleted && task.sandboxId;
  const isQuickTask = task?.quickTask === true;
  const canSendFollowUp = Boolean(
    isCompleted && !isQuickTask && followUpInput.trim().length >= 10 && !followUpMutation.isPending,
  );

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [task?.logs, task?.stage, task?.status, task?.followUpHistory, scrollToBottom]);

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

  const followUps = parseFollowUpHistory(task.followUpHistory);
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
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 py-2.5">
        <span className="truncate text-sm font-medium text-foreground">
          {task.repoName ?? "Task"}
        </span>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={terminateMutation.isPending}
              onClick={() => terminateMutation.mutate()}
            >
              {terminateMutation.isPending ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <SquareIcon className="size-3.5" />
              )}
              {terminateMutation.isPending ? "Stopping..." : "Terminate"}
            </Button>
          ) : null}
          {sandboxAlive ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={destroyMutation.isPending}
              onClick={() => destroyMutation.mutate()}
            >
              {destroyMutation.isPending ? (
                <LoaderIcon className="size-3.5 animate-spin" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
              {destroyMutation.isPending ? "Destroying..." : "Destroy Sandbox"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Chat messages area */}
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-6 pb-8">
          {/* Initial user message */}
          <UserBubble text={task.prompt} timestamp={task.startedAt} />

          {/* Agent response */}
          <AgentBubble task={task} isRunning={!!isRunning} />

          {/* Follow-up messages */}
          {followUps.map((followUp) => (
            <div key={followUp.id} className="flex flex-col gap-10">
              <UserBubble text={followUp.prompt} timestamp={followUp.startedAt} />
              <FollowUpAgentBubble followUp={followUp} />
            </div>
          ))}

          {pendingFollowUpPrompt ? <UserBubble text={pendingFollowUpPrompt} /> : null}
        </div>
      </div>

      {/* Sticky prompt at the bottom */}
      {isCompleted || isRunning ? (
        <div className="shrink-0 bg-background px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <PromptComposer
              value={followUpInput}
              onChange={setFollowUpInput}
              onSubmit={handleSendFollowUp}
              placeholder={
                isRunning && !sandboxAlive
                  ? "Waiting for task to finish..."
                  : sandboxAlive
                    ? "Send a follow-up..."
                    : "Send a follow-up to restart the sandbox..."
              }
              canSubmit={canSendFollowUp}
              disabled={isRunning && !sandboxAlive}
              submitAriaLabel={followUpMutation.isPending ? "Sending..." : "Send"}
              footerLeft={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    className="cursor-not-allowed gap-1 text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40"
                  >
                    <BookMarkedIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="max-w-[160px] truncate">{task.repoName ?? "Project"}</span>
                    <ChevronDownIcon className="size-3 shrink-0 opacity-30" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    className="cursor-not-allowed gap-1 text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40"
                  >
                    <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="max-w-[160px] truncate">
                      {task.branchName ?? "Used branch"}
                    </span>
                    <ChevronDownIcon className="size-3 shrink-0 opacity-30" aria-hidden="true" />
                  </Button>
                  <button
                    type="button"
                    disabled
                    aria-pressed={!!task.quickTask}
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground/40 transition-colors hover:bg-transparent hover:text-muted-foreground/40"
                  >
                    <Checkbox
                      checked={!!task.quickTask}
                      disabled
                      aria-label="Quick task mode"
                      className="pointer-events-none size-3.5"
                    />
                    <span>Quick task</span>
                  </button>
                </>
              }
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
