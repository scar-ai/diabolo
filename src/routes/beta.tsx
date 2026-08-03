import {
  RiArrowRightLine,
  RiCalendarScheduleLine,
  RiCheckLine,
  RiChat3Line,
  RiGitPullRequestLine,
  RiGithubFill,
  RiShieldKeyholeLine,
  RiSparkling2Line,
  RiTerminalBoxLine,
} from "@remixicon/react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/beta")({
  component: BetaLandingPage,
});

const BODY_BG = "#0e0e0e";
const LIGHT = "#f0ece6";
const ACCENT = "#b4a0ff";
const BORDER_LIGHT = "rgba(255,255,255,0.08)";
const BORDER_DARK = "rgba(255,255,255,0.04)";
const TEXT_PRIMARY = "rgba(255,255,255,0.92)";
const TEXT_SECONDARY = "rgba(255,255,255,0.58)";
const TEXT_MUTED = "rgba(255,255,255,0.38)";

const serif = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic" as const,
};

const eyebrow = {
  fontSize: 11,
  letterSpacing: "0.15em",
  textTransform: "uppercase" as const,
  color: TEXT_MUTED,
};

function BetaLandingPage() {
  return (
    <div style={{ background: BODY_BG, color: TEXT_PRIMARY }} className="min-h-svh antialiased">
      <PageStyles />

      {/* Nav */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: "rgba(10,10,10,0.72)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: `1px solid ${BORDER_LIGHT}`,
        }}
      >
        <div
          className="mx-auto flex items-center justify-between px-6 py-4 md:px-10"
          style={{ maxWidth: 1100 }}
        >
          <span style={{ ...serif, color: "#fff", fontSize: 20, letterSpacing: "-0.01em" }}>
            diabolo
          </span>
          <div className="flex items-center gap-1 sm:gap-2">
            <NavLink href="#how-it-works">How it works</NavLink>
            <NavLink href="#features">Features</NavLink>
            <NavLink href="#faq">FAQ</NavLink>
            <Link to="/pricing" className="bt-navlink hidden sm:block">
              Pricing
            </Link>
            <Link
              to="/login"
              className="bt-cta-light ml-2 flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-medium"
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
        className="relative mx-auto"
        style={{
          maxWidth: 1100,
          borderLeft: `1px solid ${BORDER_LIGHT}`,
          borderRight: `1px solid ${BORDER_LIGHT}`,
        }}
      >
        {/* Ambient hero glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: 720,
            background:
              "radial-gradient(680px 340px at 22% 0%, rgba(180,160,255,0.13), transparent 70%), radial-gradient(520px 300px at 85% 12%, rgba(157,190,254,0.08), transparent 70%)",
          }}
        />

        {/* Hero */}
        <section className="relative px-6 pt-20 pb-16 md:px-10 md:pt-28 md:pb-20">
          <div
            className="mb-8 inline-flex items-center gap-2 rounded-full py-1 pr-4 pl-1.5"
            style={{
              background: "rgba(180,160,255,0.09)",
              border: "1px solid rgba(180,160,255,0.18)",
            }}
          >
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-widest uppercase"
              style={{ background: "rgba(180,160,255,0.18)", color: ACCENT }}
            >
              Beta
            </span>
            <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>
              Free while in beta — no credit card
            </span>
          </div>

          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2.75rem, 6vw, 4.5rem)",
              fontWeight: 400,
              lineHeight: 1.08,
              letterSpacing: "-0.015em",
              maxWidth: 780,
              marginBottom: "1.5rem",
              color: "#fff",
            }}
          >
            AI agents that ship work on your codebase{" "}
            <em
              style={{
                ...serif,
                background: `linear-gradient(100deg, ${ACCENT}, rgba(157,190,254,0.85))`,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              while you sleep.
            </em>
          </h1>

          <p
            style={{
              fontSize: 17,
              lineHeight: 1.7,
              color: TEXT_SECONDARY,
              maxWidth: 540,
              marginBottom: "2.25rem",
            }}
          >
            Hand off the long-running engineering tasks you never get to. Every agent runs in its
            own isolated sandbox, on your schedule, and reports back with real diffs and pull
            requests.
          </p>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link
              to="/login"
              className="bt-cta-light flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold"
              style={{ background: LIGHT, color: "#0e0e0e" }}
            >
              <RiGithubFill className="h-4 w-4" />
              Start free with GitHub
            </Link>
            <a
              href="#how-it-works"
              className="bt-cta-ghost flex items-center gap-1.5 rounded-full px-6 py-3.5 text-sm font-medium"
              style={{ border: `1px solid ${BORDER_LIGHT}`, color: TEXT_PRIMARY }}
            >
              See how it works
              <RiArrowRightLine className="h-3.5 w-3.5" />
            </a>
          </div>

          <div
            className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2"
            style={{ fontSize: 12.5, color: TEXT_MUTED }}
          >
            <TrustItem>Connect a repo in under a minute</TrustItem>
            <TrustItem>GitHub OAuth only</TrustItem>
            <TrustItem>Bring your own model</TrustItem>
          </div>
        </section>

        {/* Task runner display */}
        <section className="relative px-6 pb-16 md:px-10 md:pb-20">
          <TaskDisplay />
        </section>

        {/* Works with */}
        <section className="px-6 py-8 md:px-10" style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}>
          <div className="flex flex-col items-center gap-5">
            <span style={{ ...eyebrow, fontSize: 10.5 }}>Plugs into the tools you already use</span>
            <div
              className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4"
              style={{ fontSize: 14, color: "rgba(255,255,255,0.45)" }}
            >
              <span className="flex items-center gap-2">
                <RiGithubFill className="h-4 w-4" />
                GitHub
              </span>
              <span>OpenAI</span>
              <span>Anthropic</span>
              <span>OpenRouter</span>
              <span>Any OpenAI-compatible API</span>
            </div>
          </div>
        </section>

        {/* Metrics bar */}
        <section style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}>
          <div className="grid grid-cols-1 sm:grid-cols-3">
            <MetricItem value="24/7" label="Runs in the background" />
            <MetricItem value="Isolated" label="Sandboxed execution" divider />
            <MetricItem value="Any LLM" label="Provider agnostic" divider />
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="scroll-mt-20 px-6 py-20 md:px-10 md:py-28"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <SectionHeading
            eyebrow="How it works"
            title="From prompt to pull request,"
            accent="hands-free."
            subtitle="Three steps. No new workflow to learn, no infrastructure to run."
          />

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
          className="scroll-mt-20 px-6 py-20 md:px-10 md:py-28"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <SectionHeading
            eyebrow="Capabilities"
            title="Everything an agent needs"
            accent="to do real work."
            subtitle="Not a chat window. A place where work actually finishes."
          />

          <div
            className="grid sm:grid-cols-2 lg:grid-cols-3"
            style={{
              borderTop: `1px solid ${BORDER_LIGHT}`,
              borderLeft: `1px solid ${BORDER_LIGHT}`,
            }}
          >
            <FeatureCard
              icon={<RiTerminalBoxLine className="h-4 w-4" />}
              title="Long-running agents"
              description="Tasks run entirely in the background. Close your laptop — Diabolo keeps working."
            />
            <FeatureCard
              icon={<RiCalendarScheduleLine className="h-4 w-4" />}
              title="Scheduled execution"
              description="Set cron schedules for recurring tasks. Nightly audits, daily summaries, weekly reports."
            />
            <FeatureCard
              icon={<RiShieldKeyholeLine className="h-4 w-4" />}
              title="Isolated sandboxes"
              description="Every task spins up a fresh, isolated environment. No side effects. No shared state."
            />
            <FeatureCard
              icon={<RiGitPullRequestLine className="h-4 w-4" />}
              title="GitHub integration"
              description="Agents can open PRs, push commits, read issues, and operate directly on your repository."
            />
            <FeatureCard
              icon={<RiChat3Line className="h-4 w-4" />}
              title="Follow-up sessions"
              description="After a task completes, keep chatting in context. Iterate without losing history."
            />
            <FeatureCard
              icon={<RiSparkling2Line className="h-4 w-4" />}
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
          <SectionHeading
            eyebrow="Built for"
            title="The tasks that never make it"
            accent="onto the roadmap."
            subtitle="The backlog nobody has a spare afternoon for. Give it to an agent instead."
          />

          <div
            className="grid sm:grid-cols-2"
            style={{
              borderTop: `1px solid ${BORDER_LIGHT}`,
              borderLeft: `1px solid ${BORDER_LIGHT}`,
            }}
          >
            <UseCaseRow
              prompt="Write integration tests for the payment service"
              outcome="Test suite committed to a branch, ready for review"
            />
            <UseCaseRow
              prompt="Find all hardcoded secrets and open a remediation PR"
              outcome="Findings triaged, patch PR opened with recommendations"
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

        {/* FAQ */}
        <section
          id="faq"
          className="scroll-mt-20 px-6 py-20 md:px-10 md:py-28"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <SectionHeading eyebrow="Questions" title="Everything you might" accent="want to ask." />

          <div style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}>
            <FaqItem
              question="Does Diabolo need write access to my repository?"
              answer="Only what you grant. Agents authenticate through GitHub OAuth, and you choose which repositories they can reach. Work lands on a branch or a pull request — never straight to your default branch."
            />
            <FaqItem
              question="Where does the code actually run?"
              answer="In a fresh, isolated sandbox per task. Nothing is shared between runs, and the environment is torn down when the task finishes."
            />
            <FaqItem
              question="Which models can I use?"
              answer="Bring your own provider — OpenAI, Anthropic, OpenRouter, or any OpenAI-compatible base URL. You can pick a different model per task."
            />
            <FaqItem
              question="What does it cost during beta?"
              answer="Diabolo is free while in beta and no credit card is required to start. See the pricing page for what plans will look like afterwards."
            />
            <FaqItem
              question="What happens if an agent gets something wrong?"
              answer="You review every change before it merges. Agents surface their diffs, artifacts and reasoning, and you can follow up in the same session to correct course."
            />
          </div>
        </section>

        {/* CTA */}
        <section
          className="relative overflow-hidden px-6 py-20 md:px-10 md:py-32"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(600px 300px at 15% 100%, rgba(180,160,255,0.14), transparent 70%)",
            }}
          />
          <div className="relative">
            <div style={{ ...eyebrow, marginBottom: "1.5rem" }}>Get started</div>
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "clamp(2.25rem, 5.5vw, 3.25rem)",
                fontWeight: 400,
                lineHeight: 1.15,
                maxWidth: 520,
                marginBottom: "1.25rem",
                color: "#fff",
              }}
            >
              Start delegating. <em style={{ ...serif, color: ACCENT }}>Today.</em>
            </h2>
            <p
              style={{
                fontSize: 16.5,
                lineHeight: 1.7,
                color: TEXT_SECONDARY,
                maxWidth: 440,
                marginBottom: "2.25rem",
              }}
            >
              Connect a GitHub repo and run your first task in under a minute. Free while in beta.
            </p>

            <Link
              to="/login"
              className="bt-cta-light inline-flex items-center gap-2 rounded-full px-7 py-4 text-sm font-semibold"
              style={{ background: LIGHT, color: "#0e0e0e" }}
            >
              <RiGithubFill className="h-4 w-4" />
              Continue with GitHub
            </Link>

            <div
              className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2"
              style={{ fontSize: 12.5, color: TEXT_MUTED }}
            >
              <TrustItem>No credit card</TrustItem>
              <TrustItem>GitHub OAuth only</TrustItem>
              <TrustItem>Cancel anytime</TrustItem>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer style={{ background: "#0a0a0a", borderTop: `1px solid ${BORDER_LIGHT}` }}>
        <div className="mx-auto px-6 py-12 md:px-10 md:py-16" style={{ maxWidth: 1100 }}>
          <div className="mb-12 flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div>
              <div style={{ ...serif, color: "#fff", fontSize: 20, marginBottom: "0.75rem" }}>
                diabolo
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.45)",
                  maxWidth: 280,
                  lineHeight: 1.65,
                }}
              >
                AI agents for engineering teams. Run tasks in isolated sandboxes, on your schedule.
              </p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: "0.5rem" }}>
                Remote
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <Link to="/login" className="bt-footlink">
                Sign in
              </Link>
              <a href="#features" className="bt-footlink">
                Features
              </a>
              <Link to="/pricing" className="bt-footlink">
                Pricing
              </Link>
              <a href="#how-it-works" className="bt-footlink">
                How it works
              </a>
              <a href="#faq" className="bt-footlink">
                FAQ
              </a>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${BORDER_DARK}`, paddingTop: "1.5rem" }}>
            <p
              style={{
                fontSize: 11,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontStyle: "italic",
                color: "rgba(255,255,255,0.3)",
                lineHeight: 1.65,
                maxWidth: 680,
              }}
            >
              Diabolo is a beta product. AI agents may produce unexpected results. Always review
              agent output before merging to production.
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: "1rem" }}>
              &copy; {new Date().getFullYear()} Diabolo, Inc.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Hover, focus and motion styles kept out of the inline-style soup above. */
function PageStyles() {
  return (
    <style>{`
      .bt-navlink {
        font-size: 13px;
        color: rgba(255,255,255,0.55);
        padding: 6px 10px;
        border-radius: 999px;
        transition: color 150ms ease, background 150ms ease;
      }
      .bt-navlink:hover { color: #fff; background: rgba(255,255,255,0.05); }
      .bt-cta-light { transition: transform 150ms ease, box-shadow 200ms ease, opacity 150ms ease; }
      .bt-cta-light:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(240,236,230,0.14); }
      .bt-cta-ghost { transition: background 150ms ease, border-color 150ms ease; }
      .bt-cta-ghost:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.18) !important; }
      .bt-footlink {
        font-size: 13px;
        color: rgba(255,255,255,0.45);
        transition: color 150ms ease;
      }
      .bt-footlink:hover { color: #fff; }
      .bt-card { transition: background 200ms ease; }
      .bt-card:hover { background: rgba(255,255,255,0.045) !important; }
      .bt-task { transition: background 150ms ease; }
      .bt-task:hover { background: rgba(255,255,255,0.035); }
      .bt-faq > summary { list-style: none; cursor: pointer; }
      .bt-faq > summary::-webkit-details-marker { display: none; }
      .bt-faq[open] .bt-faq-chevron { transform: rotate(45deg); }
      @media (prefers-reduced-motion: reduce) {
        .bt-cta-light:hover { transform: none; }
      }
    `}</style>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="bt-navlink hidden sm:block">
      {children}
    </a>
  );
}

function TrustItem({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <RiCheckLine className="h-3.5 w-3.5" style={{ color: "rgba(18,201,5,0.7)" }} />
      {children}
    </span>
  );
}

function SectionHeading({
  eyebrow: label,
  title,
  accent,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-14">
      <div style={{ ...eyebrow, marginBottom: "1rem" }}>{label}</div>
      <h2
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "clamp(1.875rem, 4.2vw, 2.75rem)",
          fontWeight: 400,
          lineHeight: 1.15,
          maxWidth: 560,
          color: "#fff",
        }}
      >
        {title} <em style={{ ...serif, color: ACCENT }}>{accent}</em>
      </h2>
      {subtitle ? (
        <p
          style={{
            fontSize: 15.5,
            lineHeight: 1.7,
            color: TEXT_SECONDARY,
            maxWidth: 480,
            marginTop: "1rem",
          }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function TaskDisplay() {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{
        background: "linear-gradient(180deg, #171717, #121212)",
        border: `1px solid ${BORDER_LIGHT}`,
        boxShadow: "0 32px 80px -32px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.02)",
      }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-2 px-5 py-3.5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.25)" }}
      >
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a3a" }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a3a" }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a3a" }} />
        </div>
        <span className="ml-2 text-xs tracking-wide" style={{ color: "rgba(255,255,255,0.3)" }}>
          diabolo / task runner
        </span>
        <span
          className="ml-auto hidden items-center gap-1.5 text-xs sm:flex"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "rgba(18,201,5,0.6)" }} />
          3 agents connected
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
          progress={62}
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
  progress,
}: {
  label: string;
  status: "done" | "running" | "scheduled";
  meta: string;
  progress?: number;
}) {
  const dotBg = {
    done: "rgba(18,201,5,0.6)",
    running: ACCENT,
    scheduled: "rgba(255,255,255,0.22)",
  }[status];

  const badgeColor = {
    done: "rgba(18,201,5,0.8)",
    running: ACCENT,
    scheduled: "rgba(255,255,255,0.38)",
  }[status];

  const badgeLabel = { done: "Done", running: "Running", scheduled: "Scheduled" }[status];

  return (
    <div className="bt-task rounded-lg px-4 py-3">
      <div className="flex items-center justify-between">
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
            <span
              className="flex h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: dotBg }}
            />
          )}
          <span className="truncate text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
            {label}
          </span>
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-4">
          <span className="hidden text-xs sm:block" style={{ color: "rgba(255,255,255,0.3)" }}>
            {meta}
          </span>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ color: badgeColor, background: "rgba(255,255,255,0.05)" }}
          >
            {badgeLabel}
          </span>
        </div>
      </div>
      {progress === undefined ? null : (
        <div
          className="mt-3 ml-[18px] h-[3px] overflow-hidden rounded-full"
          style={{ background: "rgba(255,255,255,0.06)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: `linear-gradient(90deg, rgba(180,160,255,0.35), ${ACCENT})`,
            }}
          />
        </div>
      )}
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
      className="flex flex-col items-center gap-2 py-9 text-center"
      style={divider ? { borderLeft: `1px solid ${BORDER_LIGHT}` } : undefined}
    >
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "clamp(1.5rem, 2.8vw, 2rem)",
          fontWeight: 400,
          color: "#fff",
        }}
      >
        {value}
      </span>
      <span style={{ ...eyebrow, letterSpacing: "0.12em" }}>{label}</span>
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
        className="inline-flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          letterSpacing: "0.05em",
          color: ACCENT,
          background: "rgba(180,160,255,0.1)",
          border: "1px solid rgba(180,160,255,0.16)",
        }}
      >
        {number}
      </span>
      <div className="flex flex-col gap-2">
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{title}</h3>
        <p style={{ fontSize: 14.5, lineHeight: 1.7, color: TEXT_SECONDARY }}>{description}</p>
      </div>
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
    <div
      className="bt-card flex flex-col gap-3 p-8"
      style={{
        borderRight: `1px solid ${BORDER_LIGHT}`,
        borderBottom: `1px solid ${BORDER_LIGHT}`,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
        style={{
          background: "rgba(180,160,255,0.1)",
          border: "1px solid rgba(180,160,255,0.14)",
          color: ACCENT,
        }}
      >
        {icon}
      </span>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginTop: 4 }}>{title}</h3>
      <p style={{ fontSize: 14.5, lineHeight: 1.7, color: TEXT_SECONDARY }}>{description}</p>
    </div>
  );
}

function UseCaseRow({ prompt, outcome }: { prompt: string; outcome: string }) {
  return (
    <div
      className="bt-card flex flex-col gap-4 p-8"
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
            color: ACCENT,
            marginTop: 3,
            flexShrink: 0,
          }}
        >
          $
        </span>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: TEXT_PRIMARY }}>{prompt}</p>
      </div>
      <div
        className="flex items-start gap-3 rounded-lg px-3.5 py-3"
        style={{ background: "rgba(255,255,255,0.045)", border: `1px solid ${BORDER_DARK}` }}
      >
        <RiCheckLine
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          style={{ color: "rgba(18,201,5,0.75)" }}
        />
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: TEXT_SECONDARY }}>{outcome}</p>
      </div>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="bt-faq" style={{ borderBottom: `1px solid ${BORDER_LIGHT}` }}>
      <summary className="flex items-center justify-between gap-6 py-6">
        <span style={{ fontSize: 16, fontWeight: 500, color: TEXT_PRIMARY }}>{question}</span>
        <span
          className="bt-faq-chevron shrink-0 text-lg leading-none"
          style={{ color: TEXT_MUTED, transition: "transform 200ms ease" }}
        >
          +
        </span>
      </summary>
      <p
        style={{
          fontSize: 14.5,
          lineHeight: 1.75,
          color: TEXT_SECONDARY,
          maxWidth: 640,
          paddingBottom: "1.5rem",
        }}
      >
        {answer}
      </p>
    </details>
  );
}
