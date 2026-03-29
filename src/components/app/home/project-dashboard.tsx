import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, LoaderIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { ProjectSettingsDialog } from "@/components/app/project-settings-dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Frame, FramePanel } from "@/components/ui/frame";
import type { ProjectsResult, TaskSummaryResult } from "@/lib/project/queries";

export function ProjectDashboard({
  deletingProjectId,
  onCreateProject,
  onDeleteProject,
  projects,
  repoNamesById,
  runningTasksByProject,
}: {
  deletingProjectId?: string | null;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm tracking-[0.24em] text-muted-foreground/55 uppercase">Projects</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Choose a project
            </h1>
          </div>
          <Button onClick={onCreateProject}>
            <PlusIcon aria-hidden="true" />
            Create project
          </Button>
        </div>

        <div className="grid gap-4">
          {projects.map((project) => {
            const repoName = repoNamesById.get(project.repoId) ?? project.repoId;
            const runningTasks = runningTasksByProject.get(project.id) ?? [];
            const isDeleting = deletingProjectId === project.id;

            return (
              <Link
                key={project.id}
                to="/app"
                search={{ projectId: project.id }}
                className="group rounded-[1.75rem] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Frame className="transition-colors group-hover:bg-muted/88">
                  <FramePanel className="gap-5 p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-2">
                        <div className="space-y-1">
                          <h2 className="text-xl font-semibold tracking-tight text-foreground">
                            {project.name}
                          </h2>
                          <p className="truncate text-sm text-muted-foreground">{repoName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <ProjectSettingsDialog
                          projectId={project.id}
                          projectName={project.name}
                          onTriggerClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        />
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive/75 hover:bg-destructive/10 hover:text-destructive"
                                disabled={isDeleting}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                              />
                            }
                          >
                            <Trash2Icon className="size-4" aria-hidden="true" />
                            <span className="sr-only">Delete project</span>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete project?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This permanently removes {project.name} and its sessions.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                              <AlertDialogClose
                                variant="destructive"
                                disabled={isDeleting}
                                onClick={() => onDeleteProject(project.id)}
                              >
                                {isDeleting ? (
                                  <LoaderIcon
                                    className="size-3.5 animate-spin"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  "Delete"
                                )}
                              </AlertDialogClose>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                          Open
                          <ArrowRightIcon className="size-4" aria-hidden="true" />
                        </div>
                      </div>
                    </div>

                    {runningTasks.length > 0 ? (
                      <div className="space-y-3 border-t border-border/60 pt-4">
                        <div className="text-xs font-medium tracking-[0.22em] text-muted-foreground/60 uppercase">
                          Running tasks ({runningTasks.length})
                        </div>
                        <div className="space-y-2">
                          {runningTasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-2xl border border-border/70 bg-muted/35 px-4 py-3"
                            >
                              <div className="truncate text-sm font-medium text-foreground">
                                {task.promptPreview}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground/65">
                                {task.runningSummaryLine}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </FramePanel>
                </Frame>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
