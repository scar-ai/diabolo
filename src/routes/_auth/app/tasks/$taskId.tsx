import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeftIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  LoaderIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  $destroyTaskSandboxById,
  $getTaskById,
  $runFollowUpById,
  $terminateTaskById,
} from "@/lib/project/functions";

const TERMINAL_STATUSES = new Set(["failed", "succeeded"]);

export const Route = createFileRoute("/_auth/app/tasks/$taskId")({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { taskId } = Route.useParams();
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const getTaskById = useServerFn($getTaskById);
  const terminateTask = useServerFn($terminateTaskById);
  const destroySandbox = useServerFn($destroyTaskSandboxById);
  const runFollowUp = useServerFn($runFollowUpById);

  const [followUpInput, setFollowUpInput] = useState("");
  const [followUpPrompts, setFollowUpPrompts] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const taskQuery = useQuery({
    queryFn: () => getTaskById({ data: { taskId } }),
    queryKey: ["task-detail", taskId, getTaskById],
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
  const sandboxAlive = isCompleted && task.sandboxId && task.stage !== "Sandbox destroyed";
  const canSendFollowUp =
    sandboxAlive && followUpInput.trim().length >= 10 && !followUpMutation.isPending;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [task?.logs, task?.stage, task?.status, followUpPrompts.length, scrollToBottom]);

  const handleSendFollowUp = () => {
    if (!canSendFollowUp) return;
    const prompt = followUpInput.trim();
    setFollowUpPrompts((prev) => [...prev, prompt]);
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

  const initials = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            render={<Link to="/app/sessions" />}
            variant="ghost"
            size="sm"
            nativeButton={false}
          >
            <ArrowLeftIcon className="size-3.5" />
            Sessions
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <span className="truncate text-sm font-medium text-foreground">
            {task.repoName ?? "Task"}
          </span>
        </div>
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
      <div ref={scrollRef} className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* Initial user message */}
          <UserBubble
            text={task.prompt}
            userName={user.name}
            userImage={user.image}
            initials={initials}
            timestamp={task.startedAt}
          />

          {/* Agent response */}
          <AgentBubble task={task} isRunning={!!isRunning} />

          {/* Follow-up messages */}
          {followUpPrompts.map((prompt, i) => (
            <UserBubble
              key={i}
              text={prompt}
              userName={user.name}
              userImage={user.image}
              initials={initials}
            />
          ))}

          {/* Show a thinking indicator when follow-up is running */}
          {followUpPrompts.length > 0 && isRunning ? (
            <div className="flex items-start gap-3">
              <AgentAvatar />
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-4 py-3">
                <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Working on it...</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Bottom chat input */}
      {sandboxAlive || isRunning ? (
        <div className="shrink-0 border-t border-border bg-background px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendFollowUp();
              }}
              className="flex items-center gap-3"
            >
              <input
                type="text"
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                placeholder={
                  isRunning && !sandboxAlive
                    ? "Waiting for task to finish..."
                    : "Send a follow-up..."
                }
                disabled={isRunning && !sandboxAlive}
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!canSendFollowUp}
                className={`flex items-center gap-2 transition-colors ${
                  canSendFollowUp ? "text-foreground" : "text-muted-foreground/40"
                }`}
              >
                <span className="text-sm">Send</span>
                <span className="inline-flex items-center justify-center rounded border border-input px-1 py-0.5">
                  <CornerDownLeftIcon className="size-3" />
                </span>
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}

/* ─── Sub-components ───────────────────────────────────────────────────────── */

function UserBubble({
  text,
  userName,
  userImage,
  initials,
  timestamp,
}: {
  text: string;
  userName?: string | null;
  userImage?: string | null;
  initials: string;
  timestamp?: Date | string;
}) {
  return (
    <div className="flex max-w-[85%] flex-row-reverse items-start gap-3 self-end">
      <Avatar className="size-7 shrink-0 border border-border">
        {userImage ? <AvatarImage src={userImage} alt={userName ?? ""} /> : null}
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col items-end gap-1">
        <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
          {text}
        </div>
        {timestamp ? (
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AgentAvatar() {
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
      <BotIcon className="size-3.5 text-muted-foreground" />
    </div>
  );
}

type TaskData = NonNullable<Awaited<ReturnType<typeof $getTaskById>>>;

type ParsedAgentMessage = { text: string; timestamp: number };

function parseAgentMessages(raw: string | null | undefined): ParsedAgentMessage[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function AgentBubble({ task, isRunning }: { task: TaskData; isRunning: boolean }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const agentMessages = parseAgentMessages(task.agentMessages);

  const statusBadge =
    task.status === "succeeded" ? (
      <Badge variant="success" size="sm" className="gap-1">
        <CheckCircle2Icon className="size-3" />
        Completed
      </Badge>
    ) : task.status === "failed" ? (
      <Badge variant="error" size="sm" className="gap-1">
        <XCircleIcon className="size-3" />
        Failed
      </Badge>
    ) : (
      <Badge variant="info" size="sm" className="gap-1">
        <LoaderIcon className="size-3 animate-spin" />
        {task.status === "queued" ? "Queued" : "Running"}
      </Badge>
    );

  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <AgentAvatar />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-4 py-3">
          {/* Status + stage */}
          <div className="flex items-center gap-2">
            {statusBadge}
            <span className="text-xs text-muted-foreground">{task.stage}</span>
          </div>

          {/* Agent text messages */}
          {agentMessages.length > 0 ? (
            <div className="flex flex-col gap-2">
              {agentMessages.map((msg, i) => (
                <div key={i} className="text-sm whitespace-pre-wrap">
                  {msg.text}
                </div>
              ))}
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-2">
              <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
            </div>
          ) : null}

          {/* Error */}
          {task.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Error</p>
              <p className="mt-0.5 text-xs text-destructive/80">{task.error}</p>
            </div>
          ) : null}

          {/* PR link */}
          {task.prUrl ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
              <GitPullRequestIcon className="size-3.5 shrink-0 text-emerald-500" />
              <a
                href={task.prUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
              >
                View PR #{task.prNumber}
                <ExternalLinkIcon className="size-2.5" />
              </a>
            </div>
          ) : null}

          {/* Logs toggle */}
          {task.logs ? (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setLogsOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <TerminalIcon className="size-3" />
                <span>Sandbox logs</span>
                {isRunning ? (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                ) : null}
                {logsOpen ? (
                  <ChevronDownIcon className="size-3" />
                ) : (
                  <ChevronRightIcon className="size-3" />
                )}
              </button>
              {logsOpen ? (
                <div className="max-h-[300px] overflow-auto rounded-lg bg-[#0a0a0a] p-3 font-mono text-[11px] leading-relaxed text-emerald-400">
                  <pre className="break-all whitespace-pre-wrap">{task.logs}</pre>
                </div>
              ) : null}
            </div>
          ) : isRunning && agentMessages.length === 0 ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <TerminalIcon className="size-3" />
              <span>Waiting for logs...</span>
            </div>
          ) : null}
        </div>

        {/* Timestamp */}
        {task.completedAt ? (
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(task.completedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
