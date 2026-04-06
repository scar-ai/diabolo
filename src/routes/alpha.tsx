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
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/8">
            <RiTerminalBoxLine className="h-3.5 w-3.5 text-foreground/50" />
          </div>
          <span className="text-sm font-medium tracking-tight text-foreground/70">diabolo</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium tracking-widest text-muted-foreground/60 uppercase">
            Private Alpha
          </span>
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground/60 transition-colors hover:text-foreground"
          >
            Sign in
            <RiArrowRightLine className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 text-center">
        {/* Subtle radial glow */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(237,178,241,0.06) 0%, transparent 70%)",
          }}
        />

        <div className="relative flex max-w-4xl flex-col items-center gap-10">
          <div className="flex items-center gap-2">
            <RiSparklingLine className="h-3 w-3 text-info/70" />
            <span className="text-xs tracking-widest text-muted-foreground/50 uppercase">
              Limited early access
            </span>
          </div>

          <div className="flex flex-col gap-5">
            <h1 className="text-5xl leading-tight font-light tracking-tight sm:text-6xl">
              Run AI tasks{" "}
              <em
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "1.15em" }}
                className="font-normal text-foreground/40"
              >
                while you sleep.
              </em>
            </h1>
            <p className="mx-auto max-w-md text-base leading-relaxed text-muted-foreground/70">
              Delegate complex, long-running tasks to AI agents — with full context, scheduled runs,
              and real-time progress.
            </p>
          </div>

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-full bg-foreground px-7 py-3 text-sm font-medium text-background transition-opacity hover:opacity-75"
            >
              <RiGithubFill className="h-4 w-4" />
              Continue with GitHub
            </Link>
            <a
              href="#features"
              className="flex items-center gap-1.5 px-7 py-3 text-sm text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Preview mockup */}
        <div className="relative mt-24 w-full max-w-3xl">
          <div
            className="rounded-2xl p-px"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
            }}
          >
            <div className="rounded-2xl bg-foreground/[0.03] p-5">
              <div className="flex items-center gap-2 border-b border-foreground/5 pb-4">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
                  <div className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
                  <div className="h-2.5 w-2.5 rounded-full bg-foreground/10" />
                </div>
                <span className="ml-2 text-xs text-muted-foreground/40">task runner</span>
              </div>
              <div className="mt-4 flex flex-col gap-2">
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
      <section id="features" className="px-6 py-40">
        <div className="mx-auto max-w-5xl">
          <div className="mb-20 flex flex-col gap-3">
            <p className="text-xs tracking-widest text-muted-foreground/40 uppercase">
              Everything you need
            </p>
            <h2 className="max-w-lg text-3xl leading-snug font-light tracking-tight">
              Delegate with complete confidence
            </h2>
          </div>

          <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<RiSparklingLine className="h-4 w-4" />}
              title="Long-running agents"
              description="Kick off tasks that run in the background — no need to keep a tab open."
            />
            <FeatureCard
              icon={<RiTimeLine className="h-4 w-4" />}
              title="Scheduled runs"
              description="Set tasks to run on a cron schedule. Daily reports, nightly audits — automated."
            />
            <FeatureCard
              icon={<RiTerminalBoxLine className="h-4 w-4" />}
              title="Sandbox execution"
              description="Agents run in isolated environments with access to your codebase and tools."
            />
            <FeatureCard
              icon={<RiCheckLine className="h-4 w-4" />}
              title="Project scoping"
              description="Organize tasks under projects. Share context and files across your whole team."
            />
            <FeatureCard
              icon={<RiGithubFill className="h-4 w-4" />}
              title="GitHub integration"
              description="Connect repos and let agents open PRs, review diffs, and push changes."
            />
            <FeatureCard
              icon={<RiArrowRightLine className="h-4 w-4" />}
              title="Follow-up conversations"
              description="After a task finishes, keep chatting in context. Iterate without starting over."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-40">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-10 text-center">
          <div className="flex flex-col gap-4">
            <h2 className="text-4xl leading-tight font-light tracking-tight sm:text-5xl">
              Ready to run your first task?
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground/60">
              Join the alpha and start delegating work to AI agents today.
              <br />
              Early access is free.
            </p>
          </div>
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-full bg-foreground px-8 py-3.5 text-sm font-medium text-background transition-opacity hover:opacity-75"
          >
            <RiGithubFill className="h-4 w-4" />
            Get early access
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-xs text-muted-foreground/30">
          <span>diabolo &copy; {new Date().getFullYear()}</span>
          <Link to="/login" className="transition-colors hover:text-muted-foreground">
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
    <div className="flex flex-col gap-5 bg-foreground/[0.025] p-7 ring-1 ring-foreground/5 first:rounded-tl-2xl last:rounded-br-2xl sm:first:rounded-tl-2xl sm:last:rounded-br-2xl">
      <div className="text-foreground/30">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium text-foreground/80">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground/50">{description}</p>
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
  const dotStyles = {
    done: "bg-success/60",
    running: "bg-info/60",
    scheduled: "bg-foreground/15",
  };

  const badgeStyles = {
    done: "text-success/70",
    running: "text-info/70",
    scheduled: "text-muted-foreground/40",
  };

  const statusLabel = {
    done: "Done",
    running: "Running",
    scheduled: "Scheduled",
  };

  return (
    <div className="flex items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-foreground/[0.03]">
      <div className="flex items-center gap-3">
        {status === "running" ? (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info/60 opacity-75" />
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotStyles[status]}`}
            />
          </span>
        ) : (
          <span className={`flex h-1.5 w-1.5 rounded-full ${dotStyles[status]}`} />
        )}
        <span className="text-sm text-foreground/60">{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-xs text-muted-foreground/30 sm:block">{time}</span>
        <span className={`text-xs font-medium ${badgeStyles[status]}`}>{statusLabel[status]}</span>
      </div>
    </div>
  );
}
