import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BotIcon,
  BookMarkedIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LoaderIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PromptComposer } from "@/components/app/prompt-composer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  $destroyTaskSandboxById,
  $getTaskById,
  $runFollowUpById,
  $terminateQuickTaskById,
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
  const terminateQuickTask = useServerFn($terminateQuickTaskById);
  const destroySandbox = useServerFn($destroyTaskSandboxById);
  const runFollowUp = useServerFn($runFollowUpById);

  const [followUpInput, setFollowUpInput] = useState("");
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

  const initials = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();
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
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
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
      <div ref={scrollRef} className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 pb-44">
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
          {followUps.map((followUp) => (
            <div key={followUp.id} className="flex flex-col gap-6">
              <UserBubble
                text={followUp.prompt}
                userName={user.name}
                userImage={user.image}
                initials={initials}
                timestamp={followUp.startedAt}
              />
              <FollowUpAgentBubble followUp={followUp} />
            </div>
          ))}

          {pendingFollowUpPrompt ? (
            <UserBubble
              text={pendingFollowUpPrompt}
              userName={user.name}
              userImage={user.image}
              initials={initials}
            />
          ) : null}
        </div>
      </div>

      {isCompleted || isRunning ? (
        <div className="fixed inset-x-0 bottom-6 flex justify-center px-4">
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
                  <span className="max-w-[160px] truncate">{task.branchName ?? "Used branch"}</span>
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
type ParsedFollowUp = {
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prompt: string;
  responseMessages: ParsedAgentMessage[];
  stage: string;
  startedAt: string;
  status: TaskData["status"];
};

function parseAgentMessages(raw: string | null | undefined): ParsedAgentMessage[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseFollowUpHistory(raw: string | null | undefined): ParsedFollowUp[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is ParsedFollowUp =>
            typeof entry?.id === "string" &&
            typeof entry?.prompt === "string" &&
            typeof entry?.stage === "string" &&
            typeof entry?.startedAt === "string" &&
            Array.isArray(entry?.responseMessages) &&
            typeof entry?.status === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function renderStatusBadge(status: TaskData["status"]) {
  if (status === "succeeded") {
    return (
      <Badge variant="success" size="sm" className="gap-1">
        <CheckCircle2Icon className="size-3" />
        Completed
      </Badge>
    );
  }

  if (status === "failed") {
    return (
      <Badge variant="error" size="sm" className="gap-1">
        <XCircleIcon className="size-3" />
        Failed
      </Badge>
    );
  }

  return (
    <Badge variant="info" size="sm" className="gap-1">
      <LoaderIcon className="size-3 animate-spin" />
      {status === "queued" ? "Queued" : "Running"}
    </Badge>
  );
}

function formatTaskDate(value?: Date | string | null) {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString([], {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function QuickTaskDetail({
  isStopping,
  onStop,
  task,
}: {
  isStopping: boolean;
  onStop: () => void;
  task: TaskData;
}) {
  const agentMessages = parseAgentMessages(task.agentMessages);
  const responseText = agentMessages
    .map((message) => message.text)
    .join("\n\n")
    .trim();
  const isRunning = task.status === "queued" || task.status === "running";

  return (
    <main className="flex flex-1 justify-center px-4 py-8">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground">
            {task.repoName ?? "Quick task"}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" size="sm">
              Quick task
            </Badge>
            {isRunning ? (
              <Button variant="destructive" size="sm" disabled={isStopping} onClick={onStop}>
                {isStopping ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <SquareIcon className="size-3.5" />
                )}
                {isStopping ? "Stopping..." : "Stop task"}
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="border border-border/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>{task.repoName ?? "Quick task"}</span>
              {renderStatusBadge(task.status)}
            </CardTitle>
            <CardDescription>{task.stage}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <ReadOnlyMetaItem
              label="Date"
              value={formatTaskDate(task.completedAt ?? task.startedAt)}
            />
            <ReadOnlyMetaItem label="Status" value={task.status} />
            <ReadOnlyMetaItem
              label="Pull request"
              value={
                task.prUrl ? (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
                  >
                    PR #{task.prNumber}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : (
                  "Not available"
                )
              }
            />
          </CardContent>
        </Card>

        <ReadOnlySection title="Prompt" content={task.prompt} />
        <ReadOnlySection
          title="OpenCode response"
          content={
            responseText ||
            (task.status === "queued" || task.status === "running"
              ? "Waiting for OpenCode response..."
              : "No OpenCode response captured.")
          }
        />
        <ReadOnlySection
          title="Logs"
          content={
            task.logs ||
            (task.status === "queued" || task.status === "running"
              ? "Waiting for sandbox logs..."
              : "No sandbox logs captured.")
          }
          mono
        />

        {task.error ? (
          <Card className="border border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">Error</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-destructive/80">{task.error}</CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function ReadOnlyMetaItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
      <div className="text-xs tracking-[0.08em] text-muted-foreground/70 uppercase">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function ReadOnlySection({
  content,
  mono = false,
  title,
}: {
  content: string;
  mono?: boolean;
  title: string;
}) {
  return (
    <Card className="border border-border/80">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`max-h-[360px] overflow-auto rounded-xl border border-border/70 px-4 py-3 text-sm whitespace-pre-wrap ${
            mono
              ? "bg-[#0a0a0a] font-mono text-[11px] leading-relaxed text-emerald-400"
              : "bg-muted/20"
          }`}
        >
          <pre className={mono ? "break-all whitespace-pre-wrap" : "font-sans whitespace-pre-wrap"}>
            {content}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentBubble({ task, isRunning }: { task: TaskData; isRunning: boolean }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const agentMessages = parseAgentMessages(task.agentMessages);

  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <AgentAvatar />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-4 py-3">
          {/* Status + stage */}
          <div className="flex items-center gap-2">
            {renderStatusBadge(task.status)}
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

function FollowUpAgentBubble({ followUp }: { followUp: ParsedFollowUp }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const hasMessages = followUp.responseMessages.length > 0;
  const isRunning = followUp.status === "queued" || followUp.status === "running";

  return (
    <div className="flex max-w-[85%] items-start gap-3">
      <AgentAvatar />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 rounded-2xl rounded-tl-sm border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center gap-2">
            {renderStatusBadge(followUp.status)}
            <span className="text-xs text-muted-foreground">{followUp.stage}</span>
          </div>

          {hasMessages ? (
            <div className="flex flex-col gap-2">
              {followUp.responseMessages.map((message, index) => (
                <div key={index} className="text-sm whitespace-pre-wrap">
                  {message.text}
                </div>
              ))}
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-2">
              <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Thinking...</span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No OpenCode response captured.</div>
          )}

          {followUp.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">Error</p>
              <p className="mt-0.5 text-xs text-destructive/80">{followUp.error}</p>
            </div>
          ) : null}

          {followUp.logs ? (
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
                  <pre className="break-all whitespace-pre-wrap">{followUp.logs}</pre>
                </div>
              ) : null}
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <TerminalIcon className="size-3" />
              <span>Waiting for logs...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
              <TerminalIcon className="size-3" />
              <span>No sandbox logs captured.</span>
            </div>
          )}
        </div>

        <span className="text-[10px] text-muted-foreground/50">
          {new Date(followUp.completedAt ?? followUp.startedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
