import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import { BranchSelector } from "@/components/app/home/branch-selector";
import { CreateProjectDialog } from "@/components/app/home/create-project-dialog";
import { ProjectSelector } from "@/components/app/home/project-selector";
import { RunningTasksPanel } from "@/components/app/home/running-tasks-panel";
import { PromptComposer } from "@/components/app/prompt-composer";
import { Button } from "@/components/ui/button";
import { githubBranchesQueryOptions, githubReposQueryOptions } from "@/lib/github/queries";
import { $createProject, $createTask } from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectDetailQueryOptions,
  projectKeys,
  type TaskSummaryResult,
  taskKeys,
} from "@/lib/project/queries";

type AppHomeSearch = {
  branch?: string;
  projectId?: string;
};

export const Route = createFileRoute("/_auth/app/")({
  validateSearch: (search): AppHomeSearch => ({
    branch: typeof search.branch === "string" ? search.branch : undefined,
    projectId: typeof search.projectId === "string" ? search.projectId : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!search.projectId) {
      throw redirect({ to: "/app/projects" });
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      ...allUserTaskSummariesQueryOptions(context.user.id),
      revalidateIfStale: true,
    });
  },
  component: AppHome,
});

function AppHome() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const createProject = useServerFn($createProject);
  const createTask = useServerFn($createTask);
  const setHeaderSlots = useSetHeaderSlots();

  const greeting = getGreeting();
  const firstName = user.name?.split(" ")[0] ?? user.name ?? "there";
  const dateString = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [inputValue, setInputValue] = useState("");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectSearch, setCreateProjectSearch] = useState("");
  const [createProjectRepoId, setCreateProjectRepoId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");

  const currentProjectId = search.projectId ?? "";
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

  const currentProjectDetailQuery = useQuery({
    ...projectDetailQueryOptions(currentProjectId),
    enabled: Boolean(currentProjectId),
  });
  const currentProject = currentProjectDetailQuery.data ?? null;
  const projectLabel = currentProject?.name ?? "Select project";
  const currentProjectRepoFullName = currentProject?.repoFullName ?? null;
  const currentProjectDefaultBranch = currentProject?.repoDefaultBranch ?? "main";
  const currentBranch = search.branch || currentProjectDefaultBranch;

  const branchesQuery = useQuery({
    ...githubBranchesQueryOptions(user.id, currentProjectRepoFullName ?? ""),
    enabled: Boolean(currentProjectRepoFullName),
  });

  const createProjectRepoQuery = useQuery({
    ...githubReposQueryOptions(user.id),
    enabled: createProjectOpen,
  });
  const repos = createProjectRepoQuery.data ?? [];
  const createProjectRepo = repos.find((repo) => repo.id === createProjectRepoId) ?? null;

  const runningTasks = (recentTasksQuery.data ?? []).filter(
    (task) => task.status === "queued" || task.status === "running" || task.hasActiveChildren,
  );
  const currentProjectRunningTasks = runningTasks.filter(
    (task) => task.projectId === currentProjectId,
  );

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
      setCreateProjectOpen(false);
      setCreateProjectSearch("");
      setCreateProjectRepoId("");
      setCreateProjectName("");
      navigate({ search: { branch: undefined, projectId: project.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create project.");
    },
  });

  const taskMutation = useMutation({
    mutationFn: async (data: { prompt: string; sourceBranch: string }) => {
      if (!currentProject) {
        throw new Error("Select a project first.");
      }

      return createTask({
        data: {
          projectId: currentProject.id,
          prompt: data.prompt,
          sourceBranch: data.sourceBranch,
        },
      });
    },
    onSuccess: async (newTask) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all });
      toast.success("Background task started.");
      setInputValue("");
      navigate({ to: "/app/tasks/$taskId", params: { taskId: newTask.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start task.");
    },
  });

  const canSubmit =
    inputValue.trim().length >= 1 && Boolean(currentProjectId) && !taskMutation.isPending;

  useEffect(() => {
    setHeaderSlots({
      left: null,
      projectId: currentProjectId,
      projectName: currentProject?.name ?? null,
      right: (
        <Button
          render={<Link to="/app/projects" search={{}} />}
          variant="ghost"
          size="sm"
          nativeButton={false}
        >
          Back to home screen
        </Button>
      ),
    });
    return () => setHeaderSlots({ left: null, projectId: null, projectName: null, right: null });
  }, [currentProject?.name, currentProjectId, setHeaderSlots]);

  const handleSelectBranch = (branch: string) => {
    navigate({
      search: (prev) => ({ ...prev, branch }),
    });
  };

  const handleSubmit = () => {
    if (!canSubmit || !currentProject) {
      return;
    }

    taskMutation.mutate({
      prompt: inputValue.trim(),
      sourceBranch: currentBranch,
    });
  };

  return (
    <>
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-48">
        <div className="flex w-full max-w-3xl flex-col items-center text-center">
          <p className="mb-3 text-sm text-muted-foreground/60">{dateString}</p>
          <h1 className="mb-10 font-serif text-[2.75rem] leading-tight tracking-tight text-muted-foreground/70">
            {greeting}, <span className="text-foreground">{firstName}</span>
          </h1>
          <RunningTasksPanel tasks={currentProjectRunningTasks} />
        </div>
      </main>

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
              <ProjectSelector
                onCreateProject={() => setCreateProjectOpen(true)}
                onSelectProject={(projectId) =>
                  navigate({ search: { branch: undefined, projectId } })
                }
                projectLabel={projectLabel}
                projects={currentProject ? [currentProject] : []}
              />
              <BranchSelector
                branches={branchesQuery.data ?? []}
                currentBranch={currentBranch}
                disabled={!currentProject}
                isPending={branchesQuery.isPending}
                onSelectBranch={handleSelectBranch}
              />
            </>
          }
        />
      </div>

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

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
