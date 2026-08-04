import { ChevronDownIcon, GitBranchIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { GithubBranchesResult } from "@/lib/github/queries";

export function BranchSelector({
  branches,
  currentBranch,
  disabled,
  isCreating,
  isPending,
  onCreateBranch,
  onSelectBranch,
}: {
  branches: GithubBranchesResult;
  currentBranch: string;
  disabled: boolean;
  isCreating: boolean;
  isPending: boolean;
  onCreateBranch: (branchName: string) => Promise<void>;
  onSelectBranch: (branchName: string) => void;
}) {
  const branchNameInputId = useId();
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchOpen, setNewBranchOpen] = useState(false);

  const handleOpenNewBranch = () => {
    setNewBranchName("");
    setNewBranchOpen(true);
  };

  const handleCreateBranch = async () => {
    const branchName = newBranchName.trim();
    if (!branchName || isCreating) return;

    try {
      await onCreateBranch(branchName);
    } catch {
      return;
    }

    setNewBranchOpen(false);
    setNewBranchName("");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground/70 transition-colors hover:border-border hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70 aria-expanded:border-border aria-expanded:bg-accent aria-expanded:text-foreground"
        >
          <GitBranchIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="max-w-40 truncate">{currentBranch}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" sideOffset={8}>
          {branches.map((branch) => (
            <DropdownMenuItem key={branch.name} onClick={() => onSelectBranch(branch.name)}>
              {branch.name}
            </DropdownMenuItem>
          ))}
          {branches.length === 0 && !isPending ? (
            <DropdownMenuItem disabled>{currentBranch}</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={isCreating} onClick={handleOpenNewBranch}>
            <PlusIcon aria-hidden="true" />
            {isCreating ? "Creating branch..." : "New branch"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={newBranchOpen} onOpenChange={setNewBranchOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>
              Create a branch from{" "}
              <span className="font-medium text-foreground">{currentBranch}</span>.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateBranch();
            }}
          >
            <div>
              <label htmlFor={branchNameInputId} className="mb-1.5 block text-sm font-medium">
                Branch name
              </label>
              <Input
                id={branchNameInputId}
                placeholder="feature/my-new-work"
                value={newBranchName}
                onChange={(event) => setNewBranchName(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isCreating}
                onClick={() => setNewBranchOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newBranchName.trim() || isCreating}>
                {isCreating ? "Creating..." : "Create branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
