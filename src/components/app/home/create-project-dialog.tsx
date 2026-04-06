import { CreateProjectForm } from "@/components/app/home/create-project-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GithubReposResult } from "@/lib/github/queries";

export function CreateProjectDialog({
  isCreating,
  isPending,
  onCreate,
  onOpenChange,
  onProjectNameChange,
  onRepoSearchChange,
  onSelectRepo,
  open,
  projectName,
  repoSearch,
  repos,
  selectedRepoId,
  selectedRepoName,
}: {
  isCreating: boolean;
  isPending: boolean;
  onCreate: () => void;
  onOpenChange: (open: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onRepoSearchChange: (value: string) => void;
  onSelectRepo: (repoId: string, repoFullName: string) => void;
  open: boolean;
  projectName: string;
  repoSearch: string;
  repos: GithubReposResult;
  selectedRepoId: string;
  selectedRepoName: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Search your GitHub repositories, then bind one to a new project.
          </DialogDescription>
        </DialogHeader>

        <CreateProjectForm
          isPending={isPending}
          onProjectNameChange={onProjectNameChange}
          onRepoSearchChange={onRepoSearchChange}
          onSelectRepo={onSelectRepo}
          projectName={projectName}
          repoSearch={repoSearch}
          repos={repos}
          selectedRepoId={selectedRepoId}
          selectedRepoName={selectedRepoName}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!selectedRepoName || isCreating} onClick={onCreate}>
            {isCreating ? "Creating..." : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
