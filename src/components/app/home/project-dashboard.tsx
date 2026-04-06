import { Link } from "@tanstack/react-router";
import { BookIcon, PlusIcon, ZapIcon } from "lucide-react";

import { ProjectSettingsDialog } from "@/components/app/project-settings-dialog";
import { Button } from "@/components/ui/button";
import type { ProjectsResult, TaskSummaryResult } from "@/lib/project/queries";

export function ProjectDashboard({
  currentUserId,
  onCreateProject,
  projects,
  repoNamesById,
  runningTasksByProject,
}: {
  currentUserId: string;
  onCreateProject: () => void;
  projects: ProjectsResult;
  repoNamesById: Map<string, string>;
  runningTasksByProject: Map<string, TaskSummaryResult[]>;
}) {
  if (projects.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="flex max-w-md flex-col items-center gap-5 text-center">
          <div className="space-y-2">
            <p className="text-sm tracking-[0.24em] text-muted-foreground/55 uppercase">
              Workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Start by creating a project
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Connect a repository to open the chat workspace and track its sessions.
            </p>
          </div>
          <Button onClick={onCreateProject} size="lg">
            <PlusIcon aria-hidden="true" />
            Create project
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-auto px-4 pt-8 pb-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        {/* Header */}
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs tracking-[0.22em] text-muted-foreground/50 uppercase">Projects</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Choose a project
            </h1>
          </div>
          <Button onClick={onCreateProject} variant="outline" size="sm">
            <PlusIcon aria-hidden="true" />
            New project
          </Button>
        </div>

        {/* Grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => {
            const repoName = repoNamesById.get(project.repoId) ?? project.repoId;
            const runningTasks = runningTasksByProject.get(project.id) ?? [];
            const hasRunning = runningTasks.length > 0;

            return (
              <div key={project.id} className="group relative">
                <Link
                  to="/app"
                  search={{ projectId: project.id }}
                  className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold tracking-tight text-foreground">
                          {project.name}
                        </h2>
                        {project.sharedWithOrgId ? (
                          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                            Org
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <BookIcon className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{repoName}</span>
                      </div>
                    </div>

                    {/* Running tasks badge */}
                    {hasRunning ? (
                      <div className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <ZapIcon className="size-3" aria-hidden="true" />
                        {runningTasks.length}
                      </div>
                    ) : null}
                  </div>

                  {/* Running task previews */}
                  {hasRunning ? (
                    <div className="mt-4 space-y-1.5 border-t border-border/60 pt-4">
                      {runningTasks.slice(0, 2).map((task) => (
                        <div key={task.id} className="rounded-lg bg-muted/50 px-3 py-2">
                          <p className="truncate text-xs font-medium text-foreground/80">
                            {task.promptPreview}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                            {task.runningSummaryLine}
                          </p>
                        </div>
                      ))}
                      {runningTasks.length > 2 ? (
                        <p className="px-1 text-xs text-muted-foreground">
                          +{runningTasks.length - 2} more running
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </Link>

                {/* Action buttons — shown on hover */}
                <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <ProjectSettingsDialog
                    currentUserId={currentUserId}
                    projectId={project.id}
                    projectName={project.name}
                    onTriggerClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
