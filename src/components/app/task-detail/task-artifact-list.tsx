import { ExternalLinkIcon, FileIcon, GitBranchIcon, ImageIcon } from "lucide-react";

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

  if (artifact.type === "attachment") {
    return typeof artifact.metadata?.originalName === "string"
      ? artifact.metadata.originalName
      : typeof artifact.metadata?.fileName === "string"
        ? artifact.metadata.fileName
        : "Attachment";
  }

  return artifact.type.replaceAll("_", " ");
};

const isImageArtifact = (artifact: TaskArtifact) =>
  artifact.type === "screenshot" ||
  (artifact.type === "attachment" &&
    typeof artifact.metadata?.mediaType === "string" &&
    artifact.metadata.mediaType.startsWith("image/"));

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
              : isImageArtifact(artifact)
                ? ImageIcon
                : artifact.type === "attachment"
                  ? FileIcon
                  : ExternalLinkIcon;

          const isExternal =
            artifact.url.startsWith("http://") || artifact.url.startsWith("https://");
          const isLink = isExternal || artifact.url.startsWith("/");

          return (
            <div
              key={artifact.id}
              className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/70 px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                  <span className="truncate text-foreground">{getArtifactLabel(artifact)}</span>
                </div>
                {isLink ? (
                  <a
                    href={artifact.url}
                    target={isExternal ? "_blank" : undefined}
                    rel={isExternal ? "noreferrer" : undefined}
                    className="shrink-0 text-xs text-muted-foreground/70 underline underline-offset-4"
                  >
                    {artifact.type === "attachment" ? "Download" : "Open"}
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground/60">{artifact.url}</span>
                )}
              </div>
              {isImageArtifact(artifact) && isLink ? (
                <a
                  href={artifact.url}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noreferrer" : undefined}
                  className="block overflow-hidden rounded-2xl border border-border/60 bg-muted/20"
                >
                  <img
                    alt={getArtifactLabel(artifact)}
                    className="max-h-96 w-full object-cover object-top"
                    loading="lazy"
                    src={artifact.url}
                  />
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
