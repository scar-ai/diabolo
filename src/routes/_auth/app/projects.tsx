import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftIcon, HouseIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import { CreateProjectForm } from "@/components/app/home/create-project-form";
import { ProjectDashboard } from "@/components/app/home/project-dashboard";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel } from "@/components/ui/frame";
import { githubReposQueryOptions } from "@/lib/github/queries";
import { $createProject, $deleteProject } from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectKeys,
  projectsQueryOptions,
  type TaskSummaryResult,
  taskKeys,
} from "@/lib/project/queries";

type ProjectsSearch = {
  view?: "create-project";
};

export const Route = createFileRoute("/_auth/app/projects")({
  validateSearch: (search): ProjectsSearch => ({
    view: search.view === "create-project" ? "create-project" : undefined,
  }),
  loader: async ({ context }) => {
    const userId = context.user.id;
    await Promise.all([
      context.queryClient.ensureQueryData({
        ...projectsQueryOptions(userId),
        revalidateIfStale: true,
      }),
      context.queryClient.ensureQueryData({
        ...allUserTaskSummariesQueryOptions(userId),
        revalidateIfStale: true,
      }),
    ]);
  },
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createProject = useServerFn($createProject);
  const deleteProject = useServerFn($deleteProject);
  const setHeaderSlots = useSetHeaderSlots();
  const isCreateProjectView = search.view === "create-project";

  const [createProjectSearch, setCreateProjectSearch] = useState("");
  const [createProjectRepoId, setCreateProjectRepoId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");

  const projectsQuery = useQuery(projectsQueryOptions(user.id));
  const recentTasksQuery = useQuery({
    ...allUserTaskSummariesQueryOptions(user.id),
    refetchInterval: (query) => {
      const tasks = (query.state.data ?? []) as TaskSummaryResult[];
      return tasks.some(
        (task) => task.status === "queued" || task.status === "running" || task.hasActiveChildren,
      )
        ? 2_000
        : 10_000;
    },
  });
  const createProjectRepoQuery = useQuery({
    ...githubReposQueryOptions(user.id),
  });

  const projects = projectsQuery.data ?? [];
  const repos = createProjectRepoQuery.data ?? [];
  const createProjectRepo = repos.find((repo) => repo.id === createProjectRepoId) ?? null;
  const repoNamesById = new Map(repos.map((repo) => [repo.id, repo.fullName]));
  const runningTasks = (recentTasksQuery.data ?? []).filter(
    (task) => task.status === "queued" || task.status === "running" || task.hasActiveChildren,
  );
  const runningTasksByProject = new Map<string, TaskSummaryResult[]>();

  for (const task of runningTasks) {
    const bucket = runningTasksByProject.get(task.projectId) ?? [];
    bucket.push(task);
    runningTasksByProject.set(task.projectId, bucket);
  }

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
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
      toast.success("Project created.");
      setCreateProjectSearch("");
      setCreateProjectRepoId("");
      setCreateProjectName("");
      navigate({ to: "/app", search: { branch: undefined, projectId: project.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create project.");
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (projectId: string) => deleteProject({ data: { projectId } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.all }),
        queryClient.invalidateQueries({ queryKey: taskKeys.all }),
      ]);
      toast.success("Project deleted.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete project.");
    },
  });

  useEffect(() => {
    setHeaderSlots({
      left: (
        <nav className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/70 px-4 py-2 text-base">
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <HouseIcon className="size-4" />
            Home
          </span>
        </nav>
      ),
      projectId: null,
      projectName: null,
      right: null,
    });
    return () => setHeaderSlots({ left: null, projectId: null, projectName: null, right: null });
  }, [setHeaderSlots]);

  const handleOpenCreateProject = () => {
    setCreateProjectSearch("");
    setCreateProjectRepoId("");
    setCreateProjectName("");
    navigate({ to: "/app/projects", search: { view: "create-project" } });
  };

  const handleCancelCreateProject = () => {
    navigate({ to: "/app/projects", search: {} });
  };

  if (isCreateProjectView) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Frame className="w-full max-w-3xl">
          <FramePanel className="p-6 sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-sm tracking-[0.24em] text-muted-foreground/55 uppercase">
                  New project
                </p>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  Create project
                </h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  Search your GitHub repositories, then bind one to a new project.
                </p>
              </div>
              <Button
                render={<Link to="/app/projects" search={{}} />}
                variant="ghost"
                size="sm"
                nativeButton={false}
              >
                <ArrowLeftIcon aria-hidden="true" />
                Back
              </Button>
            </div>

            <CreateProjectForm
              isPending={createProjectRepoQuery.isPending}
              onProjectNameChange={setCreateProjectName}
              onRepoSearchChange={setCreateProjectSearch}
              onSelectRepo={(repoId, repoFullName) => {
                setCreateProjectRepoId(repoId);
                setCreateProjectName(repoFullName);
              }}
              projectName={createProjectName}
              repoSearch={createProjectSearch}
              repos={repos}
              selectedRepoId={createProjectRepoId}
              selectedRepoName={createProjectRepo?.fullName ?? null}
            />

            <div className="mt-8 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={handleCancelCreateProject}>
                Cancel
              </Button>
              <Button
                disabled={!createProjectRepo?.fullName || createProjectMutation.isPending}
                onClick={() => createProjectMutation.mutate()}
              >
                {createProjectMutation.isPending ? (
                  "Creating..."
                ) : (
                  <>
                    <PlusIcon aria-hidden="true" />
                    Create project
                  </>
                )}
              </Button>
            </div>
          </FramePanel>
        </Frame>
      </main>
    );
  }

  return (
    <ProjectDashboard
      currentUserId={user.id}
      deletingProjectId={deleteProjectMutation.isPending ? deleteProjectMutation.variables : null}
      onCreateProject={handleOpenCreateProject}
      onDeleteProject={(projectId) => deleteProjectMutation.mutate(projectId)}
      projects={projects}
      repoNamesById={repoNamesById}
      runningTasksByProject={runningTasksByProject}
    />
  );
}
