import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BuildingIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LoaderIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  SquareIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CreateProjectDialog } from "@/components/app/home/create-project-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import authClient from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";
import { githubReposQueryOptions } from "@/lib/github/queries";
import {
  $createProject,
  $deleteProject,
  $deleteTask,
  $destroyTaskSandboxById,
  $terminateTaskById,
} from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectKeys,
  projectsQueryOptions,
  taskKeys,
  type ProjectsResult,
  type TaskSummaryResult,
} from "@/lib/project/queries";
import { cn } from "@/lib/utils";

type AppUser = {
  email: string;
  id: string;
  image?: string | null;
  name?: string | null;
};

const EMPTY_PROJECTS: ProjectsResult = [];
const EMPTY_TASKS: TaskSummaryResult[] = [];

const isTaskActive = (task: TaskSummaryResult) =>
  task.status === "queued" || task.status === "running" || task.hasActiveChildren;

const navLinkClass = (isActive: boolean) =>
  cn(
    "flex items-center gap-2.5 rounded-2xl px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
    isActive
      ? "bg-sidebar-accent font-medium text-sidebar-foreground"
      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  );

export function AppSidebar({ user }: { user: AppUser }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const createProject = useServerFn($createProject);
  const deleteProject = useServerFn($deleteProject);
  const deleteTask = useServerFn($deleteTask);
  const terminateTask = useServerFn($terminateTaskById);
  const destroyTaskSandbox = useServerFn($destroyTaskSandboxById);

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectSearch, setCreateProjectSearch] = useState("");
  const [createProjectRepoId, setCreateProjectRepoId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<ProjectsResult[number] | null>(null);
  const [deleteProjectNameConfirmation, setDeleteProjectNameConfirmation] = useState("");
  const [taskToDelete, setTaskToDelete] = useState<TaskSummaryResult | null>(null);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const currentProjectId = new URLSearchParams(searchStr).get("projectId") ?? undefined;

  // Current task id (when on a task page)
  const taskIdMatch = pathname.match(/^\/app\/tasks\/([^/]+)$/);
  const currentTaskId = taskIdMatch ? taskIdMatch[1] : undefined;

  const projectsQuery = useQuery(projectsQueryOptions(user.id));
  const tasksQuery = useQuery({
    ...allUserTaskSummariesQueryOptions(user.id),
    refetchInterval: (query) => {
      const tasks = (query.state.data ?? []) as TaskSummaryResult[];
      return tasks.some(isTaskActive) ? 2_000 : 10_000;
    },
  });
  const createProjectRepoQuery = useQuery({
    ...githubReposQueryOptions(user.id),
    enabled: createProjectOpen,
  });

  const projects = projectsQuery.data ?? EMPTY_PROJECTS;
  const hasProjects = projects.length > 0;
  const repos = createProjectRepoQuery.data ?? [];
  const createProjectRepo = repos.find((repo) => repo.id === createProjectRepoId) ?? null;
  const allTasks = tasksQuery.data ?? EMPTY_TASKS;

  const currentTask = currentTaskId
    ? allTasks.find((task) => task.id === currentTaskId)
    : undefined;

  // Keep the selected project stable on task routes, even if projectId is missing from search.
  const selectedProjectId = currentProjectId ?? currentTask?.projectId ?? projects[0]?.id;
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  // Tasks for the selected project
  const selectedProjectTasks = allTasks
    .filter((t) => t.projectId === selectedProjectId)
    .slice(0, 8);

  // Running task count for selected project
  const selectedRunningCount = selectedProjectTasks.filter(isTaskActive).length;

  // Browser notifications when a task finishes
  const prevTaskStatusesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    const prev = prevTaskStatusesRef.current;
    const completedTasks: typeof allTasks = [];

    for (const task of allTasks) {
      const prevStatus = prev.get(task.id);
      const isNowDone = task.status === "succeeded" || task.status === "failed";
      const wasActive = prevStatus === "running" || prevStatus === "queued";
      if (wasActive && isNowDone) completedTasks.push(task);
    }

    const next = new Map<string, string>();
    for (const task of allTasks) next.set(task.id, task.status);
    prevTaskStatusesRef.current = next;

    if (completedTasks.length === 0) return;

    const notify = () => {
      for (const task of completedTasks) {
        const project = projects.find((p) => p.id === task.projectId);
        const title = task.status === "succeeded" ? "Task completed" : "Task failed";
        const body = [project?.name, task.promptPreview].filter(Boolean).join(" · ");
        new Notification(title, { body });
      }
    };

    if (Notification.permission === "granted") {
      notify();
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then((permission) => {
        if (permission === "granted") notify();
      });
    }
  }, [allTasks, projects]);

  const createProjectMutation = useMutation({
    mutationFn: async () => {
      if (!createProjectRepo) throw new Error("Select a repository first.");
      return createProject({
        data: {
          name: createProjectName.trim() || createProjectRepo.fullName,
          repoId: createProjectRepo.id,
        },
      });
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project created.");
      setCreateProjectOpen(false);
      setCreateProjectSearch("");
      setCreateProjectRepoId("");
      setCreateProjectName("");
      navigate({ to: "/app", search: { projectId: project.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create project.");
    },
  });

  // Stop a running task: terminate the run, then tear down its sandbox.
  const stopTaskMutation = useMutation({
    mutationFn: async (task: TaskSummaryResult) => {
      await terminateTask({ data: { taskId: task.id } });
      await destroyTaskSandbox({ data: { taskId: task.id } });
    },
    onSuccess: async (_, task) => {
      toast.success("Task stopped and sandbox destroyed.");
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.id) });
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop task.");
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (task: TaskSummaryResult) =>
      deleteTask({ data: { projectId: task.projectId, taskId: task.id } }),
    onSuccess: async (_, task) => {
      setTaskToDelete(null);
      toast.success("Chat deleted.");

      if (currentTaskId === task.id) {
        await navigate({ to: "/app", search: { projectId: task.projectId } });
      }

      queryClient.removeQueries({ queryKey: taskKeys.detail(task.id) });
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete chat.");
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (project: ProjectsResult[number]) =>
      deleteProject({
        data: {
          projectId: project.id,
          projectName: deleteProjectNameConfirmation,
        },
      }),
    onSuccess: async (_, deletedProject) => {
      const nextProject = projects.find((project) => project.id !== deletedProject.id);

      setProjectToDelete(null);
      setDeleteProjectNameConfirmation("");
      toast.success("Project deleted.");

      if (selectedProject?.id === deletedProject.id) {
        await navigate({
          to: "/app",
          search: nextProject ? { projectId: nextProject.id } : {},
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskKeys.all }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete project.");
    },
  });

  const initials = (user.name ?? user.email ?? "?").slice(0, 1).toUpperCase();

  const isOrgActive = pathname === "/app/organisation";
  const isSettingsActive = pathname === "/app/settings";

  const handleOpenCreateProject = () => {
    setCreateProjectSearch("");
    setCreateProjectRepoId("");
    setCreateProjectName("");
    setCreateProjectOpen(true);
  };

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <svg
            className="size-5 shrink-0 text-sidebar-foreground"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
          </svg>
          <span className="text-sm font-semibold tracking-tight">Diabolo</span>
        </div>

        {/* Main scrollable nav */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Project selector */}
          <div className="flex items-center gap-1.5 px-3 pt-1 pb-2">
            <DropdownMenu open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
              <DropdownMenuTrigger
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/30 px-3 py-2 text-sm transition-colors outline-none",
                  "hover:border-sidebar-border hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                )}
              >
                {projectsQuery.isPending && !selectedProject ? (
                  <span className="h-4 w-24 animate-pulse rounded-full bg-sidebar-accent/60" />
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-left font-medium text-sidebar-foreground">
                      {selectedProject?.name ?? (hasProjects ? "Select project" : "Create project")}
                    </span>
                    {selectedRunningCount > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                        <ZapIcon className="size-2.5" aria-hidden="true" />
                        {selectedRunningCount}
                      </span>
                    ) : null}
                    <ChevronsUpDownIcon
                      className="size-3.5 shrink-0 text-sidebar-foreground/40"
                      aria-hidden="true"
                    />
                  </>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Projects</DropdownMenuLabel>
                  {projects.map((project) => (
                    <div key={project.id} className="flex items-center gap-0.5">
                      <DropdownMenuItem
                        className="min-w-0 flex-1"
                        onClick={() => {
                          navigate({ to: "/app", search: { projectId: project.id } });
                          setProjectPickerOpen(false);
                        }}
                      >
                        <CheckIcon
                          className={cn(
                            "size-3.5 shrink-0",
                            project.id === selectedProject?.id
                              ? "text-foreground"
                              : "text-transparent",
                          )}
                        />
                        <span className="truncate">{project.name}</span>
                      </DropdownMenuItem>
                      <button
                        type="button"
                        className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={`Delete ${project.name}`}
                        title={`Delete ${project.name}`}
                        onClick={() => {
                          setProjectPickerOpen(false);
                          setDeleteProjectNameConfirmation("");
                          setProjectToDelete(project);
                        }}
                      >
                        <Trash2Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {projects.length === 0 && (
                    <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setProjectPickerOpen(false);
                    handleOpenCreateProject();
                  }}
                >
                  <PlusIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  New project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={handleOpenCreateProject}
              className="flex size-9 shrink-0 items-center justify-center rounded-2xl border border-sidebar-border/70 text-sidebar-foreground/50 transition-colors hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="New project"
              title="New project"
            >
              <PlusIcon className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Dashboard link */}
          {selectedProject ? (
            <div className="space-y-0.5 px-3 pb-3">
              <Link
                to="/app"
                search={{ projectId: selectedProject.id }}
                className={navLinkClass(
                  pathname === "/app" && currentProjectId === selectedProject.id,
                )}
              >
                <LayoutDashboardIcon className="size-4 shrink-0" aria-hidden="true" />
                Dashboard
              </Link>
              <Link
                to="/app/project-settings"
                search={{ projectId: selectedProject.id }}
                className={navLinkClass(
                  pathname === "/app/project-settings" && currentProjectId === selectedProject.id,
                )}
              >
                <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
                Project settings
              </Link>
            </div>
          ) : null}

          <Separator className="mx-3 w-auto bg-sidebar-border/70" />

          {/* Task list for selected project */}
          <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-3" aria-label="Sessions">
            <p className="px-3 pb-1.5 text-[0.6875rem] font-medium tracking-wider text-sidebar-foreground/40 uppercase">
              Recent sessions
            </p>
            {projectsQuery.isPending && projects.length === 0 ? (
              <div className="space-y-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-9 animate-pulse rounded-2xl bg-sidebar-accent/60"
                    aria-hidden="true"
                  />
                ))}
              </div>
            ) : !selectedProject ? (
              <p className="px-3 py-2 text-xs text-sidebar-foreground/40">No projects yet.</p>
            ) : selectedProjectTasks.length === 0 ? (
              <p className="px-3 py-2 text-xs text-sidebar-foreground/40">No sessions yet.</p>
            ) : (
              <div className="space-y-0.5">
                {selectedProjectTasks.map((task) => {
                  const isActiveTask = task.id === currentTaskId;
                  const isRunning = isTaskActive(task);
                  const isStopping =
                    stopTaskMutation.isPending && stopTaskMutation.variables.id === task.id;

                  return (
                    <div key={task.id} className="group relative">
                      <Link
                        to="/app/tasks/$taskId"
                        params={{ taskId: task.id }}
                        search={{ projectId: task.projectId }}
                        className={cn(
                          "flex items-center gap-2 rounded-2xl py-2 pr-9 pl-3 text-sm transition-colors outline-none",
                          "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          isActiveTask
                            ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                          isRunning && "task-glint bg-sidebar-accent/40",
                        )}
                      >
                        {isRunning ? (
                          <span
                            className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          {task.promptPreview || "Untitled task"}
                        </span>
                        {isRunning ? <span className="sr-only">(running)</span> : null}
                      </Link>
                      {isRunning ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full text-sidebar-foreground/60 hover:bg-destructive/15 hover:text-destructive"
                          disabled={isStopping}
                          onClick={() => stopTaskMutation.mutate(task)}
                          aria-label={`Stop ${task.promptPreview || "untitled task"} and destroy its sandbox`}
                          title="Stop task and destroy sandbox"
                        >
                          {isStopping ? (
                            <LoaderIcon className="size-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <SquareIcon className="size-3 fill-current" aria-hidden="true" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full text-sidebar-foreground/40 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100"
                          disabled={deleteTaskMutation.isPending}
                          onClick={() => setTaskToDelete(task)}
                          aria-label={`Delete ${task.promptPreview || "untitled chat"}`}
                        >
                          {deleteTaskMutation.isPending &&
                          deleteTaskMutation.variables.id === task.id ? (
                            <LoaderIcon className="size-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2Icon className="size-3" aria-hidden="true" />
                          )}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* All sessions link pinned to bottom */}
            {selectedProject ? (
              <div className="mt-auto pt-2">
                <Link
                  to="/app/sessions"
                  search={{ projectId: selectedProject.id }}
                  className="flex items-center gap-2 rounded-2xl px-3 py-2 text-xs text-sidebar-foreground/45 transition-colors outline-none hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <HistoryIcon className="size-3.5" aria-hidden="true" />
                  All sessions
                </Link>
              </div>
            ) : null}
          </nav>

          {/* Bottom nav */}
          <div className="border-t border-sidebar-border/70 px-3 py-3">
            <nav className="space-y-0.5" aria-label="App navigation">
              <Link to="/app/organisation" className={navLinkClass(isOrgActive)}>
                <BuildingIcon className="size-4 shrink-0" aria-hidden="true" />
                Organisation
              </Link>
              <Link
                to="/app/settings"
                search={selectedProject ? { projectId: selectedProject.id } : {}}
                className={navLinkClass(isSettingsActive)}
              >
                <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
                Settings
              </Link>
            </nav>
          </div>

          {/* User section */}
          <div className="border-t border-sidebar-border/70 px-3 py-3">
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl px-2 py-2 text-sm transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <Avatar className="size-7 shrink-0 border border-sidebar-border">
                    {user.image ? <AvatarImage src={user.image} alt={user.name ?? ""} /> : null}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-sidebar-foreground">
                    {user.name ?? user.email}
                  </span>
                  <ChevronsUpDownIcon
                    className="size-3.5 shrink-0 text-sidebar-foreground/40"
                    aria-hidden="true"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
                    <p className="truncate px-3 pb-2 text-sm text-foreground">{user.email}</p>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={async () => {
                      await authClient.signOut({
                        fetchOptions: {
                          onResponse: async () => {
                            queryClient.setQueryData(authQueryOptions().queryKey, null);
                            await router.invalidate();
                          },
                        },
                      });
                    }}
                  >
                    <LogOutIcon />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </aside>

      <CreateProjectDialog
        isCreating={createProjectMutation.isPending}
        isPending={createProjectRepoQuery.isPending}
        onCreate={() => createProjectMutation.mutate()}
        onOpenChange={setCreateProjectOpen}
        onProjectNameChange={setCreateProjectName}
        onRepoSearchChange={setCreateProjectSearch}
        onSelectRepo={(repoId, repoFullName) => {
          setCreateProjectRepoId(repoId);
          setCreateProjectName(repoFullName);
        }}
        open={createProjectOpen}
        projectName={createProjectName}
        repoSearch={createProjectSearch}
        repos={repos}
        selectedRepoId={createProjectRepoId}
        selectedRepoName={createProjectRepo?.fullName ?? null}
      />

      <AlertDialog
        open={projectToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteProjectMutation.isPending) {
            setProjectToDelete(null);
            setDeleteProjectNameConfirmation("");
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{projectToDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project and all of its chats. Type the project name to
              confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-project-name-confirmation">Project name</Label>
            <Input
              id="delete-project-name-confirmation"
              value={deleteProjectNameConfirmation}
              onChange={(event) => setDeleteProjectNameConfirmation(event.target.value)}
              placeholder={projectToDelete?.name ?? ""}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProjectMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                !projectToDelete ||
                deleteProjectMutation.isPending ||
                deleteProjectNameConfirmation !== projectToDelete.name
              }
              onClick={() => {
                if (projectToDelete) deleteProjectMutation.mutate(projectToDelete);
              }}
            >
              {deleteProjectMutation.isPending ? (
                <>
                  <LoaderIcon className="size-4 animate-spin" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                "Delete project"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={taskToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteTaskMutation.isPending) setTaskToDelete(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{taskToDelete?.promptPreview || "Untitled chat"}” and its
              task data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTaskMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!taskToDelete || deleteTaskMutation.isPending}
              onClick={() => {
                if (taskToDelete) deleteTaskMutation.mutate(taskToDelete);
              }}
            >
              {deleteTaskMutation.isPending ? (
                <>
                  <LoaderIcon className="size-4 animate-spin" aria-hidden="true" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
