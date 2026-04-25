import { RiArrowRightLine, RiCheckLine, RiGithubFill } from "@remixicon/react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/beta")({
  component: BetaLandingPage,
});

const DARK = "#0e0e0e";
const BODY_BG = "#0e0e0e";
const LIGHT = "#f0ece6";
const BORDER_LIGHT = "rgba(255,255,255,0.07)";
const BORDER_DARK = "rgba(255,255,255,0.04)";
const TEXT_PRIMARY = "rgba(255,255,255,0.82)";
const TEXT_SECONDARY = "rgba(255,255,255,0.42)";
const TEXT_MUTED = "rgba(255,255,255,0.28)";

const serif = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic" as const,
};

function BetaLandingPage() {
  return (
    <div style={{ background: BODY_BG, color: TEXT_PRIMARY }} className="min-h-svh antialiased">
      {/* Nav */}
      <header
        className="sticky top-0 z-50"
        style={{ background: "#0a0a0a", borderBottom: `1px solid ${BORDER_LIGHT}` }}
      >
        <div
          className="mx-auto flex items-center justify-between px-6 py-4 md:px-10"
          style={{ maxWidth: 1100 }}
        >
          <span
            style={{
              ...serif,
              color: "#fff",
              fontSize: 20,
              letterSpacing: "-0.01em",
            }}
          >
            diabolo
          </span>
          <div className="flex items-center gap-6">
            <a
              href="#how-it-works"
              className="hidden transition-colors hover:text-white sm:block"
              style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}
            >
              How it works
            </a>
            <a
              href="#features"
              className="hidden transition-colors hover:text-white sm:block"
              style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}
            >
              Features
            </a>
            <Link
              to="/pricing"
              className="hidden transition-colors hover:text-white sm:block"
              style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}
            >
              Pricing
            </Link>
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: LIGHT, color: "#0e0e0e" }}
            >
              Sign in
              <RiArrowRightLine className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main container with side borders */}
      <div
        className="mx-auto"
        style={{
          maxWidth: 1100,
          borderLeft: `1px solid ${BORDER_LIGHT}`,
          borderRight: `1px solid ${BORDER_LIGHT}`,
        }}
      >
        {/* Hero */}
        <section className="px-6 pt-20 pb-24 md:px-10 md:pt-28 md:pb-32">
          <div
            className="mb-10 inline-flex items-center rounded-full px-3 py-1"
            style={{
              background: "rgba(255,255,255,0.06)",
              fontSize: 11,
              letterSpacing: "0.12em",
              color: TEXT_MUTED,
              textTransform: "uppercase",
            }}
          >
            Now in beta
          </div>

          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2.5rem, 5.5vw, 4rem)",
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: "-0.01em",
              maxWidth: 700,
              marginBottom: "1.5rem",
              color: TEXT_PRIMARY,
            }}
          >
            AI agents that work on your codebase{" "}
            <em style={{ ...serif, color: TEXT_SECONDARY }}>while you sleep.</em>
          </h1>

          <p
            style={{
              fontSize: 16,
              lineHeight: 1.75,
              color: TEXT_SECONDARY,
              maxWidth: 500,
              marginBottom: "2.5rem",
            }}
          >
            Delegate long-running engineering tasks to AI agents in isolated sandboxes. Schedule
            them, track them, iterate on them — from a prompt.
          </p>

          <div className="flex flex-col items-start gap-3 sm:flex-row">
            <Link
              to="/login"
              className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: LIGHT, color: "#0e0e0e" }}
            >
              <RiGithubFill className="h-4 w-4" />
              Get started free
            </Link>
            <a
              href="#how-it-works"
              className="flex items-center gap-1.5 px-6 py-3 text-sm transition-colors hover:text-foreground"
              style={{ color: TEXT_SECONDARY }}
            >
              See how it works
              <RiArrowRightLine className="h-3.5 w-3.5" />
            </a>
          </div>
        </section>

        {/* Task runner display */}
        <section
          className="px-6 py-8 md:px-10 md:py-10"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <TaskDisplay />
        </section>

        {/* Metrics bar */}
        <section style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}>
          <div className="grid grid-cols-3">
            <MetricItem value="∞" label="Background tasks" />
            <MetricItem value="Isolated" label="Sandboxed execution" divider />
            <MetricItem value="Any LLM" label="Provider agnostic" divider />
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="px-6 py-20 md:px-10 md:py-28"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <div className="mb-14">
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginBottom: "1rem",
              }}
            >
              How it works
            </div>
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
                fontWeight: 400,
                lineHeight: 1.2,
                maxWidth: 480,
              }}
            >
              From prompt to pull request,{" "}
              <em style={{ ...serif, color: TEXT_SECONDARY }}>hands-free.</em>
            </h2>
          </div>

          <div
            className="grid gap-0 sm:grid-cols-3"
            style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
          >
            <StepCard
              number="01"
              title="Connect a repo"
              description="Link your GitHub repository. Diabolo reads your codebase, understands the structure, and gives agents full context."
            />
            <StepCard
              number="02"
              title="Describe the task"
              description="Write a prompt like you'd write a ticket. The agent picks up context, selects tools, and gets to work in a fresh sandbox."
              middle
            />
            <StepCard
              number="03"
              title="Review the output"
              description="Track progress in real time. Agents surface artifacts, diffs, and reports. Follow up in-context or schedule a repeat run."
            />
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          className="px-6 py-20 md:px-10 md:py-28"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <div className="mb-14">
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginBottom: "1rem",
              }}
            >
              Capabilities
            </div>
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
                fontWeight: 400,
                lineHeight: 1.2,
                maxWidth: 480,
              }}
            >
              Everything an agent needs{" "}
              <em style={{ ...serif, color: TEXT_SECONDARY }}>to do real work.</em>
            </h2>
          </div>

          <div
            className="grid sm:grid-cols-2 lg:grid-cols-3"
            style={{
              borderTop: `1px solid ${BORDER_LIGHT}`,
              borderLeft: `1px solid ${BORDER_LIGHT}`,
            }}
          >
            <FeatureCard
              title="Long-running agents"
              description="Tasks run entirely in the background. Close your laptop — Diabolo keeps working."
            />
            <FeatureCard
              title="Scheduled execution"
              description="Set cron schedules for recurring tasks. Nightly audits, daily summaries, weekly reports."
            />
            <FeatureCard
              title="Isolated sandboxes"
              description="Every task spins up a fresh, isolated environment. No side effects. No shared state."
            />
            <FeatureCard
              title="GitHub integration"
              description="Agents can open PRs, push commits, read issues, and operate directly on your repository."
            />
            <FeatureCard
              title="Follow-up sessions"
              description="After a task completes, keep chatting in context. Iterate without losing history."
            />
            <FeatureCard
              title="Any LLM provider"
              description="Configure OpenAI, OpenRouter, or your own base URL. Switch models per task."
            />
          </div>
        </section>

        {/* Use cases */}
        <section
          className="px-6 py-20 md:px-10 md:py-28"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <div className="mb-14">
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginBottom: "1rem",
              }}
            >
              Built for
            </div>
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
                fontWeight: 400,
                lineHeight: 1.2,
                maxWidth: 520,
              }}
            >
              The tasks that never make it{" "}
              <em style={{ ...serif, color: TEXT_SECONDARY }}>onto the roadmap.</em>
            </h2>
          </div>

          <div
            className="grid sm:grid-cols-2"
            style={{
              borderTop: `1px solid ${BORDER_LIGHT}`,
              borderLeft: `1px solid ${BORDER_LIGHT}`,
            }}
          >
            <UseCaseRow
              prompt="Write integration tests for the payment service"
              outcome="Test suite with 94% coverage committed to branch"
            />
            <UseCaseRow
              prompt="Find all hardcoded secrets and open a remediation PR"
              outcome="12 issues found, patch PR opened with recommendations"
            />
            <UseCaseRow
              prompt="Summarise all merged PRs from this week into a changelog"
              outcome="Formatted CHANGELOG.md ready for review"
            />
            <UseCaseRow
              prompt="Audit database queries slower than 500ms and suggest indexes"
              outcome="Performance report with indexed query benchmarks"
            />
          </div>
        </section>

        {/* CTA */}
        <section
          className="px-6 py-20 md:px-10 md:py-32"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
              marginBottom: "1.5rem",
            }}
          >
            Get started
          </div>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2rem, 5vw, 3rem)",
              fontWeight: 400,
              lineHeight: 1.2,
              maxWidth: 480,
              marginBottom: "1.25rem",
            }}
          >
            Start delegating. <em style={{ ...serif, color: TEXT_SECONDARY }}>Today.</em>
          </h2>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.75,
              color: TEXT_SECONDARY,
              maxWidth: 400,
              marginBottom: "2.5rem",
            }}
          >
            Connect a GitHub repo and run your first task in under a minute. Free while in beta.
          </p>

          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: DARK, color: "#fff" }}
          >
            <RiGithubFill className="h-4 w-4" />
            Continue with GitHub
          </Link>

          <div className="mt-8 flex items-center gap-6" style={{ fontSize: 12, color: TEXT_MUTED }}>
            <span className="flex items-center gap-1.5">
              <RiCheckLine className="h-3 w-3" />
              No credit card
            </span>
            <span className="flex items-center gap-1.5">
              <RiCheckLine className="h-3 w-3" />
              GitHub OAuth only
            </span>
            <span className="flex items-center gap-1.5">
              <RiCheckLine className="h-3 w-3" />
              Cancel anytime
            </span>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer style={{ background: "#0a0a0a", borderTop: `1px solid ${BORDER_LIGHT}` }}>
        <div className="mx-auto px-6 py-12 md:px-10 md:py-16" style={{ maxWidth: 1100 }}>
          <div className="mb-12 flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div>
              <div
                style={{
                  ...serif,
                  color: "#fff",
                  fontSize: 20,
                  marginBottom: "0.75rem",
                }}
              >
                diabolo
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.4)",
                  maxWidth: 280,
                  lineHeight: 1.65,
                }}
              >
                AI agents for engineering teams. Run tasks in isolated sandboxes, on your schedule.
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.2)",
                  marginTop: "0.5rem",
                }}
              >
                Remote
              </p>
            </div>
            <div className="flex items-center gap-8">
              <Link
                to="/login"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                Sign in
              </Link>
              <a
                href="#features"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                Features
              </a>
              <Link
                to="/pricing"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                Pricing
              </Link>
              <a
                href="#how-it-works"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                How it works
              </a>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${BORDER_DARK}`, paddingTop: "1.5rem" }}>
            <p
              style={{
                fontSize: 11,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontStyle: "italic",
                color: "rgba(255,255,255,0.25)",
                lineHeight: 1.65,
                maxWidth: 680,
              }}
            >
              Diabolo is a beta product. AI agents may produce unexpected results. Always review
              agent output before merging to production.
            </p>
            <p
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.2)",
                marginTop: "1rem",
              }}
            >
              &copy; {new Date().getFullYear()} Diabolo, Inc.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TaskDisplay() {
  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: "#141414", border: `1px solid ${BORDER_LIGHT}` }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-2 px-5 py-4"
        style={{ borderBottom: "1px solid #2a2a2a" }}
      >
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#333" }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#333" }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#333" }} />
        </div>
        <span className="ml-2 text-xs tracking-wide" style={{ color: "rgba(255,255,255,0.2)" }}>
          diabolo / task runner
        </span>
      </div>
      {/* Tasks */}
      <div className="p-2">
        <TerminalTask
          label="Audit all API endpoints and write a security report"
          status="done"
          meta="2m 14s · 3 artifacts"
        />
        <TerminalTask
          label="Refactor auth middleware to use short-lived JWT tokens"
          status="running"
          meta="0m 43s · in progress"
        />
        <TerminalTask
          label="Generate test coverage report for payment module"
          status="scheduled"
          meta="Runs nightly at 02:00"
        />
      </div>
    </div>
  );
}

function TerminalTask({
  label,
  status,
  meta,
}: {
  label: string;
  status: "done" | "running" | "scheduled";
  meta: string;
}) {
  const dotBg = {
    done: "rgba(18,201,5,0.55)",
    running: "rgba(180,160,255,0.65)",
    scheduled: "rgba(255,255,255,0.15)",
  }[status];

  const badgeColor = {
    done: "rgba(18,201,5,0.65)",
    running: "rgba(180,160,255,0.75)",
    scheduled: "rgba(255,255,255,0.25)",
  }[status];

  const badgeLabel = { done: "Done", running: "Running", scheduled: "Scheduled" }[status];

  return (
    <div
      className="flex items-center justify-between rounded-md px-4 py-3 transition-colors"
      style={{ cursor: "default" }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)")
      }
      onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
    >
      <div className="flex min-w-0 items-center gap-3">
        {status === "running" ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ background: dotBg }}
            />
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full"
              style={{ background: dotBg }}
            />
          </span>
        ) : (
          <span className="flex h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotBg }} />
        )}
        <span className="truncate text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
          {label}
        </span>
      </div>
      <div className="ml-4 flex shrink-0 items-center gap-4">
        <span className="hidden text-xs sm:block" style={{ color: "rgba(255,255,255,0.2)" }}>
          {meta}
        </span>
        <span className="text-xs font-medium" style={{ color: badgeColor }}>
          {badgeLabel}
        </span>
      </div>
    </div>
  );
}

function MetricItem({
  value,
  label,
  divider,
}: {
  value: string;
  label: string;
  divider?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 py-8 text-center"
      style={divider ? { borderLeft: `1px solid ${BORDER_LIGHT}` } : undefined}
    >
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "clamp(1.25rem, 2.5vw, 1.75rem)",
          fontWeight: 400,
          color: TEXT_PRIMARY,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: TEXT_MUTED,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
  middle,
}: {
  number: string;
  title: string;
  description: string;
  middle?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-6 p-8"
      style={{
        borderLeft: middle ? `1px solid ${BORDER_LIGHT}` : undefined,
        borderRight: middle ? `1px solid ${BORDER_LIGHT}` : undefined,
      }}
    >
      <span
        style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          letterSpacing: "0.1em",
          color: TEXT_MUTED,
        }}
      >
        {number}
      </span>
      <div className="flex flex-col gap-2">
        <h3 style={{ fontSize: 15, fontWeight: 500, color: TEXT_PRIMARY }}>{title}</h3>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT_SECONDARY }}>{description}</p>
      </div>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="flex flex-col gap-3 p-8"
      style={{
        borderRight: `1px solid ${BORDER_LIGHT}`,
        borderBottom: `1px solid ${BORDER_LIGHT}`,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 500, color: TEXT_PRIMARY }}>{title}</h3>
      <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT_SECONDARY }}>{description}</p>
    </div>
  );
}

function UseCaseRow({ prompt, outcome }: { prompt: string; outcome: string }) {
  return (
    <div
      className="flex flex-col gap-4 p-8"
      style={{
        borderRight: `1px solid ${BORDER_LIGHT}`,
        borderBottom: `1px solid ${BORDER_LIGHT}`,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 12,
            color: TEXT_MUTED,
            marginTop: 2,
            flexShrink: 0,
          }}
        >
          $
        </span>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT_PRIMARY }}>{prompt}</p>
      </div>
      <div
        className="flex items-start gap-3 rounded-md px-3 py-2.5"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <RiCheckLine
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          style={{ color: "rgba(18,201,5,0.7)" }}
        />
        <p style={{ fontSize: 13, lineHeight: 1.65, color: TEXT_SECONDARY }}>{outcome}</p>
      </div>
    </div>
  );
}
