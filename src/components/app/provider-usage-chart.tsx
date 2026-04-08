import { cn } from "@/lib/utils";

const SERIES_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

type ProviderUsageSummary = {
  days: Array<{
    date: string;
    providerId: string;
    providerName: string;
    totalTokens: number;
  }>;
  periodDays: number;
  periodStart: string;
  providers: Array<{
    inputTokens: number;
    outputTokens: number;
    providerId: string;
    providerKind: string;
    providerName: string;
    totalTokens: number;
  }>;
};

const formatTokens = (value: number) => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return `${value}`;
};

export function ProviderUsageChart({
  className,
  description,
  title,
  usage,
}: {
  className?: string;
  description: string;
  title: string;
  usage: ProviderUsageSummary | undefined;
}) {
  const periodStart = usage ? new Date(usage.periodStart) : new Date();
  const dayLabels = Array.from({ length: usage?.periodDays ?? 30 }, (_, index) => {
    const date = new Date(periodStart);
    date.setDate(date.getDate() + index);
    return date.toISOString().slice(0, 10);
  });

  const providerSeries = (usage?.providers ?? []).map((provider, index) => {
    const color = SERIES_COLORS[index % SERIES_COLORS.length];
    const points = dayLabels.map((date) => {
      const dayEntry = usage?.days.find(
        (entry) => entry.date === date && entry.providerId === provider.providerId,
      );

      return {
        date,
        value: dayEntry?.totalTokens ?? 0,
      };
    });

    return {
      ...provider,
      color,
      points,
    };
  });

  const maxValue = Math.max(
    1,
    ...providerSeries.flatMap((provider) => provider.points.map((point) => point.value)),
  );
  const chartWidth = 640;
  const chartHeight = 220;
  const totalTokens = providerSeries.reduce((sum, provider) => sum + provider.totalTokens, 0);

  const buildPath = (points: Array<{ date: string; value: number }>) =>
    points
      .map((point, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * chartWidth;
        const y = chartHeight - (point.value / maxValue) * chartHeight;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <section
      className={cn("rounded-2xl border border-border/70 bg-card px-6 py-6 shadow-xs", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="text-right">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">Last 30 days</p>
          <p className="mt-1 text-2xl font-semibold text-foreground">{formatTokens(totalTokens)}</p>
        </div>
      </div>

      {providerSeries.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border/70 bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          No token usage recorded yet for these providers.
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-muted/20 px-4 py-4">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatTokens(maxValue)} tokens</span>
              <span>Daily total per provider</span>
            </div>
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="h-56 w-full overflow-visible"
              role="img"
              aria-label={`${title} token usage over time`}
            >
              {[0, 0.5, 1].map((ratio) => {
                const y = (1 - ratio) * chartHeight;
                return (
                  <line
                    key={ratio}
                    x1="0"
                    x2={chartWidth}
                    y1={y}
                    y2={y}
                    stroke="color-mix(in srgb, var(--border) 80%, transparent)"
                    strokeDasharray="4 6"
                    strokeWidth="1"
                  />
                );
              })}
              {providerSeries.map((provider) => (
                <path
                  key={provider.providerId}
                  d={buildPath(provider.points)}
                  fill="none"
                  stroke={provider.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                />
              ))}
            </svg>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{new Date(dayLabels[0] ?? periodStart).toLocaleDateString()}</span>
              <span>{new Date(dayLabels.at(-1) ?? periodStart).toLocaleDateString()}</span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {providerSeries.map((provider) => (
              <div
                key={provider.providerId}
                className="rounded-xl border border-border/60 bg-background/70 px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="mt-0.5 size-2.5 rounded-full"
                        style={{ backgroundColor: provider.color }}
                      />
                      <h3 className="text-sm font-medium text-foreground">
                        {provider.providerName}
                      </h3>
                    </div>
                    <p className="mt-1 text-xs tracking-[0.18em] text-muted-foreground uppercase">
                      {provider.providerKind}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {formatTokens(provider.totalTokens)}
                  </p>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  In {formatTokens(provider.inputTokens)} · Out{" "}
                  {formatTokens(provider.outputTokens)}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
