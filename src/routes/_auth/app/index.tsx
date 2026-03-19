import {
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiGitPullRequestLine,
  RiGitRepositoryLine,
  RiLoader4Line,
  RiRobot2Line,
  RiSparklingLine,
} from "@remixicon/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { startTransition, useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { $getRepoTask, $startRepoTask } from "@/lib/daytona/functions";
import { $listGithubRepos } from "@/lib/github/functions";

type RepoTaskJob = {
  branchName?: string;
  clonePath?: string;
  completedAt?: string;
  error?: string;
  id: string;
  logs?: string;
  prNumber?: number;
  prUrl?: string;
  prompt: string;
  repoId: string;
  repoName?: string;
  repoUrl?: string;
  sandboxId?: string;
  sandboxName?: string;
  stage: string;
  startedAt: string;
  status: "queued" | "running" | "succeeded" | "failed";
};

const TERMINAL_STATUSES = new Set<RepoTaskJob["status"]>(["failed", "succeeded"]);
const DEFAULT_PROMPT =
  "Inspect this repository, implement the requested change, run the relevant verification, and stop only when the task is fully complete.";

export const Route = createFileRoute("/_auth/app/")({
  component: AppIndex,
});

function AppIndex() {
  const { user } = Route.useRouteContext();
  const listGithubRepos = useServerFn($listGithubRepos);
  const startRepoTask = useServerFn($startRepoTask);
  const getRepoTask = useServerFn($getRepoTask);
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [activeJobId, setActiveJobId] = useState("");
  const lastCompletedJobIdRef = useRef("");

  const reposQuery = useQuery({
    queryFn: listGithubRepos,
    queryKey: ["github-repos", user.id],
  });
  const currentRepoId = selectedRepoId || reposQuery.data?.[0]?.id || "";
  const selectedRepo =
    reposQuery.data?.find((repo) => repo.id === currentRepoId) ?? reposQuery.data?.[0] ?? null;

  const taskMutation = useMutation({
    mutationFn: async (data: { prompt: string; repoId: string }) => startRepoTask({ data }),
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to start the repo task.";
      toast.error(message);
    },
    onSuccess: (job) => {
      toast.success("Background repo task started.");
      startTransition(() => {
        setActiveJobId(job.id);
      });
    },
  });

  const activeJobQuery = useQuery({
    enabled: Boolean(activeJobId),
    queryFn: () => getRepoTask({ data: { jobId: activeJobId } }),
    queryKey: ["repo-task", activeJobId, getRepoTask],
    refetchInterval: (query) => {
      const job = query.state.data as RepoTaskJob | undefined;

      if (!job || TERMINAL_STATUSES.has(job.status)) {
        return false;
      }

      return 2_000;
    },
  });

  useEffect(() => {
    const job = activeJobQuery.data;

    if (!job || !TERMINAL_STATUSES.has(job.status) || lastCompletedJobIdRef.current === job.id) {
      return;
    }

    lastCompletedJobIdRef.current = job.id;

    if (job.status === "succeeded") {
      toast.success(job.prUrl ? "Task finished and PR opened." : "Task finished.");
      return;
    }

    toast.error(job.error || "The background repo task failed.");
  }, [activeJobQuery.data]);

  const currentJob = activeJobQuery.data ?? taskMutation.data ?? null;
  const isLaunching = taskMutation.isPending;
  const isPolling =
    currentJob?.status === "queued" ||
    currentJob?.status === "running" ||
    activeJobQuery.isFetching;
  const canLaunch =
    Boolean(currentRepoId) && !reposQuery.isPending && !reposQuery.isError && !isPolling;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden border border-border/60 bg-gradient-to-br from-primary/10 via-background to-secondary/80 shadow-sm">
        <CardHeader>
          <CardTitle>Background Daytona repo agent</CardTitle>
          <CardDescription>
            Pick one GitHub repository, describe the task, and the app will boot a Daytona sandbox,
            clone the repo, run OpenCode against it, push a branch, open a PR, and destroy the
            sandbox.
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{user.name}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
          <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-background/85 p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="repo-picker">Repository</Label>
              <Select
                value={currentRepoId}
                onValueChange={(value) => setSelectedRepoId(value || "")}
              >
                <SelectTrigger id="repo-picker" className="w-full">
                  <SelectValue
                    placeholder={
                      reposQuery.isPending ? "Loading your GitHub repos..." : "Select a repository"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Your accessible GitHub repos</SelectLabel>
                    {reposQuery.data?.map((repo) => (
                      <SelectItem key={repo.id} value={repo.id}>
                        {repo.fullName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="task-prompt">Task prompt</Label>
              <Textarea
                id="task-prompt"
                className="min-h-36"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Explain exactly what OpenCode should change in this repository."
                value={prompt}
              />
            </div>

            {reposQuery.isPending ? (
              <Alert>
                <RiLoader4Line className="animate-spin" />
                <AlertTitle>Loading repositories</AlertTitle>
                <AlertDescription>
                  Fetching the public and private GitHub repositories available to {user.name}.
                </AlertDescription>
              </Alert>
            ) : null}

            {reposQuery.isError ? (
              <Alert variant="destructive">
                <RiErrorWarningLine />
                <AlertTitle>GitHub repos unavailable</AlertTitle>
                <AlertDescription>
                  {reposQuery.error instanceof Error
                    ? reposQuery.error.message
                    : "Failed to load your GitHub repositories."}
                </AlertDescription>
              </Alert>
            ) : null}

            {selectedRepo ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/90 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <RiGitRepositoryLine className="text-muted-foreground" />
                    <span className="font-medium">{selectedRepo.fullName}</span>
                  </div>
                  <Badge variant="secondary">{selectedRepo.visibility}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedRepo.description || "No repository description provided."}
                </p>
                <p className="truncate text-xs text-muted-foreground">{selectedRepo.htmlUrl}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <Alert>
              <RiSparklingLine />
              <AlertTitle>Execution flow</AlertTitle>
              <AlertDescription>
                The task runs in the background: sandbox boot, repo clone, OpenCode task execution,
                branch push, PR creation, and sandbox teardown. Set `DAYTONA_API_KEY` and
                `OPENROUTER_API_KEY`. Leave `DAYTONA_DEFAULT_IMAGE` blank unless you know the image
                is valid for your target.
              </AlertDescription>
            </Alert>

            <Alert>
              <RiRobot2Line />
              <AlertTitle>Provider</AlertTitle>
              <AlertDescription>
                OpenCode runs with the `openrouter` provider and uses `OPENCODE_MODEL` if
                configured, otherwise `openrouter/openai/gpt-5-codex`. If you enter an OpenRouter
                model like `nvidia/...`, the app will normalize it to `openrouter/nvidia/...` and
                register it in the generated OpenCode provider config.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
        <CardFooter className="items-center justify-between gap-3 border-t border-border/60">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Boot</Badge>
            <Badge variant="outline">Clone</Badge>
            <Badge variant="outline">Prompt</Badge>
            <Badge variant="outline">PR</Badge>
            <Badge variant="outline">Destroy</Badge>
          </div>
          <Button
            disabled={!canLaunch || prompt.trim().length < 10}
            onClick={() => taskMutation.mutate({ prompt, repoId: currentRepoId })}
          >
            {isLaunching || isPolling ? (
              <RiLoader4Line data-icon="inline-start" className="animate-spin" />
            ) : (
              <RiRobot2Line data-icon="inline-start" />
            )}
            {isLaunching ? "Launching task..." : isPolling ? "Task running..." : "Run repo task"}
          </Button>
        </CardFooter>
      </Card>

      {currentJob ? (
        <Card className="border border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>Task status</CardTitle>
            <CardDescription>
              {currentJob.repoName || "Repository task"} started at{" "}
              {new Date(currentJob.startedAt).toLocaleString()}.
            </CardDescription>
            <CardAction>
              <Badge
                variant={
                  currentJob.status === "succeeded"
                    ? "secondary"
                    : currentJob.status === "failed"
                      ? "destructive"
                      : "outline"
                }
              >
                {currentJob.status}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {currentJob.error ? (
              <Alert variant="destructive">
                <RiErrorWarningLine />
                <AlertTitle>Task failed</AlertTitle>
                <AlertDescription>{currentJob.error}</AlertDescription>
              </Alert>
            ) : null}

            {currentJob.prUrl ? (
              <Alert>
                <RiGitPullRequestLine />
                <AlertTitle>Pull request opened</AlertTitle>
                <AlertDescription>
                  <a
                    className="inline-flex items-center gap-1 underline underline-offset-4"
                    href={currentJob.prUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View PR #{currentJob.prNumber}
                    <RiExternalLinkLine />
                  </a>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <StatusItem label="Stage" value={currentJob.stage} />
              <StatusItem label="Repository" value={currentJob.repoName || "Unknown"} />
              <StatusItem label="Sandbox" value={currentJob.sandboxId || "Pending"} />
              <StatusItem label="Branch" value={currentJob.branchName || "Pending"} />
              <StatusItem label="Clone path" value={currentJob.clonePath || "Pending"} />
              <StatusItem
                label="Completed"
                value={
                  currentJob.completedAt
                    ? new Date(currentJob.completedAt).toLocaleString()
                    : "Still running"
                }
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                Prompt
              </span>
              <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm whitespace-pre-wrap">
                {currentJob.prompt}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                Recent logs
              </span>
              <div className="max-h-96 overflow-auto rounded-2xl border border-border/60 bg-muted/40 p-4 font-mono text-xs whitespace-pre-wrap">
                {currentJob.logs || "No logs captured yet."}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
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
