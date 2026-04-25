import { RiArrowRightLine, RiCheckLine, RiCloseLine, RiGithubFill } from "@remixicon/react";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

const BODY_BG = "#0e0e0e";
const LIGHT = "#f0ece6";
const BORDER_LIGHT = "rgba(255,255,255,0.07)";
const BORDER_DARK = "rgba(255,255,255,0.04)";
const TEXT_PRIMARY = "rgba(255,255,255,0.82)";
const TEXT_SECONDARY = "rgba(255,255,255,0.42)";
const TEXT_MUTED = "rgba(255,255,255,0.28)";
const TEXT_DIM = "rgba(255,255,255,0.18)";

const serif = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic" as const,
};

function PricingPage() {
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
          <Link
            to="/beta"
            style={{
              ...serif,
              color: "#fff",
              fontSize: 20,
              letterSpacing: "-0.01em",
              textDecoration: "none",
            }}
          >
            diabolo
          </Link>
          <div className="flex items-center gap-6">
            <Link
              to="/beta"
              className="hidden transition-colors hover:text-white sm:block"
              style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}
            >
              Back to overview
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

      {/* Main container */}
      <div
        className="mx-auto"
        style={{
          maxWidth: 1100,
          borderLeft: `1px solid ${BORDER_LIGHT}`,
          borderRight: `1px solid ${BORDER_LIGHT}`,
        }}
      >
        {/* Header */}
        <section className="px-6 pt-20 pb-16 md:px-10 md:pt-28 md:pb-20">
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
            Pricing
          </div>

          <h1
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(2.5rem, 5.5vw, 4rem)",
              fontWeight: 400,
              lineHeight: 1.15,
              letterSpacing: "-0.01em",
              maxWidth: 620,
              marginBottom: "1.25rem",
              color: TEXT_PRIMARY,
            }}
          >
            Start free.{" "}
            <em style={{ ...serif, color: TEXT_SECONDARY }}>Scale when you're ready.</em>
          </h1>

          <p
            style={{
              fontSize: 16,
              lineHeight: 1.75,
              color: TEXT_SECONDARY,
              maxWidth: 460,
            }}
          >
            Every plan includes isolated sandboxes, GitHub integration, and any-LLM support.
          </p>
        </section>

        {/* Pricing cards */}
        <section
          className="px-6 pb-24 md:px-10 md:pb-32"
          style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}
        >
          <div
            className="grid gap-0 lg:grid-cols-3"
            style={{ borderLeft: `1px solid ${BORDER_LIGHT}` }}
          >
            <PricingCard
              name="Free"
              tagline="Try it out"
              cta="Get started"
              ctaHref="/login"
              highlight={false}
              features={[
                { label: "1 concurrent session", included: true },
                { label: "Sessions up to 30 min", included: true },
                { label: "One session per 5 hours", included: true },
                { label: "1 active project", included: true },
                { label: "Collaboration", included: false },
                { label: "Organisations", included: false },
                { label: "Scheduled runs", included: false },
                { label: "Codex provider", included: false },
              ]}
              limits={[
                { key: "Concurrent tasks", value: "1" },
                { key: "Session length", value: "30 min" },
                { key: "Cooldown", value: "5 hours" },
                { key: "Projects", value: "1" },
                { key: "Collaborators", value: "—" },
                { key: "Org size", value: "—" },
              ]}
            />
            <PricingCard
              name="Pro"
              tagline="For small teams"
              cta="Get started"
              ctaHref="/login"
              highlight={true}
              features={[
                { label: "10 concurrent tasks", included: true },
                { label: "3 projects", included: true },
                { label: "Up to 10 collaborators", included: true },
                { label: "Organisation (up to 5 members)", included: true },
                { label: "Priority execution queue", included: true },
                { label: "Scheduled runs", included: true },
                { label: "Codex provider", included: true },
              ]}
              limits={[
                { key: "Concurrent tasks", value: "10" },
                { key: "Session length", value: "Unlimited" },
                { key: "Cooldown", value: "None" },
                { key: "Projects", value: "3" },
                { key: "Collaborators", value: "10 / project" },
                { key: "Org size", value: "5 members" },
              ]}
            />
            <PricingCard
              name="Max"
              tagline="For growing orgs"
              cta="Get started"
              ctaHref="/login"
              highlight={false}
              features={[
                { label: "20 concurrent tasks", included: true },
                { label: "20 concurrent projects", included: true },
                { label: "Up to 50 collaborators", included: true },
                { label: "Organisation (up to 50 members)", included: true },
                { label: "Priority execution queue", included: true },
                { label: "Scheduled runs", included: true },
                { label: "Codex provider", included: true },
              ]}
              limits={[
                { key: "Concurrent tasks", value: "20" },
                { key: "Session length", value: "Unlimited" },
                { key: "Cooldown", value: "None" },
                { key: "Projects", value: "20" },
                { key: "Collaborators", value: "50 / project" },
                { key: "Org size", value: "50 members" },
              ]}
            />
          </div>
        </section>

        {/* Comparison table */}
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
              Compare plans
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
              Everything side by side,{" "}
              <em style={{ ...serif, color: TEXT_SECONDARY }}>no surprises.</em>
            </h2>
          </div>

          <div
            className="overflow-x-auto"
            style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 4 }}
          >
            <table className="w-full border-collapse" style={{ minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER_LIGHT}` }}>
                  <th
                    className="p-5 text-left"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: TEXT_MUTED,
                      fontWeight: 400,
                      width: "34%",
                    }}
                  >
                    Feature
                  </th>
                  {["Free", "Pro", "Max"].map((plan, i) => (
                    <th
                      key={plan}
                      className="p-5 text-center"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: i === 1 ? TEXT_PRIMARY : TEXT_SECONDARY,
                        borderLeft: `1px solid ${BORDER_LIGHT}`,
                        background: i === 1 ? "rgba(255,255,255,0.03)" : "transparent",
                      }}
                    >
                      {plan}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: "Concurrent tasks", free: "1", pro: "10", max: "20" },
                  {
                    feature: "Session duration",
                    free: "≤ 30 min",
                    pro: "Unlimited",
                    max: "Unlimited",
                  },
                  { feature: "Session cooldown", free: "5 hours", pro: "None", max: "None" },
                  { feature: "Active projects", free: "1", pro: "3", max: "20" },
                  { feature: "Collaborators per project", free: "—", pro: "10", max: "50" },
                  { feature: "Collaboration", free: false, pro: true, max: true },
                  { feature: "Organisations", free: false, pro: true, max: true },
                  { feature: "Org member limit", free: "—", pro: "5", max: "50" },
                  { feature: "Scheduled runs", free: false, pro: true, max: true },
                  { feature: "Priority queue", free: false, pro: true, max: true },
                  { feature: "Codex provider", free: false, pro: true, max: true },
                ].map((row, i) => (
                  <CompareRow
                    key={row.feature}
                    feature={row.feature}
                    free={row.free}
                    pro={row.pro}
                    max={row.max}
                    dimmed={i % 2 === 0}
                  />
                ))}
              </tbody>
            </table>
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
            Start free today. <em style={{ ...serif, color: TEXT_SECONDARY }}>Upgrade anytime.</em>
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
            Connect a GitHub repo and run your first task in under a minute.
          </p>

          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: LIGHT, color: "#0e0e0e" }}
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
              Free forever
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
            </div>
            <div className="flex items-center gap-8">
              <Link
                to="/login"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                Sign in
              </Link>
              <Link
                to="/beta"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                Features
              </Link>
              <Link
                to="/pricing"
                className="transition-colors hover:text-white"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
              >
                Pricing
              </Link>
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

function PricingCard({
  name,
  tagline,
  cta,
  ctaHref,
  highlight,
  features,
  limits,
}: {
  name: string;
  tagline: string;
  cta: string;
  ctaHref: string;
  highlight: boolean;
  features: { label: string; included: boolean }[];
  limits: { key: string; value: string }[];
}) {
  return (
    <div
      className="flex flex-col p-8"
      style={{
        borderRight: `1px solid ${BORDER_LIGHT}`,
        borderBottom: `1px solid ${BORDER_LIGHT}`,
        background: highlight ? "rgba(255,255,255,0.03)" : "transparent",
        position: "relative",
      }}
    >
      {highlight && (
        <div
          className="absolute top-0 right-0 left-0"
          style={{
            height: 1,
            background: "rgba(255,255,255,0.18)",
          }}
        />
      )}

      {/* Plan name */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-3">
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "clamp(1.25rem, 2vw, 1.5rem)",
              fontWeight: 400,
              color: TEXT_PRIMARY,
            }}
          >
            {name}
          </span>
          {highlight && (
            <span
              className="rounded-full px-2.5 py-0.5"
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: "rgba(255,255,255,0.1)",
                color: TEXT_SECONDARY,
              }}
            >
              Popular
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: TEXT_MUTED }}>{tagline}</p>
      </div>

      {/* Limits at a glance */}
      <div
        className="mb-6 grid grid-cols-2 gap-x-4 gap-y-3 rounded-md p-4"
        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER_LIGHT}` }}
      >
        {limits.map(({ key, value }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_DIM,
              }}
            >
              {key}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: value === "—" ? TEXT_DIM : TEXT_PRIMARY,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Features */}
      <ul className="mb-8 flex flex-1 flex-col gap-3">
        {features.map(({ label, included }) => (
          <li key={label} className="flex items-start gap-3">
            {included ? (
              <RiCheckLine
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                style={{ color: "rgba(18,201,5,0.65)" }}
              />
            ) : (
              <RiCloseLine className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TEXT_DIM }} />
            )}
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.6,
                color: included ? TEXT_SECONDARY : TEXT_DIM,
              }}
            >
              {label}
            </span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <Link
        to={ctaHref as "/login"}
        className="flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
        style={
          highlight
            ? { background: LIGHT, color: "#0e0e0e" }
            : { background: "rgba(255,255,255,0.07)", color: TEXT_PRIMARY }
        }
      >
        {cta}
        <RiArrowRightLine className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function CompareCell({
  background,
  isMiddle,
  value,
}: {
  background: string;
  isMiddle?: boolean;
  value: string | boolean;
}) {
  return (
    <td
      className="p-5 text-center"
      style={{
        borderLeft: `1px solid ${BORDER_LIGHT}`,
        background: isMiddle ? `rgba(255,255,255,0.02)` : background,
        fontSize: 13,
      }}
    >
      {typeof value === "boolean" ? (
        value ? (
          <RiCheckLine className="mx-auto h-3.5 w-3.5" style={{ color: "rgba(18,201,5,0.65)" }} />
        ) : (
          <span style={{ color: TEXT_DIM }}>—</span>
        )
      ) : (
        <span style={{ color: value === "—" ? TEXT_DIM : TEXT_SECONDARY }}>{value}</span>
      )}
    </td>
  );
}

function CompareRow({
  feature,
  free,
  pro,
  max,
  dimmed,
}: {
  feature: string;
  free: string | boolean;
  pro: string | boolean;
  max: string | boolean;
  dimmed: boolean;
}) {
  const bg = dimmed ? "rgba(255,255,255,0.015)" : "transparent";

  return (
    <tr style={{ borderBottom: `1px solid ${BORDER_DARK}`, background: bg }}>
      <td className="p-5" style={{ fontSize: 13, color: TEXT_SECONDARY }}>
        {feature}
      </td>
      <CompareCell background={bg} value={free} />
      <CompareCell background={bg} value={pro} isMiddle />
      <CompareCell background={bg} value={max} />
    </tr>
  );
}
