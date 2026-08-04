import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { GitBranchIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useClientNow } from "@/components/app/client-time";
import { BranchSelector } from "@/components/app/home/branch-selector";
import { CreateProjectDialog } from "@/components/app/home/create-project-dialog";
import { ProviderSelector } from "@/components/app/home/provider-selector";
import { RunningTasksPanel } from "@/components/app/home/running-tasks-panel";
import { SandboxSelector, useSandboxTier } from "@/components/app/home/sandbox-selector";
import { ScheduledTasksSection } from "@/components/app/home/scheduled-tasks-section";
import { PromptComposer } from "@/components/app/prompt-composer";
import { ReasoningEffortSelector } from "@/components/app/reasoning-effort-selector";
import { Button } from "@/components/ui/button";
import { $createGithubBranch } from "@/lib/github/functions";
import { githubBranchesQueryOptions, githubReposQueryOptions } from "@/lib/github/queries";
import { modelSupportsReasoningEffort, type ReasoningEffort } from "@/lib/models/reasoning-effort";
import { $createProject } from "@/lib/project/functions";
import {
  allUserTaskSummariesQueryOptions,
  projectDetailQueryOptions,
  projectKeys,
  projectsQueryOptions,
  projectScheduledTasksQueryOptions,
  type TaskSummaryResult,
  taskKeys,
} from "@/lib/project/queries";
import type { SandboxTierId } from "@/lib/sandbox/tiers";
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
  loaderDeps: ({ search }) => ({ projectId: search.projectId }),
  loader: ({ context, deps }) => {
    if (deps.projectId) {
      context.queryClient.prefetchQuery(projectDetailQueryOptions(deps.projectId));
      context.queryClient.prefetchQuery(projectScheduledTasksQueryOptions(deps.projectId));
    }
  },
  component: AppHome,
});

function AppHome() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const createProject = useServerFn($createProject);
  const createGithubBranch = useServerFn($createGithubBranch);

  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectSearch, setCreateProjectSearch] = useState("");
  const [createProjectRepoId, setCreateProjectRepoId] = useState("");
  const [createProjectName, setCreateProjectName] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | null>(null);
  const [sandboxTier, setSandboxTier] = useSandboxTier();

  const currentProjectId = search.projectId ?? "";
  const projectsQuery = useQuery(projectsQueryOptions(user.id));
  const projects = projectsQuery.data ?? [];
  const hasProjects = projects.length > 0;

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

  const providerQuery = useQuery(userLlmProvidersQueryOptions());
  const providers = providerQuery.data ?? [];
  const isProvidersLoading = providerQuery.isPending && !providerQuery.isFetched;
  const defaultProviderId =
    providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? null;
  const effectiveProviderId =
    selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)
      ? selectedProviderId
      : defaultProviderId;
  const selectedProvider =
    providers.find((provider) => provider.id === effectiveProviderId) ?? null;
  const selectedModel = selectedProvider?.providerModel ?? "";
  const supportsReasoningEffort = Boolean(
    selectedModel && modelSupportsReasoningEffort(selectedModel),
  );

  const currentProjectRunningTasks = (recentTasksQuery.data ?? []).filter(
    (task) =>
      task.projectId === currentProjectId &&
      (task.status === "queued" || task.status === "running" || task.hasActiveChildren),
  );

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

  const taskMutation = useMutation({
    mutationFn: async (data: {
      attachments: File[];
      prompt: string;
      providerId: string;
      reasoningEffort: ReasoningEffort | null;
      sandboxTier: SandboxTierId;
      sourceBranch: string;
    }) => {
      if (!currentProject)
        throw new Error(hasProjects ? "Select a project first." : "Create a project first.");

      const formData = new FormData();
      formData.set("projectId", currentProject.id);
      formData.set("prompt", data.prompt);
      formData.set("providerId", data.providerId);
      if (data.reasoningEffort) {
        formData.set("reasoningEffort", data.reasoningEffort);
      }
      formData.set("sandboxTier", data.sandboxTier);
      formData.set("sourceBranch", data.sourceBranch);

      for (const file of data.attachments) {
        formData.append("attachments", file);
      }

      const response = await fetch("/api/tasks/create", { body: formData, method: "POST" });
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
      toast.success("Task started.");
      setInputValue("");
      setAttachments([]);
      navigate({
        to: "/app/tasks/$taskId",
        params: { taskId: newTask.id },
        search: { projectId: currentProjectId },
      });
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

  const handleSelectBranch = (branch: string) => {
    navigate({ search: (prev) => ({ ...prev, branch }) });
  };

  const createBranchMutation = useMutation({
    mutationFn: async (branchName: string) => {
      if (!currentProjectRepoFullName) {
        throw new Error("Select a project first.");
      }

      return createGithubBranch({
        data: {
          branchName,
          fromBranch: currentBranch,
          repoFullName: currentProjectRepoFullName,
        },
      });
    },
    onSuccess: async (branch) => {
      await queryClient.invalidateQueries({
        queryKey: ["github-branches", user.id, currentProjectRepoFullName],
      });
      handleSelectBranch(branch.name);
      toast.success(`Created branch ${branch.name}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create branch.");
    },
  });

  const handleSubmit = () => {
    if (!canSubmit || !currentProject || !effectiveProviderId) return;

    taskMutation.mutate({
      attachments: attachments.map((a) => a.file),
      prompt: inputValue.trim(),
      providerId: effectiveProviderId,
      reasoningEffort: supportsReasoningEffort ? reasoningEffort : null,
      sandboxTier,
      sourceBranch: currentBranch,
    });
  };

  const handleOpenCreateProject = () => {
    setCreateProjectSearch("");
    setCreateProjectRepoId("");
    setCreateProjectName("");
    setCreateProjectOpen(true);
  };

  // No project selected — show a welcome state
  if (!currentProjectId) {
    return (
      <>
        <main className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
              <svg
                className="size-6 text-muted-foreground/50"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
              </svg>
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-foreground">
                {hasProjects ? "Select a project" : "Create a project"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {hasProjects
                  ? "Choose a project from the sidebar to start a task."
                  : "Create a project to start a task."}
              </p>
            </div>
            {!hasProjects ? (
              <Button onClick={handleOpenCreateProject}>
                <PlusIcon aria-hidden="true" />
                Create project
              </Button>
            ) : null}
          </div>
        </main>

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

  const isProjectLoading = currentProjectDetailQuery.isPending && Boolean(currentProjectId);

  return (
    <>
      {/* Page header */}
      <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-6">
        {isProjectLoading ? (
          <div className="h-4 w-36 animate-pulse rounded bg-muted" />
        ) : currentProject ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-medium text-foreground">
              {currentProject.name}
            </span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <GitBranchIcon className="size-3" aria-hidden="true" />
              <span>{currentBranch}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Main content */}
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 pt-8 pb-48">
        <div className="w-full max-w-3xl space-y-8">
          <Greeting name={user.name ?? user.email ?? "friend"} />
          <RunningTasksPanel projectId={currentProjectId} tasks={currentProjectRunningTasks} />
          {isProjectLoading ? (
            <ScheduledTasksSectionSkeleton />
          ) : currentProject ? (
            <ScheduledTasksSection
              projectDefaultBranch={currentProjectDefaultBranch}
              projectId={currentProject.id}
              providers={providers}
              repoFullName={currentProjectRepoFullName}
              userId={user.id}
            />
          ) : null}
        </div>
      </main>

      {/* Fixed prompt composer */}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-4 pl-[14rem]">
        <div className="pointer-events-auto w-full max-w-3xl">
          <PromptComposer
            attachments={attachments.map((a) => ({
              id: a.id,
              name: a.file.name,
              sizeLabel: formatAttachmentSize(a.file.size),
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
              setAttachments((current) => current.filter((a) => a.id !== id))
            }
            onSubmit={handleSubmit}
            placeholder="Ask anything..."
            canSubmit={canSubmit}
            submitAriaLabel={taskMutation.isPending ? "Starting..." : "Send"}
            footerLeft={
              <>
                <BranchSelector
                  branches={branchesQuery.data ?? []}
                  currentBranch={currentBranch}
                  disabled={!currentProject}
                  isCreating={createBranchMutation.isPending}
                  isPending={branchesQuery.isPending}
                  onCreateBranch={async (branchName) => {
                    await createBranchMutation.mutateAsync(branchName);
                  }}
                  onSelectBranch={handleSelectBranch}
                />
                <ProviderSelector
                  currentProviderId={effectiveProviderId ?? ""}
                  disabled={taskMutation.isPending}
                  isPending={isProvidersLoading}
                  onSelectProvider={setSelectedProviderId}
                  providers={providers}
                />
                <SandboxSelector
                  disabled={taskMutation.isPending}
                  onSelectTier={setSandboxTier}
                  tierId={sandboxTier}
                />
              </>
            }
            footerRight={
              supportsReasoningEffort ? (
                <ReasoningEffortSelector
                  disabled={taskMutation.isPending}
                  onValueChange={setReasoningEffort}
                  value={reasoningEffort}
                />
              ) : undefined
            }
            note={
              providers.length === 0
                ? "Add a provider in Settings before starting a task."
                : undefined
            }
          />
        </div>
      </div>
    </>
  );
}

function getGreeting(name: string, now: Date): string {
  const hour = now.getHours();
  const firstName = name.split(" ")[0];

  if (hour >= 5 && hour < 12) {
    const lines = [
      `Rise and shine, ${firstName}.`,
      `Good morning, ${firstName}. Coffee's hot, backlog's not.`,
      `Morning, ${firstName}. Your future self thanks you for starting early.`,
      `Up with the sun, ${firstName}? Respect. Let's ship something.`,
    ];
    return lines[now.getDate() % lines.length];
  }

  if (hour >= 12 && hour < 17) {
    const lines = [
      `Afternoon, ${firstName}. Lunch was a myth, but this task is real.`,
      `Good afternoon, ${firstName}. The standup is over, the work begins.`,
      `Hey ${firstName}, it's that post-lunch window where great code gets written. Probably.`,
      `${firstName}, it's afternoon. Time to pretend the morning was just warmup.`,
    ];
    return lines[now.getDate() % lines.length];
  }

  if (hour >= 17 && hour < 21) {
    const lines = [
      `Evening, ${firstName}. One more thing before you close the laptop… right?`,
      `Hey ${firstName}, the day shift is done. You're the last one standing.`,
      `Good evening, ${firstName}. Dinner can wait. Deployments cannot.`,
      `${firstName}, it's evening. The best engineers ship after 5pm. (Citation needed.)`,
    ];
    return lines[now.getDate() % lines.length];
  }

  const lines = [
    `${firstName}, it's late. The bugs are asleep. You should be too.`,
    `Burning the midnight oil, ${firstName}?`,
    `Night mode activated, ${firstName}. No one's watching. Ship it.`,
    `${firstName}, it's the middle of the night. Either you're very dedicated or very stuck.`,
  ];
  return lines[now.getDate() % lines.length];
}

function Greeting({ name }: { name: string }) {
  const now = useClientNow();
  const firstName = name.split(" ")[0];

  return (
    <div className="text-center">
      <h2 className="text-2xl font-semibold text-foreground">
        {now ? getGreeting(name, now) : `Hey ${firstName}.`}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">Here&apos;s what&apos;s going on.</p>
    </div>
  );
}

function ScheduledTasksSectionSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
