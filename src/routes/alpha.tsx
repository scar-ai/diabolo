import {
  RiArrowRightLine,
  RiCheckLine,
  RiGithubFill,
  RiSparklingLine,
  RiTerminalBoxLine,
  RiTimeLine,
} from "@remixicon/react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/alpha")({
  component: AlphaLandingPage,
});

function AlphaLandingPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Nav */}
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-foreground/5 bg-background/80 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground/10">
            <RiTerminalBoxLine className="h-4 w-4 text-foreground/70" />
          </div>
          <span className="text-sm font-semibold tracking-tight">diabolo</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-info/10 px-3 py-1 text-xs font-medium text-info">
            Alpha
          </span>
          <Link
            to="/login"
            className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-80"
          >
            Sign in
            <RiArrowRightLine className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="flex min-h-svh flex-col items-center justify-center px-6 pt-20 text-center">
        <div className="flex max-w-3xl flex-col items-center gap-8">
          <div className="flex items-center gap-2 rounded-full border border-foreground/10 bg-foreground/5 px-4 py-2">
            <RiSparklingLine className="h-3.5 w-3.5 text-info" />
            <span className="text-xs font-medium text-muted-foreground">
              Now in private alpha — limited access
            </span>
          </div>

          <div className="flex flex-col gap-4">
            <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
              Run AI tasks
              <br />
              <span className="text-muted-foreground">while you sleep.</span>
            </h1>
            <p className="mx-auto max-w-xl text-lg text-muted-foreground">
              Diabolo lets you delegate complex, long-running tasks to AI agents — with full
              context, scheduled runs, and real-time progress tracking.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-80"
            >
              <RiGithubFill className="h-4 w-4" />
              Continue with GitHub
            </Link>
            <a
              href="#features"
              className="flex items-center gap-1.5 rounded-full border border-foreground/10 bg-foreground/5 px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-foreground/10"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Preview mockup */}
        <div className="mt-20 w-full max-w-4xl">
          <div className="rounded-2xl bg-foreground/5 p-1 ring-1 ring-foreground/10">
            <div className="rounded-xl bg-muted/50 p-6">
              <div className="flex items-center gap-2 border-b border-foreground/5 pb-4">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-destructive/50" />
                  <div className="h-3 w-3 rounded-full bg-warning/50" />
                  <div className="h-3 w-3 rounded-full bg-success/50" />
                </div>
                <span className="ml-2 text-xs text-muted-foreground">diabolo — task runner</span>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                <MockTask
                  label="Audit all API routes and write a security report"
                  status="done"
                  time="2m 14s"
                />
                <MockTask
                  label="Refactor the auth middleware to use JWT tokens"
                  status="running"
                  time="0m 43s"
                />
                <MockTask
                  label="Generate unit tests for the payment module"
                  status="scheduled"
                  time="Runs at 9:00 AM"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-foreground/5 px-6 py-32">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to delegate with confidence
            </h2>
            <p className="mt-4 text-muted-foreground">
              Built for teams that move fast and can't afford to babysit an AI.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<RiSparklingLine className="h-5 w-5" />}
              title="Long-running agents"
              description="Kick off tasks that run in the background — no need to keep a tab open. Check back when they're done."
            />
            <FeatureCard
              icon={<RiTimeLine className="h-5 w-5" />}
              title="Scheduled runs"
              description="Set tasks to run on a cron schedule. Daily reports, nightly audits, weekly summaries — automated."
            />
            <FeatureCard
              icon={<RiTerminalBoxLine className="h-5 w-5" />}
              title="Full sandbox execution"
              description="Agents run in isolated environments with access to your codebase, files, and tools — safely."
            />
            <FeatureCard
              icon={<RiCheckLine className="h-5 w-5" />}
              title="Project scoping"
              description="Organize tasks under projects. Share context, files, and instructions across your whole team."
            />
            <FeatureCard
              icon={<RiGithubFill className="h-5 w-5" />}
              title="GitHub integration"
              description="Connect your repos and let agents open PRs, review diffs, and push changes — all from a prompt."
            />
            <FeatureCard
              icon={<RiArrowRightLine className="h-5 w-5" />}
              title="Follow-up conversations"
              description="After a task finishes, keep chatting in context. Iterate without starting over."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-foreground/5 px-6 py-32">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
          <div className="flex flex-col gap-3">
            <h2 className="text-4xl font-bold tracking-tight">Ready to run your first task?</h2>
            <p className="text-muted-foreground">
              Join the alpha and start delegating work to AI agents today. Early access is free.
            </p>
          </div>
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-full bg-foreground px-8 py-3.5 text-sm font-semibold text-background transition-opacity hover:opacity-80"
          >
            <RiGithubFill className="h-4 w-4" />
            Get early access
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-foreground/5 px-6 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-xs text-muted-foreground">
          <span>diabolo &copy; {new Date().getFullYear()}</span>
          <Link to="/login" className="transition-colors hover:text-foreground">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-foreground/5 p-6 ring-1 ring-foreground/10">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/10 text-foreground/70">
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function MockTask({
  label,
  status,
  time,
}: {
  label: string;
  status: "done" | "running" | "scheduled";
  time: string;
}) {
  const statusStyles = {
    done: "bg-success/15 text-success",
    running: "bg-info/15 text-info",
    scheduled: "bg-foreground/10 text-muted-foreground",
  };

  const statusLabel = {
    done: "Done",
    running: "Running",
    scheduled: "Scheduled",
  };

  return (
    <div className="flex items-center justify-between rounded-xl bg-background/50 px-4 py-3">
      <div className="flex items-center gap-3">
        {status === "running" && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
          </span>
        )}
        {status === "done" && <span className="flex h-2 w-2 rounded-full bg-success" />}
        {status === "scheduled" && <span className="flex h-2 w-2 rounded-full bg-foreground/20" />}
        <span className="text-sm text-foreground/80">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-muted-foreground sm:block">{time}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}>
          {statusLabel[status]}
        </span>
      </div>
    </div>
  );
}
