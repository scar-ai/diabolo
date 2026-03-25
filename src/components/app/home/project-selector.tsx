import { BookMarkedIcon, ChevronDownIcon, PlusIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectsResult } from "@/project/query";

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
      <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground/60 transition-colors hover:bg-accent hover:text-muted-foreground">
        <BookMarkedIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{projectLabel}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="min-w-56">
        {projects.length > 0 ? (
          <>
            {projects.map((project) => (
              <DropdownMenuItem key={project.id} onClick={() => onSelectProject(project.id)}>
                {project.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              No projects yet
            </DropdownMenuLabel>
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
