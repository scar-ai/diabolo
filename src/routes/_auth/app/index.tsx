import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  GitBranchIcon,
  BookMarkedIcon,
  CornerDownLeftIcon,
  ChevronDownIcon,
  ArrowRightIcon,
  LoaderIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { $listGithubBranches, $listGithubRepos } from "@/lib/github/functions";
import { $createProject, $createTask, $listAllUserTasks } from "@/lib/project/functions";

export const Route = createFileRoute("/_auth/app/")({
  component: AppHome,
});

function AppHome() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const listGithubRepos = useServerFn($listGithubRepos);
  const listGithubBranches = useServerFn($listGithubBranches);
  const createProject = useServerFn($createProject);
  const createTask = useServerFn($createTask);

  const greeting = getGreeting();
  const firstName = user.name?.split(" ")[0] ?? user.name ?? "there";

  const today = new Date();
  const dateString = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [inputValue, setInputValue] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");

  const reposQuery = useQuery({
    queryFn: listGithubRepos,
    queryKey: ["github-repos", user.id],
  });

  const repos = reposQuery.data ?? [];
  const currentRepo = repos.find((r) => r.id === selectedRepoId) ?? repos[0] ?? null;

  const branchesQuery = useQuery({
    enabled: Boolean(currentRepo),
    queryFn: () => listGithubBranches({ data: { repoFullName: currentRepo!.fullName } }),
    queryKey: ["github-branches", currentRepo?.id, currentRepo?.fullName, listGithubBranches],
  });

  const branches = branchesQuery.data ?? [];
  const currentBranch =
    selectedBranch ||
    branches.find((b) => b.name === currentRepo?.defaultBranch)?.name ||
    branches[0]?.name ||
    currentRepo?.defaultBranch ||
    "main";

  const listAllUserTasks = useServerFn($listAllUserTasks);

  const recentTasksQuery = useQuery({
    queryFn: listAllUserTasks,
    queryKey: ["all-user-tasks", listAllUserTasks],
    refetchInterval: 10_000,
  });

  const recentTasks = recentTasksQuery.data ?? [];
  const runningTasks = recentTasks.filter((t) => t.status === "queued" || t.status === "running");

  const taskMutation = useMutation({
    mutationFn: async (data: { prompt: string; repoId: string }) => {
      // Ensure a project exists for this repo, then create a task
      let proj: { id: string };
      try {
        proj = await createProject({
          data: { name: currentRepo?.fullName ?? "Project", repoId: data.repoId },
        });
      } catch {
        // If project creation fails (e.g. duplicate), find existing
        throw new Error("Failed to create project for this repository.");
      }

      return createTask({ data: { projectId: proj.id, prompt: data.prompt } });
    },
    onSuccess: (newTask) => {
      toast.success("Background task started.");
      setInputValue("");
      navigate({ to: "/app/tasks/$taskId", params: { taskId: newTask.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start task.");
    },
  });

  const canSubmit =
    inputValue.trim().length >= 10 && Boolean(currentRepo) && !taskMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !currentRepo) return;
    taskMutation.mutate({ prompt: inputValue.trim(), repoId: currentRepo.id });
  };

  return (
    <>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-48">
        <div className="flex w-full max-w-[600px] flex-col items-center text-center">
          <p className="mb-3 text-sm text-muted-foreground/60">{dateString}</p>

          <h1 className="mb-10 font-serif text-[2.75rem] leading-tight tracking-tight text-muted-foreground/70">
            {greeting}, <span className="text-foreground">{firstName}</span>
          </h1>

          {/* Running tasks */}
          {runningTasks.length > 0 ? (
            <div className="w-full text-left">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  <span className="text-sm font-semibold text-foreground">
                    Running ({runningTasks.length})
                  </span>
                </div>
                <Link
                  to="/app/sessions"
                  className="flex items-center gap-1 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  All sessions <ArrowRightIcon className="size-3" aria-hidden="true" />
                </Link>
              </div>

              <div className="flex flex-col gap-2">
                {runningTasks.map((t) => (
                  <Link
                    key={t.id}
                    to="/app/tasks/$taskId"
                    params={{ taskId: t.id }}
                    className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {t.prompt.split("\n")[0]?.slice(0, 60)}
                      </span>
                      <span className="text-xs text-muted-foreground/50">
                        {t.repoName ?? "—"} · {t.stage}
                      </span>
                    </div>
                    <Badge variant="info" size="sm">
                      {t.status === "queued" ? "Queued" : "Running"}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {/* Bottom Input Area */}
      <div className="fixed inset-x-0 bottom-6 flex justify-center px-4">
        <div className="flex w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-border bg-background">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="px-4 pt-3.5 pb-6">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask anything..."
                className="w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground/40"
              />
            </div>
          </form>

          <Separator className="bg-border" />

          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-0.5">
              {/* Repository Selector */}
              <DropdownMenu>
                <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground">
                  <BookMarkedIcon className="size-3.5" aria-hidden="true" />
                  {currentRepo?.fullName ?? (reposQuery.isPending ? "Loading..." : "Select repo")}
                  <ChevronDownIcon className="size-3 opacity-50" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" sideOffset={8}>
                  {repos.map((repo) => (
                    <DropdownMenuItem
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepoId(repo.id);
                        setSelectedBranch("");
                      }}
                    >
                      {repo.fullName}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Branch Selector */}
              <DropdownMenu>
                <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground">
                  <GitBranchIcon className="size-3.5" aria-hidden="true" />
                  {currentBranch}
                  <ChevronDownIcon className="size-3 opacity-50" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" sideOffset={8}>
                  {branches.map((branch) => (
                    <DropdownMenuItem
                      key={branch.name}
                      onClick={() => setSelectedBranch(branch.name)}
                    >
                      {branch.name}
                    </DropdownMenuItem>
                  ))}
                  {branches.length === 0 && !branchesQuery.isPending ? (
                    <DropdownMenuItem disabled>{currentBranch}</DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`flex items-center gap-2 transition-colors ${canSubmit ? "text-foreground" : "text-muted-foreground/40"}`}
            >
              <span className="text-sm">{taskMutation.isPending ? "Starting..." : "Go"}</span>
              <span className="inline-flex items-center justify-center rounded border border-input px-1 py-0.5">
                <CornerDownLeftIcon className="size-3" aria-hidden="true" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
