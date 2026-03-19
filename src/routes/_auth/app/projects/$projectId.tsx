import {
  RiArrowLeftLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiGitPullRequestLine,
  RiGitRepositoryLine,
  RiLoader4Line,
  RiPlayLine,
  RiRobot2Line,
  RiStopLine,
  RiTimeLine,
} from "@remixicon/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  $createTask,
  $deleteTask,
  $getProject,
  $getTask,
  $listTasks,
  $terminateTask,
} from "@/lib/project/functions";

type TaskRow = Awaited<ReturnType<typeof $listTasks>>[number];

const TERMINAL_STATUSES = new Set(["failed", "succeeded"]);

export const Route = createFileRoute("/_auth/app/projects/$projectId")({
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const queryClient = useQueryClient();
  const createTask = useServerFn($createTask);
  const deleteTask = useServerFn($deleteTask);
  const terminateTask = useServerFn($terminateTask);
  const getProject = useServerFn($getProject);
  const listTasks = useServerFn($listTasks);
  const getTask = useServerFn($getTask);

  const [prompt, setPrompt] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryFn: () => getProject({ data: { projectId } }),
    queryKey: ["project", projectId, getProject],
  });

  const tasksQuery = useQuery({
    queryFn: () => listTasks({ data: { projectId } }),
    queryKey: ["tasks", projectId, listTasks],
    refetchInterval: 5_000,
  });

  const taskMutation = useMutation({
    mutationFn: async (data: { prompt: string }) => createTask({ data: { ...data, projectId } }),
    onSuccess: (newTask) => {
      toast.success("Task started.");
      setPrompt("");
      setExpandedTaskId(newTask.id);
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start task.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => deleteTask({ data: { projectId, taskId } }),
    onSuccess: () => {
      toast.success("Task deleted.");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete task.");
    },
  });

  const terminateMutation = useMutation({
    mutationFn: async (taskId: string) => terminateTask({ data: { projectId, taskId } }),
    onSuccess: () => {
      toast.success("Task terminated.");
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to terminate task.");
    },
  });

  const canLaunch = !taskMutation.isPending && prompt.trim().length >= 10;
  const tasks = tasksQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          render={<Link to="/app" />}
          size="sm"
          variant="ghost"
          nativeButton={false}
          className="w-fit"
        >
          <RiArrowLeftLine data-icon="inline-start" />
          Dashboard
        </Button>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight">
            {projectQuery.data?.name ?? "Project"}
          </h1>
          {projectQuery.data?.repoFullName ? (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <RiGitRepositoryLine className="size-4" />
              {projectQuery.data.repoHtmlUrl ? (
                <a
                  href={projectQuery.data.repoHtmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {projectQuery.data.repoFullName}
                </a>
              ) : (
                <span>{projectQuery.data.repoFullName}</span>
              )}
            </div>
          ) : null}
          {projectQuery.data?.repoDescription ? (
            <p className="text-sm text-muted-foreground">{projectQuery.data.repoDescription}</p>
          ) : null}
        </div>
      </div>

      <Card className="border border-border/60 shadow-sm">
        <CardHeader>
          <CardTitle>Run a task</CardTitle>
          <CardDescription>
            Describe what the agent should do. It will boot a sandbox, run the task, and open a PR.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="task-prompt">Prompt</Label>
            <Textarea
              id="task-prompt"
              className="min-h-28"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Describe the task for the agent to execute..."
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Button disabled={!canLaunch} onClick={() => taskMutation.mutate({ prompt })}>
            {taskMutation.isPending ? (
              <RiLoader4Line data-icon="inline-start" className="animate-spin" />
            ) : (
              <RiPlayLine data-icon="inline-start" />
            )}
            {taskMutation.isPending ? "Starting..." : "Run task"}
          </Button>
        </CardFooter>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-bold tracking-tight">Tasks</h2>

        {tasksQuery.isPending ? (
          <div className="flex items-center justify-center py-12">
            <RiLoader4Line className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <RiRobot2Line className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground">No tasks yet. Run your first task above.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                projectId={projectId}
                expanded={expandedTaskId === t.id}
                onToggle={() => setExpandedTaskId(expandedTaskId === t.id ? null : t.id)}
                getTask={getTask}
                onDelete={() => deleteMutation.mutate(t.id)}
                onTerminate={() => terminateMutation.mutate(t.id)}
                isDeleting={deleteMutation.isPending}
                isTerminating={terminateMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  projectId,
  expanded,
  onToggle,
  getTask,
  onDelete,
  onTerminate,
  isDeleting,
  isTerminating,
}: {
  task: TaskRow;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  getTask: ReturnType<typeof useServerFn<typeof $getTask>>;
  onDelete: () => void;
  onTerminate: () => void;
  isDeleting: boolean;
  isTerminating: boolean;
}) {
  const detailQuery = useQuery({
    enabled: expanded && !TERMINAL_STATUSES.has(task.status),
    queryFn: () => getTask({ data: { projectId, taskId: task.id } }),
    queryKey: ["task-detail", task.id, getTask, projectId],
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || TERMINAL_STATUSES.has(data.status)) return false;
      return 2_000;
    },
  });

  const detail = detailQuery.data ?? task;

  return (
    <Card className="border border-border/60 shadow-sm">
      <CardHeader className="cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-2">
          <RiTimeLine className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">
            {new Date(task.startedAt).toLocaleString()}
          </CardTitle>
        </div>
        <CardDescription className="line-clamp-1">{task.prompt}</CardDescription>
        <CardAction>
          <Badge
            variant={
              detail.status === "succeeded"
                ? "secondary"
                : detail.status === "failed"
                  ? "destructive"
                  : "outline"
            }
          >
            {detail.status}
          </Badge>
        </CardAction>
      </CardHeader>

      {expanded ? (
        <CardContent className="flex flex-col gap-4">
          {detail.error ? (
            <Alert variant="destructive">
              <RiErrorWarningLine />
              <AlertTitle>Task failed</AlertTitle>
              <AlertDescription>{detail.error}</AlertDescription>
            </Alert>
          ) : null}

          {detail.prUrl ? (
            <Alert>
              <RiGitPullRequestLine />
              <AlertTitle>Pull request opened</AlertTitle>
              <AlertDescription>
                <a
                  className="inline-flex items-center gap-1 underline underline-offset-4"
                  href={detail.prUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  View PR #{detail.prNumber}
                  <RiExternalLinkLine />
                </a>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <StatusItem label="Stage" value={detail.stage} />
            <StatusItem label="Repository" value={detail.repoName || "Unknown"} />
            <StatusItem label="Sandbox" value={detail.sandboxId || "Pending"} />
            <StatusItem label="Branch" value={detail.branchName || "Pending"} />
            <StatusItem label="Clone path" value={detail.clonePath || "Pending"} />
            <StatusItem
              label="Completed"
              value={
                detail.completedAt ? new Date(detail.completedAt).toLocaleString() : "Still running"
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
              Prompt
            </span>
            <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm whitespace-pre-wrap">
              {detail.prompt}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
              Recent logs
            </span>
            <div className="max-h-96 overflow-auto rounded-2xl border border-border/60 bg-muted/40 p-4 font-mono text-xs whitespace-pre-wrap">
              {detail.logs || "No logs captured yet."}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
            {!TERMINAL_STATUSES.has(detail.status) ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={isTerminating}
                onClick={(e) => {
                  e.stopPropagation();
                  onTerminate();
                }}
              >
                {isTerminating ? (
                  <RiLoader4Line data-icon="inline-start" className="animate-spin" />
                ) : (
                  <RiStopLine data-icon="inline-start" />
                )}
                Terminate
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <RiDeleteBinLine data-icon="inline-start" className="text-destructive" />
              Delete
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border/60 bg-muted/40 p-4">
      <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">{label}</span>
      <span className="font-medium break-all">{value}</span>
    </div>
  );
}
