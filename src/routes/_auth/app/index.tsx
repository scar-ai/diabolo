import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRightIcon, HouseIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import { BranchSelector } from "@/components/app/home/branch-selector";
import { CreateProjectDialog } from "@/components/app/home/create-project-dialog";
import { ProjectSelector } from "@/components/app/home/project-selector";
import { ProviderSelector } from "@/components/app/home/provider-selector";
import { RunningTasksPanel } from "@/components/app/home/running-tasks-panel";
import { PromptComposer } from "@/components/app/prompt-composer";
import { githubBranchesQueryOptions, githubReposQueryOptions } from "@/lib/github/queries";
import { $createProject } from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectDetailQueryOptions,
  projectKeys,
  type TaskSummaryResult,
  taskKeys,
} from "@/lib/project/queries";
import { userLlmProvidersQueryOptions } from "@/lib/user/queries";

type PendingAttachment = {
  file: File;
  id: string;
};

type AppHomeSearch = {
  branch?: string;
  projectId?: string;
};

const formatAttachmentSize = (bytes: number) => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

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
  const providerQuery = useQuery(userLlmProvidersQueryOptions());
  const repos = createProjectRepoQuery.data ?? [];
  const createProjectRepo = repos.find((repo) => repo.id === createProjectRepoId) ?? null;
  const providers = providerQuery.data ?? [];
  const isProvidersLoading = providerQuery.isPending && !providerQuery.isFetched;
  const defaultProviderId =
    providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? null;
  const effectiveProviderId =
    selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)
      ? selectedProviderId
      : defaultProviderId;

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
    mutationFn: async (data: {
      attachments: File[];
      prompt: string;
      providerId: string;
      sourceBranch: string;
    }) => {
      if (!currentProject) {
        throw new Error("Select a project first.");
      }

      const formData = new FormData();
      formData.set("projectId", currentProject.id);
      formData.set("prompt", data.prompt);
      formData.set("providerId", data.providerId);
      formData.set("sourceBranch", data.sourceBranch);

      for (const file of data.attachments) {
        formData.append("attachments", file);
      }

      const response = await fetch("/api/tasks/create", {
        body: formData,
        method: "POST",
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "Failed to start task.",
        );
      }

      return payload;
    },
    onSuccess: (newTask) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      toast.success("Background task started.");
      setInputValue("");
      setAttachments([]);
      navigate({ to: "/app/tasks/$taskId", params: { taskId: newTask.id } });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start task.");
    },
  });

  const canSubmit =
    inputValue.trim().length >= 10 &&
    Boolean(currentProjectId) &&
    Boolean(effectiveProviderId) &&
    !taskMutation.isPending;

  useEffect(() => {
    setHeaderSlots({
      left: (
        <nav className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/70 px-4 py-2 text-base">
          <Link
            to="/app/projects"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <HouseIcon className="size-4" />
            Home
          </Link>
          {currentProject?.name ? (
            <>
              <ChevronRightIcon className="size-3.5 text-muted-foreground/40" aria-hidden="true" />
              <span className="font-medium text-foreground">{currentProject.name}</span>
            </>
          ) : null}
        </nav>
      ),
      projectId: currentProjectId,
      projectName: currentProject?.name ?? null,
      right: null,
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
      attachments: attachments.map((attachment) => attachment.file),
      prompt: inputValue.trim(),
      providerId: effectiveProviderId,
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
          attachments={attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.file.name,
            sizeLabel: formatAttachmentSize(attachment.file.size),
          }))}
          value={inputValue}
          onAddAttachments={(files) => {
            setAttachments((current) => [
              ...current,
              ...Array.from(files).map((file) => ({
                file,
                id: crypto.randomUUID(),
              })),
            ]);
          }}
          onChange={setInputValue}
          onRemoveAttachment={(id) =>
            setAttachments((current) => current.filter((attachment) => attachment.id !== id))
          }
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
              <ProviderSelector
                currentProviderId={effectiveProviderId ?? ""}
                disabled={taskMutation.isPending}
                isPending={isProvidersLoading}
                onSelectProvider={setSelectedProviderId}
                providers={providers}
              />
            </>
          }
          note={
            providers.length === 0
              ? "Add a provider in Settings before starting a task."
              : undefined
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

  const morning = [
    "Good morning",
    "Morning",
    "Rise and shine",
    "Hope your morning's going well",
    "Ready to get things done?",
  ];
  const afternoon = [
    "Good afternoon",
    "Afternoon",
    "Hope the day's treating you well",
    "How's the afternoon going?",
    "Making the most of the day?",
  ];
  const evening = [
    "Good evening",
    "Evening",
    "Winding down?",
    "Hope you had a good day",
    "Burning the midnight oil?",
  ];

  const pool = hour < 12 ? morning : hour < 17 ? afternoon : evening;
  return pool[Math.floor(Math.random() * pool.length)];
}
