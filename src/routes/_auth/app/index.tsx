import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BookMarkedIcon,
  ChevronDownIcon,
  ArrowRightIcon,
  PlusIcon,
  LoaderIcon,
  SearchIcon,
  GitBranchIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PromptComposer } from "@/components/app/prompt-composer";
import { RunningTaskItem } from "@/components/app/running-task-item";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { githubBranchesQueryOptions, githubReposQueryOptions } from "@/lib/github/queries";
import { $createProject, $createTask } from "@/lib/project/functions";
import {
  allUserTasksQueryOptions,
  projectDetailQueryOptions,
  projectsQueryOptions,
} from "@/lib/project/queries";

export const Route = createFileRoute("/_auth/app/")({
  loader: async ({ context }) => {
    const userId = context.user.id;
    await Promise.all([
      context.queryClient.ensureQueryData({
        ...projectsQueryOptions(userId),
        revalidateIfStale: true,
      }),
      context.queryClient.ensureQueryData({
        ...allUserTasksQueryOptions(userId),
        revalidateIfStale: true,
      }),
    ]);
  },
  component: AppHome,
});

function AppHome() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [quickTask, setQuickTask] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branchMenuOpened, setBranchMenuOpened] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectSearch, setCreateProjectSearch] = useState("");
  const [createProjectRepoId, setCreateProjectRepoId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");

  const projectsQuery = useQuery(projectsQueryOptions(user.id));

  const projects = projectsQuery.data ?? [];
  const currentProjectId = selectedProjectId || projects[0]?.id || "";
  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const currentProjectDetailQuery = useQuery({
    ...projectDetailQueryOptions(currentProjectId),
    enabled: Boolean(currentProjectId),
  });

  const projectLabel =
    currentProject?.name ?? (projectsQuery.isPending ? "Loading..." : "Select project");

  const currentProjectRepoFullName = currentProjectDetailQuery.data?.repoFullName ?? null;
  const createProjectRepoQuery = useQuery({
    ...githubReposQueryOptions(user.id),
    enabled: createProjectOpen,
  });
  const repos = createProjectRepoQuery.data ?? [];
  const createProjectRepo = repos.find((repo) => repo.id === createProjectRepoId) ?? null;
  const createProjectQuery = createProjectSearch.trim().toLowerCase();
  const filteredCreateRepos = createProjectQuery
    ? repos.filter((repo) =>
        [repo.fullName, repo.name, repo.ownerLogin].some((value) =>
          value.toLowerCase().includes(createProjectQuery),
        ),
      )
    : repos.slice(0, 8);

  const branchesQuery = useQuery({
    ...githubBranchesQueryOptions(user.id, currentProjectRepoFullName ?? ""),
    enabled: Boolean(currentProjectRepoFullName) && branchMenuOpened,
  });

  const branches = branchesQuery.data ?? [];
  const currentBranch = selectedBranch || branches[0]?.name || "main";

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      if (!createProjectRepo) {
        throw new Error("Select a repository first.");
      }

      return createProject({
        data: {
          name: createProjectName.trim() || createProjectRepo.fullName,
          repoId: createProjectRepo.id,
        },
      });
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created.");
      setCreateProjectOpen(false);
      setCreateProjectSearch("");
      setCreateProjectRepoId("");
      setCreateProjectName("");
      setSelectedProjectId(project.id);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create project.");
    },
  });

  const recentTasksQuery = useQuery({
    ...allUserTasksQueryOptions(user.id),
    refetchInterval: (query) => {
      const tasks = query.state.data ?? [];
      return tasks.some((task) => task.status === "queued" || task.status === "running")
        ? 2_000
        : 10_000;
    },
  });

  const recentTasks = recentTasksQuery.data ?? [];
  const runningTasks = recentTasks.filter((t) => t.status === "queued" || t.status === "running");

  const taskMutation = useMutation({
    mutationFn: async (data: { prompt: string; quickTask: boolean; sourceBranch: string }) => {
      if (!currentProject) {
        throw new Error("Select a project first.");
      }

      return createTask({
        data: {
          projectId: currentProject.id,
          prompt: data.prompt,
          quickTask: data.quickTask,
          sourceBranch: data.sourceBranch,
        },
      });
    },
    onSuccess: (newTask) => {
      queryClient.invalidateQueries({ queryKey: ["all-user-tasks"] });
      toast.success("Background task started.");
      setInputValue("");
      setQuickTask(false);
      navigate({ to: "/app/tasks/$taskId", params: { taskId: newTask.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start task.");
    },
  });

  const canSubmit =
    inputValue.trim().length >= 1 && Boolean(currentProject) && !taskMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !currentProject) return;
    taskMutation.mutate({
      prompt: inputValue.trim(),
      quickTask,
      sourceBranch: currentBranch,
    });
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
                  <RunningTaskItem key={t.id} task={t} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {/* Bottom Input Area */}
      <div className="fixed inset-x-0 bottom-6 flex justify-center px-4">
        <PromptComposer
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleSubmit}
          placeholder="Ask anything..."
          canSubmit={canSubmit}
          submitAriaLabel={taskMutation.isPending ? "Starting..." : "Send"}
          footerLeft={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground">
                  <BookMarkedIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[160px] truncate">{projectLabel}</span>
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" sideOffset={8} className="min-w-56">
                  {projects.length > 0 ? (
                    <>
                      {projects.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          onClick={() => {
                            setSelectedProjectId(project.id);
                            setSelectedBranch("");
                          }}
                        >
                          {project.name}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  ) : (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="font-normal text-muted-foreground">
                        No projects yet
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                    </DropdownMenuGroup>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      setCreateProjectSearch("");
                      setCreateProjectRepoId("");
                      setCreateProjectName("");
                      setCreateProjectOpen(true);
                    }}
                  >
                    <PlusIcon className="size-4" aria-hidden="true" />
                    Add project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu
                onOpenChange={(open) => {
                  if (open) setBranchMenuOpened(true);
                }}
              >
                <DropdownMenuTrigger
                  disabled={!currentProject}
                  className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60"
                >
                  <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="max-w-[160px] truncate">{currentBranch}</span>
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
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

              <button
                type="button"
                onClick={() => setQuickTask((current) => !current)}
                aria-pressed={quickTask}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground"
              >
                <Checkbox
                  checked={quickTask}
                  aria-label="Enable quick task mode"
                  className="pointer-events-none size-3.5"
                />
                <span>Quick task</span>
              </button>
            </>
          }
          note={
            quickTask
              ? "Runs a single task, opens the PR, then destroys the sandbox automatically."
              : null
          }
        />
      </div>

      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Search your GitHub repositories, then bind one to a new project.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="repo-search">Search repositories</Label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  id="repo-search"
                  value={createProjectSearch}
                  onChange={(event) => setCreateProjectSearch(event.target.value)}
                  placeholder="Search by repo, owner, or full name"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Repository</Label>
              <div className="max-h-72 overflow-auto rounded-2xl border border-border bg-background p-1">
                {createProjectRepoQuery.isPending ? (
                  <div className="flex items-center justify-center py-10">
                    <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : repos.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-muted-foreground">
                    No GitHub repositories found.
                  </div>
                ) : filteredCreateRepos.length === 0 ? (
                  <div className="px-3 py-6 text-sm text-muted-foreground">
                    No repositories match your search.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {filteredCreateRepos.map((repo) => {
                      const isSelected = repo.id === createProjectRepoId;

                      return (
                        <button
                          key={repo.id}
                          type="button"
                          onClick={() => {
                            setCreateProjectRepoId(repo.id);
                            setCreateProjectName(repo.fullName);
                          }}
                          className={`flex flex-col items-start gap-1 rounded-xl px-3 py-2 text-left transition-colors ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                        >
                          <span className="font-medium">{repo.fullName}</span>
                          <span className="text-xs text-muted-foreground/70">
                            {repo.ownerLogin} · {repo.visibility}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={createProjectName}
                onChange={(event) => setCreateProjectName(event.target.value)}
                placeholder={createProjectRepo?.fullName ?? "Project name"}
                disabled={!createProjectRepo}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateProjectOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!createProjectRepo || createProjectMutation.isPending}
              onClick={() => createProjectMutation.mutate()}
            >
              {createProjectMutation.isPending ? "Creating..." : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
