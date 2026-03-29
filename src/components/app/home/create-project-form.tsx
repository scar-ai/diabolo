import { LoaderIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GithubReposResult } from "@/lib/github/queries";

export function CreateProjectForm({
  isPending,
  onProjectNameChange,
  onRepoSearchChange,
  onSelectRepo,
  projectName,
  repoSearch,
  repos,
  selectedRepoId,
  selectedRepoName,
}: {
  isPending: boolean;
  onProjectNameChange: (value: string) => void;
  onRepoSearchChange: (value: string) => void;
  onSelectRepo: (repoId: string, repoFullName: string) => void;
  projectName: string;
  repoSearch: string;
  repos: GithubReposResult;
  selectedRepoId: string;
  selectedRepoName: string | null;
}) {
  const searchQuery = repoSearch.trim().toLowerCase();
  const filteredRepos = searchQuery
    ? repos.filter((repo) =>
        [repo.fullName, repo.name, repo.ownerLogin].some((value) =>
          value.toLowerCase().includes(searchQuery),
        ),
      )
    : repos.slice(0, 8);

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label htmlFor="repo-search">Search repositories</Label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            id="repo-search"
            value={repoSearch}
            onChange={(event) => onRepoSearchChange(event.target.value)}
            placeholder="Search by repo, owner, or full name"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Repository</Label>
        <div className="max-h-72 overflow-auto rounded-2xl border border-border bg-background p-1">
          {isPending ? (
            <div className="flex items-center justify-center py-10">
              <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : repos.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground">
              No GitHub repositories found.
            </div>
          ) : filteredRepos.length === 0 ? (
            <div className="px-3 py-6 text-sm text-muted-foreground">
              No repositories match your search.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredRepos.map((repo) => {
                const isSelected = repo.id === selectedRepoId;

                return (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => onSelectRepo(repo.id, repo.fullName)}
                    className={`flex flex-col items-start gap-1 rounded-xl px-3 py-2 text-left transition-colors ${isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                  >
                    <span className="font-medium">{repo.fullName}</span>
                    <span className="text-xs text-muted-foreground/70">
                      {repo.ownerLogin} · {repo.visibility}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="project-name">Project name</Label>
        <Input
          id="project-name"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder={selectedRepoName ?? "Project name"}
          disabled={!selectedRepoName}
        />
      </div>
    </div>
  );
}
