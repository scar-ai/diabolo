import { ExternalLinkIcon, LoaderIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { TaskStatusBadge } from "@/components/app/task-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { formatTaskDate } from "./parsers";
import type { TaskData } from "./types";

export function QuickTaskDetail({
  isStopping,
  onStop,
  task,
}: {
  isStopping: boolean;
  onStop: () => void;
  task: TaskData;
}) {
  const responseText = task.combinedAgentText;
  const isRunning = task.status === "queued" || task.status === "running";

  return (
    <main className="flex flex-1 justify-center px-4 py-8">
      <div className="flex w-full max-w-4xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-medium text-foreground">
            {task.repoName ?? "Quick task"}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" size="sm">
              Quick task
            </Badge>
            {isRunning ? (
              <Button variant="destructive" size="sm" disabled={isStopping} onClick={onStop}>
                {isStopping ? (
                  <LoaderIcon className="size-3.5 animate-spin" />
                ) : (
                  <SquareIcon className="size-3.5" />
                )}
                {isStopping ? "Stopping..." : "Stop task"}
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="border border-border/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>{task.repoName ?? "Quick task"}</span>
              <TaskStatusBadge status={task.status} />
            </CardTitle>
            <CardDescription>{task.stage}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <ReadOnlyMetaItem
              label="Date"
              value={formatTaskDate(task.completedAt ?? task.startedAt)}
            />
            <ReadOnlyMetaItem label="Status" value={task.status} />
            <ReadOnlyMetaItem
              label="Pull request"
              value={
                task.prUrl ? (
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
                  >
                    PR #{task.prNumber}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : (
                  "Not available"
                )
              }
            />
          </CardContent>
        </Card>

        <ReadOnlySection title="Prompt" content={task.prompt} />
        <ReadOnlySection
          title="OpenCode response"
          content={
            responseText ||
            (task.status === "queued" || task.status === "running"
              ? "Waiting for OpenCode response..."
              : "No OpenCode response captured.")
          }
        />
        <ReadOnlySection
          title="Logs"
          content={
            task.logs ||
            (task.status === "queued" || task.status === "running"
              ? "Waiting for sandbox logs..."
              : "No sandbox logs captured.")
          }
          mono
        />

        {task.error ? (
          <Card className="border border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">Error</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-destructive/80">{task.error}</CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

function ReadOnlyMetaItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
      <div className="text-xs tracking-[0.08em] text-muted-foreground/70 uppercase">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function ReadOnlySection({
  content,
  mono = false,
  title,
}: {
  content: string;
  mono?: boolean;
  title: string;
}) {
  return (
    <Card className="border border-border/80">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`max-h-90 overflow-auto rounded-xl border border-border/70 px-4 py-3 text-sm whitespace-pre-wrap ${
            mono
              ? "bg-[#0a0a0a] font-mono text-[11px] leading-relaxed text-emerald-400"
              : "bg-muted/20"
          }`}
        >
          <pre className={mono ? "break-all whitespace-pre-wrap" : "font-sans whitespace-pre-wrap"}>
            {content}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
