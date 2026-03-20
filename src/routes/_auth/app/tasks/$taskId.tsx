import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  LoaderIcon,
  ServerIcon,
  SquareIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { $getTaskById, $terminateTaskById } from "@/lib/project/functions";

const TERMINAL_STATUSES = new Set(["failed", "succeeded"]);

export const Route = createFileRoute("/_auth/app/tasks/$taskId")({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { taskId } = Route.useParams();
  const queryClient = useQueryClient();
  const getTaskById = useServerFn($getTaskById);
  const terminateTask = useServerFn($terminateTaskById);
  const logsEndRef = useRef<HTMLDivElement>(null);

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

  const task = taskQuery.data;
  const isRunning = task && !TERMINAL_STATUSES.has(task.status);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [task?.logs]);

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

  const statusIcon =
    task.status === "succeeded" ? (
      <CheckCircle2Icon className="size-4 text-emerald-500" />
    ) : task.status === "failed" ? (
      <XCircleIcon className="size-4 text-destructive" />
    ) : (
      <LoaderIcon className="size-4 animate-spin text-info-foreground" />
    );

  const statusVariant =
    task.status === "succeeded"
      ? ("success" as const)
      : task.status === "failed"
        ? ("error" as const)
        : ("info" as const);

  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-6 pb-16">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        {/* Back + header */}
        <div className="flex flex-col gap-3">
          <Button
            render={<Link to="/app/sessions" />}
            variant="ghost"
            size="sm"
            nativeButton={false}
            className="w-fit"
          >
            <ArrowLeftIcon className="size-3.5" />
            Sessions
          </Button>

          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-lg font-semibold text-foreground">
                {task.prompt.split("\n")[0]?.slice(0, 100)}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {task.repoName ? (
                  <span className="flex items-center gap-1 font-mono text-xs">
                    <ServerIcon className="size-3" />
                    {task.repoName}
                  </span>
                ) : null}
                {task.branchName ? (
                  <span className="flex items-center gap-1 font-mono text-xs">
                    <GitBranchIcon className="size-3" />
                    {task.branchName}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground/50">
                  Started {new Date(task.startedAt).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
              <Badge variant={statusVariant} className="gap-1">
                {statusIcon}
                {task.status === "queued"
                  ? "Queued"
                  : task.status === "running"
                    ? "Running"
                    : task.status === "succeeded"
                      ? "Completed"
                      : "Failed"}
              </Badge>
            </div>
          </div>
        </div>
        <Separator />

        {/* Stage indicator */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
          {isRunning ? (
            <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <CircleDotIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="flex flex-col">
            <span className="text-sm font-medium">{task.stage}</span>
            {task.sandboxId ? (
              <span className="text-xs text-muted-foreground/60">Sandbox: {task.sandboxId}</span>
            ) : null}
          </div>
        </div>

        {/* Error */}
        {task.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-sm font-medium text-destructive">Error</p>
            <p className="mt-1 text-sm text-destructive/80">{task.error}</p>
          </div>
        ) : null}

        {/* PR link */}
        {task.prUrl ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
            <GitPullRequestIcon className="size-4 shrink-0 text-emerald-500" />
            <div className="flex flex-col">
              <span className="text-sm font-medium">Pull request opened</span>
              <a
                href={task.prUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
              >
                View PR #{task.prNumber}
                <ExternalLinkIcon className="size-3" />
              </a>
            </div>
          </div>
        ) : null}

        {/* Prompt */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Prompt
          </span>
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm whitespace-pre-wrap">
            {task.prompt}
          </div>
        </div>

        {/* Sandbox logs */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <TerminalIcon className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Sandbox logs
            </span>
            {isRunning ? (
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            ) : null}
          </div>
          <div className="max-h-[500px] overflow-auto rounded-xl border border-border bg-[#0a0a0a] p-4 font-mono text-xs leading-relaxed text-emerald-400 dark:bg-[#0a0a0a]">
            {task.logs ? (
              <>
                <pre className="break-all whitespace-pre-wrap">{task.logs}</pre>
                <div ref={logsEndRef} />
              </>
            ) : (
              <span className="text-muted-foreground/50">
                {isRunning ? "Waiting for logs..." : "No logs captured."}
              </span>
            )}
          </div>
        </div>

        {/* Metadata grid */}
        {task.completedAt || task.sandboxName ? (
          <div className="grid gap-3 md:grid-cols-2">
            {task.sandboxName ? <MetaItem label="Sandbox name" value={task.sandboxName} /> : null}
            {task.completedAt ? (
              <MetaItem label="Completed" value={new Date(task.completedAt).toLocaleString()} />
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-muted/40 p-3">
      <span className="text-xs text-muted-foreground/60">{label}</span>
      <span className="text-sm font-medium break-all">{value}</span>
    </div>
  );
}
