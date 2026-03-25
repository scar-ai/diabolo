import { ExternalLinkIcon, GitBranchIcon, ImageIcon } from "lucide-react";

import type { JsonObject } from "@/lib/json";

type TaskArtifact = {
  id: string;
  metadata: JsonObject | null;
  type: string;
  url: string;
};

const getArtifactLabel = (artifact: TaskArtifact) => {
  if (artifact.type === "pull_request") {
    return typeof artifact.metadata?.prNumber === "number"
      ? `PR #${artifact.metadata.prNumber}`
      : "Pull request";
  }

  if (artifact.type === "branch") {
    return typeof artifact.metadata?.branchName === "string"
      ? artifact.metadata.branchName
      : artifact.url;
  }

  return artifact.type.replaceAll("_", " ");
};

export function TaskArtifactList({
  artifacts,
  title = "Artifacts",
}: {
  artifacts: TaskArtifact[];
  title?: string;
}) {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </div>
      <div className="flex flex-col gap-2">
        {artifacts.map((artifact) => {
          const Icon =
            artifact.type === "branch"
              ? GitBranchIcon
              : artifact.type === "screenshot"
                ? ImageIcon
                : ExternalLinkIcon;

          const isExternal =
            artifact.url.startsWith("http://") || artifact.url.startsWith("https://");

          return (
            <div
              key={artifact.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="truncate text-foreground">{getArtifactLabel(artifact)}</span>
              </div>
              {isExternal ? (
                <a
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs text-muted-foreground/70 underline underline-offset-4"
                >
                  Open
                </a>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground/60">{artifact.url}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
