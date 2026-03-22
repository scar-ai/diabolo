import { ChevronDownIcon, GitBranchIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GithubBranchesResult } from "@/lib/github/queries";

export function BranchSelector({
  branches,
  currentBranch,
  disabled,
  isPending,
  onSelectBranch,
}: {
  branches: GithubBranchesResult;
  currentBranch: string;
  disabled: boolean;
  isPending: boolean;
  onSelectBranch: (branchName: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground/60"
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
