import { BookMarkedIcon, ChevronDownIcon, PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectsResult } from "@/lib/project/queries";

export function ProjectSelector({
  onCreateProject,
  onSelectProject,
  projectLabel,
  projects,
}: {
  onCreateProject: () => void;
  onSelectProject: (projectId: string) => void;
  projectLabel: string;
  projects: ProjectsResult;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground/70 transition-colors hover:border-border hover:bg-accent hover:text-foreground aria-expanded:border-border aria-expanded:bg-accent aria-expanded:text-foreground">
        <BookMarkedIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{projectLabel}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="min-w-56">
        {projects.length > 0 ? (
          <>
            {projects.map((project) => (
              <DropdownMenuItem key={project.id} onClick={() => onSelectProject(project.id)}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{project.name}</span>
                  {project.sharedWithOrgId ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Organisation
                    </Badge>
                  ) : null}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : (
          <DropdownMenuGroup>
            <p className="px-3 py-2 text-sm text-muted-foreground">No projects yet</p>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        )}
        <DropdownMenuItem onClick={onCreateProject}>
          <PlusIcon className="size-4" aria-hidden="true" />
          Add project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
