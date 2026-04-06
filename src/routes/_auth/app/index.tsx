import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GitBranchIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BranchSelector } from "@/components/app/home/branch-selector";
import { ProviderSelector } from "@/components/app/home/provider-selector";
import { RunningTasksPanel } from "@/components/app/home/running-tasks-panel";
import { ScheduledTasksSection } from "@/components/app/home/scheduled-tasks-section";
import { ProjectSettingsDialog } from "@/components/app/project-settings-dialog";
import { PromptComposer } from "@/components/app/prompt-composer";
import { githubBranchesQueryOptions } from "@/lib/github/queries";
import {
  allUserTaskSummariesQueryOptions,
  projectDetailQueryOptions,
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

  const [inputValue, setInputValue] = useState("");
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
  const currentProjectRepoFullName = currentProject?.repoFullName ?? null;
  const currentProjectDefaultBranch = currentProject?.repoDefaultBranch ?? "main";
  const currentBranch = search.branch || currentProjectDefaultBranch;

  const branchesQuery = useQuery({
    ...githubBranchesQueryOptions(user.id, currentProjectRepoFullName ?? ""),
    enabled: Boolean(currentProjectRepoFullName),
  });

  const providerQuery = useQuery(userLlmProvidersQueryOptions());
  const providers = providerQuery.data ?? [];
  const isProvidersLoading = providerQuery.isPending && !providerQuery.isFetched;
  const defaultProviderId =
    providers.find((provider) => provider.isDefault)?.id ?? providers[0]?.id ?? null;
  const effectiveProviderId =
    selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)
      ? selectedProviderId
      : defaultProviderId;

  const currentProjectRunningTasks = (recentTasksQuery.data ?? []).filter(
    (task) =>
      task.projectId === currentProjectId &&
      (task.status === "queued" || task.status === "running" || task.hasActiveChildren),
  );

  const taskMutation = useMutation({
    mutationFn: async (data: {
      attachments: File[];
      prompt: string;
      providerId: string;
      sourceBranch: string;
    }) => {
      if (!currentProject) throw new Error("Select a project first.");

      const formData = new FormData();
      formData.set("projectId", currentProject.id);
      formData.set("prompt", data.prompt);
      formData.set("providerId", data.providerId);
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

  const handleSelectBranch = (branch: string) => {
    navigate({ search: (prev) => ({ ...prev, branch }) });
  };

  const handleSubmit = () => {
    if (!canSubmit || !currentProject || !effectiveProviderId) return;

    taskMutation.mutate({
      attachments: attachments.map((a) => a.file),
      prompt: inputValue.trim(),
      providerId: effectiveProviderId,
      sourceBranch: currentBranch,
    });
  };

  // No project selected — show a welcome state
  if (!currentProjectId) {
    return (
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
            <h1 className="text-base font-semibold text-foreground">Select a project</h1>
            <p className="text-sm text-muted-foreground">
              Choose a project from the sidebar to start a task.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      {/* Page header */}
      {currentProject ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {currentProject.name}
            </span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
              <GitBranchIcon className="size-3" aria-hidden="true" />
              <span>{currentBranch}</span>
            </div>
          </div>
          <ProjectSettingsDialog
            currentUserId={user.id}
            disabled={false}
            projectId={currentProject.id}
            projectName={currentProject.name}
          />
        </div>
      ) : null}

      {/* Main content */}
      <main className="flex flex-1 flex-col items-center overflow-y-auto px-6 pt-8 pb-48">
        <div className="w-full max-w-3xl space-y-8">
          <Greeting name={user.name ?? user.email ?? "friend"} />
          <RunningTasksPanel tasks={currentProjectRunningTasks} />
          {currentProject ? (
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
      </div>
    </>
  );
}

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  const firstName = name.split(" ")[0];

  if (hour >= 5 && hour < 12) {
    const lines = [
      `Rise and shine, ${firstName}.`,
      `Good morning, ${firstName}. Coffee's hot, backlog's not.`,
      `Morning, ${firstName}. Your future self thanks you for starting early.`,
      `Up with the sun, ${firstName}? Respect. Let's ship something.`,
    ];
    return lines[new Date().getDate() % lines.length];
  }

  if (hour >= 12 && hour < 17) {
    const lines = [
      `Afternoon, ${firstName}. Lunch was a myth, but this task is real.`,
      `Good afternoon, ${firstName}. The standup is over, the work begins.`,
      `Hey ${firstName}, it's that post-lunch window where great code gets written. Probably.`,
      `${firstName}, it's afternoon. Time to pretend the morning was just warmup.`,
    ];
    return lines[new Date().getDate() % lines.length];
  }

  if (hour >= 17 && hour < 21) {
    const lines = [
      `Evening, ${firstName}. One more thing before you close the laptop… right?`,
      `Hey ${firstName}, the day shift is done. You're the last one standing.`,
      `Good evening, ${firstName}. Dinner can wait. Deployments cannot.`,
      `${firstName}, it's evening. The best engineers ship after 5pm. (Citation needed.)`,
    ];
    return lines[new Date().getDate() % lines.length];
  }

  const lines = [
    `${firstName}, it's late. The bugs are asleep. You should be too.`,
    `Burning the midnight oil, ${firstName}?`,
    `Night mode activated, ${firstName}. No one's watching. Ship it.`,
    `${firstName}, it's the middle of the night. Either you're very dedicated or very stuck.`,
  ];
  return lines[new Date().getDate() % lines.length];
}

function Greeting({ name }: { name: string }) {
  return (
    <div className="text-center">
      <h2 className="text-2xl font-semibold text-foreground">{getGreeting(name)}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">Here&apos;s what&apos;s going on.</p>
    </div>
  );
}
