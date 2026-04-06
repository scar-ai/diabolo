import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BuildingIcon,
  ChevronRightIcon,
  HistoryIcon,
  LogOutIcon,
  PlusIcon,
  SettingsIcon,
  ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CreateProjectDialog } from "@/components/app/home/create-project-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import authClient from "@/lib/auth/auth-client";
import { authQueryOptions } from "@/lib/auth/queries";
import { githubReposQueryOptions } from "@/lib/github/queries";
import { $createProject } from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectKeys,
  projectsQueryOptions,
  type TaskSummaryResult,
} from "@/lib/project/queries";
import { cn } from "@/lib/utils";

type AppUser = {
  email: string;
  id: string;
  image?: string | null;
  name?: string | null;
};

const SESSION_STATUS_DOT: Record<string, string> = {
  queued: "bg-muted-foreground/30",
  running: "animate-pulse bg-emerald-500",
  succeeded: "bg-emerald-500/50",
  failed: "bg-red-500/60",
};

export function AppSidebar({ user }: { user: AppUser }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const createProject = useServerFn($createProject);

  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectSearch, setCreateProjectSearch] = useState("");
  const [createProjectRepoId, setCreateProjectRepoId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

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
      return tasks.some(
        (t) => t.status === "queued" || t.status === "running" || t.hasActiveChildren,
      )
        ? 2_000
        : 10_000;
    },
  });
  const createProjectRepoQuery = useQuery({
    ...githubReposQueryOptions(user.id),
    enabled: createProjectOpen,
  });

  const projects = projectsQuery.data ?? [];
  const repos = createProjectRepoQuery.data ?? [];
  const createProjectRepo = repos.find((repo) => repo.id === createProjectRepoId) ?? null;
  const allTasks = tasksQuery.data ?? [];

  // Group tasks by project (keep insertion order = most recent first from server)
  const tasksByProject = new Map<string, TaskSummaryResult[]>();
  for (const task of allTasks) {
    const bucket = tasksByProject.get(task.projectId) ?? [];
    bucket.push(task);
    tasksByProject.set(task.projectId, bucket);
  }

  // Running task counts per project
  const runningCountByProject = new Map<string, number>();
  for (const task of allTasks) {
    if (task.status === "queued" || task.status === "running" || task.hasActiveChildren) {
      runningCountByProject.set(
        task.projectId,
        (runningCountByProject.get(task.projectId) ?? 0) + 1,
      );
    }
  }

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
      setExpandedProjectIds((prev) => new Set([...prev, project.id]));
      navigate({ to: "/app", search: { projectId: project.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create project.");
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

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  return (
    <>
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        {/* Logo */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
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
          {/* Projects heading */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-[11px] font-medium tracking-widest text-sidebar-foreground/40 uppercase">
              Projects
            </span>
            <button
              type="button"
              onClick={handleOpenCreateProject}
              className="flex size-5 items-center justify-center rounded text-sidebar-foreground/40 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              aria-label="New project"
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Project list */}
          <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Projects">
            {projectsQuery.isPending && projects.length === 0 ? (
              <div className="space-y-1 px-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-8 animate-pulse rounded-lg bg-sidebar-accent/60"
                    aria-hidden="true"
                  />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <p className="px-2 py-2 text-xs text-sidebar-foreground/40">No projects yet.</p>
            ) : (
              <div className="space-y-0.5">
                {projects.map((project) => {
                  const runningCount = runningCountByProject.get(project.id) ?? 0;
                  const isActive =
                    project.id === currentProjectId &&
                    (pathname === "/app" || pathname.startsWith("/app/tasks/"));
                  const isExpanded =
                    expandedProjectIds.has(project.id) ||
                    (project.id === currentProjectId && pathname.startsWith("/app"));
                  const projectTasks = (tasksByProject.get(project.id) ?? []).slice(0, 5);

                  return (
                    <div key={project.id}>
                      {/* Project row */}
                      <div
                        className={cn(
                          "group flex items-center gap-0.5 rounded-lg transition-colors",
                          isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
                        )}
                      >
                        {/* Chevron toggle */}
                        <button
                          type="button"
                          onClick={() => toggleProject(project.id)}
                          className={cn(
                            "flex shrink-0 items-center justify-center rounded p-1 transition-colors",
                            "text-sidebar-foreground/30 outline-none hover:text-sidebar-foreground/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          )}
                          aria-label={isExpanded ? "Collapse project" : "Expand project"}
                        >
                          <ChevronRightIcon
                            className={cn(
                              "size-3 transition-transform duration-150",
                              isExpanded && "rotate-90",
                            )}
                            aria-hidden="true"
                          />
                        </button>

                        {/* Project name link */}
                        <Link
                          to="/app"
                          search={{ projectId: project.id }}
                          onClick={() =>
                            setExpandedProjectIds((prev) => new Set([...prev, project.id]))
                          }
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-sm outline-none",
                            "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                            isActive
                              ? "font-medium text-sidebar-foreground"
                              : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          {runningCount > 0 ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                              <ZapIcon className="size-2.5" aria-hidden="true" />
                              {runningCount}
                            </span>
                          ) : null}
                        </Link>
                      </div>

                      {/* Sessions sub-list */}
                      {isExpanded ? (
                        <div className="mt-0.5 mb-1 space-y-0.5 pl-4">
                          {projectTasks.length === 0 ? (
                            <p className="px-2 py-1 text-[11px] text-sidebar-foreground/30">
                              No sessions yet
                            </p>
                          ) : (
                            projectTasks.map((task) => {
                              const isActiveTask = task.id === currentTaskId;
                              const dotClass =
                                SESSION_STATUS_DOT[task.status] ?? "bg-muted-foreground/30";

                              return (
                                <Link
                                  key={task.id}
                                  to="/app/tasks/$taskId"
                                  params={{ taskId: task.id }}
                                  className={cn(
                                    "flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors outline-none",
                                    "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                                    isActiveTask
                                      ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                                      : "text-sidebar-foreground/50 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                                  )}
                                >
                                  <span
                                    className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
                                    aria-hidden="true"
                                  />
                                  <span className="min-w-0 flex-1 truncate">
                                    {task.promptPreview || "Untitled task"}
                                  </span>
                                </Link>
                              );
                            })
                          )}

                          {/* View all link */}
                          <Link
                            to="/app/sessions"
                            search={{ projectId: project.id }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-sidebar-foreground/30 transition-colors outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          >
                            <HistoryIcon className="size-3" aria-hidden="true" />
                            All sessions
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </nav>

          {/* Bottom nav */}
          <div className="border-t border-sidebar-border px-2 py-3">
            <nav className="space-y-0.5" aria-label="App navigation">
              <Link
                to="/app/organisation"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  isOrgActive
                    ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <BuildingIcon className="size-4 shrink-0" aria-hidden="true" />
                Organisation
              </Link>
              <Link
                to="/app/settings"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  isSettingsActive
                    ? "bg-sidebar-accent font-medium text-sidebar-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
                Settings
              </Link>
            </nav>
          </div>

          {/* User section */}
          <div className="border-t border-sidebar-border px-3 py-3">
            <div className="flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <Avatar className="size-7 shrink-0 border border-sidebar-border">
                    {user.image ? <AvatarImage src={user.image} alt={user.name ?? ""} /> : null}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-sidebar-foreground">
                    {user.name ?? user.email}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
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
              <ThemeToggle />
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
    </>
  );
}
