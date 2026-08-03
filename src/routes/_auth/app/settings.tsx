import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2Icon,
  CopyIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  WifiOffIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ProviderUsageChart } from "@/components/app/provider-usage-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { billingSummaryQueryOptions } from "@/lib/billing/queries";
import {
  $disconnectCodexProvider,
  $pollCodexDeviceAuthorization,
  $saveUserLlmProviders,
  $startCodexDeviceAuthorization,
} from "@/lib/user/functions";
import {
  createProviderDraft,
  DEFAULT_CODEX_MODEL,
  setProviderDraftKind,
  toSerializableProviders,
  type ProviderDraft,
} from "@/lib/user/provider-drafts";
import {
  codexModelsQueryOptions,
  codexSharedLoginStatusQueryOptions,
  userProviderUsageSummaryQueryOptions,
  userLlmProvidersQueryOptions,
} from "@/lib/user/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/app/settings")({
  component: SettingsPage,
});

type DeviceAuthState = {
  expiresAt: string;
  intervalSeconds: number;
  userCode: string;
  verificationUrl: string;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CodexStatusBadge({ status }: { status: "connected" | "disconnected" | "pending" }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400">
        <span className="size-1.5 rounded-full bg-green-500" />
        Connected
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
        Waiting for approval
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
      Disconnected
    </span>
  );
}

function ProviderTypeToggle({
  value,
  onChange,
}: {
  value: "manual" | "codex";
  onChange: (v: "manual" | "codex") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
      {(["manual", "codex"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onChange(kind)}
          className={cn(
            "rounded-md px-3 py-1 text-xs font-medium transition-all",
            value === kind
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {kind === "codex" ? (
            <span className="flex items-center gap-1.5">
              <ZapIcon className="size-3" />
              Codex
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <KeyRoundIcon className="size-3" />
              API Key
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function SettingsPage() {
  const queryClient = useQueryClient();

  const [draftProviders, setDraftProviders] = useState<ProviderDraft[] | null>(null);
  const [pendingDeviceAuth, setPendingDeviceAuth] = useState<DeviceAuthState | null>(null);
  const hasPendingAuth = pendingDeviceAuth !== null;

  const providersQuery = useQuery({
    ...userLlmProvidersQueryOptions(),
    refetchInterval: hasPendingAuth ? 2000 : false,
  });
  const isProvidersLoading = providersQuery.isPending && !providersQuery.isFetched;

  const allProviders = providersQuery.data ?? [];
  const personalProviders = allProviders.filter(
    (provider) => provider.scope === "personal",
  ) as ProviderDraft[];
  const providers = (draftProviders ?? personalProviders) as ProviderDraft[];
  const hasUnsavedChanges = draftProviders !== null;
  const codexProviders = providers.filter((provider) => provider.providerKind === "codex");

  const saveFn = useServerFn($saveUserLlmProviders);
  const startCodexAuth = useServerFn($startCodexDeviceAuthorization);
  const pollCodexAuth = useServerFn($pollCodexDeviceAuthorization);
  const disconnectCodexAuth = useServerFn($disconnectCodexProvider);

  const codexSharedLoginQuery = useQuery({
    ...codexSharedLoginStatusQueryOptions(),
    queryKey: [...codexSharedLoginStatusQueryOptions().queryKey],
    staleTime: 30_000,
    refetchInterval: hasPendingAuth ? 2000 : false,
  });
  const codexModelsQuery = useQuery(codexModelsQueryOptions());
  const billingSummaryQuery = useQuery(billingSummaryQueryOptions());

  const activePendingDeviceAuth =
    pendingDeviceAuth && codexSharedLoginQuery.data?.authStatus !== "connected"
      ? pendingDeviceAuth
      : null;
  const codexStatus = activePendingDeviceAuth
    ? "pending"
    : (codexSharedLoginQuery.data?.authStatus ?? "disconnected");
  const sharedCodexAuthenticatedAt = codexSharedLoginQuery.data?.codexAuthenticatedAt ?? null;
  const sharedCodexAuthError = codexSharedLoginQuery.data?.codexAuthError ?? null;
  const availableCodexModels = codexModelsQuery.data ?? [];
  const userProviderUsageQuery = useQuery(userProviderUsageSummaryQueryOptions());

  const { mutate: saveProviders, isPending: isSaving } = useMutation({
    mutationFn: () =>
      saveFn({
        data: { providers: toSerializableProviders(providers) },
      }),
    onSuccess: async () => {
      setDraftProviders(null);
      await queryClient.invalidateQueries(userLlmProvidersQueryOptions());
      toast.success("Providers saved.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save providers.");
    },
  });

  const startCodexAuthMutation = useMutation({
    mutationFn: () => startCodexAuth(),
    onSuccess: (payload) => {
      setPendingDeviceAuth(payload);
      window.open(payload.verificationUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start Codex login.");
    },
  });

  useEffect(() => {
    if (!pendingDeviceAuth) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const result = await pollCodexAuth();
        if (cancelled) return;

        if (result.status === "pending") {
          timeout = setTimeout(poll, pendingDeviceAuth.intervalSeconds * 1000);
          return;
        }

        setPendingDeviceAuth(null);

        if (result.status === "expired") {
          toast.error("The Codex login expired. Start sign-in again.");
          return;
        }

        await Promise.all([
          queryClient.invalidateQueries(userLlmProvidersQueryOptions()),
          queryClient.invalidateQueries({ queryKey: ["codex-shared-login-status"] }),
          queryClient.invalidateQueries(codexModelsQueryOptions()),
        ]);
        toast.success("Codex connected.");
      } catch (error) {
        if (cancelled) return;
        setPendingDeviceAuth(null);
        toast.error(error instanceof Error ? error.message : "Failed to complete Codex login.");
      }
    };

    timeout = setTimeout(poll, pendingDeviceAuth.intervalSeconds * 1000);

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [pendingDeviceAuth, pollCodexAuth, queryClient]);

  const disconnectCodexAuthMutation = useMutation({
    mutationFn: () => disconnectCodexAuth(),
    onSuccess: async () => {
      setPendingDeviceAuth(null);
      await queryClient.invalidateQueries(userLlmProvidersQueryOptions());
      await queryClient.invalidateQueries({ queryKey: ["codex-shared-login-status"] });
      await queryClient.invalidateQueries(codexModelsQueryOptions());
      toast.success("Codex disconnected.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Codex.");
    },
  });

  const sortedProviders = [...providers].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const updateProvider = (providerId: string, patch: Partial<ProviderDraft>) => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      return source.map((p) => (p.id === providerId ? { ...p, ...patch } : p));
    });
  };

  const setProviderKind = (providerId: string, providerKind: "codex" | "manual") => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      return source.map((provider) =>
        provider.id === providerId ? setProviderDraftKind(provider, providerKind) : provider,
      );
    });
  };

  const setDefaultProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      return source.map((p) => ({ ...p, isDefault: p.id === providerId }));
    });
  };

  const addProvider = (providerKind: "codex" | "manual" = "manual") => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      const nextProvider = createProviderDraft("personal", {
        authStatus: providerKind === "codex" ? "disconnected" : "connected",
        isDefault: source.length === 0,
        name: "",
        providerModel: providerKind === "codex" ? DEFAULT_CODEX_MODEL : "",
      });

      return [
        ...source,
        providerKind === "codex" ? setProviderDraftKind(nextProvider, "codex") : nextProvider,
      ];
    });
  };

  const removeProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      const next = source.filter((p) => p.id !== providerId);
      if (next.length > 0 && !next.some((p) => p.isDefault)) {
        return next.map((p, i) => (i === 0 ? { ...p, isDefault: true } : p));
      }
      return next;
    });
  };

  const resetDrafts = () => {
    setDraftProviders(null);
    setPendingDeviceAuth(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-6">
        <h1 className="text-base font-medium text-foreground">Settings</h1>
      </div>

      {/* Scrollable content */}
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-2xl space-y-10">
          <section>
            <div className="mb-4">
              <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
                Billing
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your subscription, invoices, and payment method.
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card shadow-xs">
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <CreditCardIcon className="size-4.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {billingSummaryQuery.isPending
                          ? "Loading plan"
                          : BILLING_PLANS[billingSummaryQuery.data?.plan ?? "free"].name}
                      </span>
                      {billingSummaryQuery.data?.stripeSubscriptionStatus ? (
                        <Badge variant="outline">
                          {billingSummaryQuery.data.stripeSubscriptionStatus}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {billingSummaryQuery.data?.currentPeriodEnd
                        ? `Renews ${new Date(billingSummaryQuery.data.currentPeriodEnd).toLocaleDateString()}`
                        : "Free plan"}
                    </p>
                  </div>
                </div>

                {billingSummaryQuery.data?.canManageBilling ? (
                  <form action="/api/billing/portal" method="post">
                    <Button type="submit" variant="outline" size="sm">
                      <ExternalLinkIcon className="size-3.5" />
                      Manage billing
                    </Button>
                  </form>
                ) : (
                  <a href="/pricing">
                    <Button type="button" variant="outline" size="sm">
                      <ExternalLinkIcon className="size-3.5" />
                      View plans
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </section>

          {/* ── Section: Codex ─────────────────────────────────────────────── */}
          <section>
            <div className="mb-4">
              <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
                Codex
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in once to use Codex across all your Codex providers.
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card shadow-xs">
              {/* Status row */}
              <div className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      codexStatus === "connected"
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : codexStatus === "pending"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {codexStatus === "connected" ? (
                      <CheckCircle2Icon className="size-4.5" />
                    ) : codexStatus === "pending" ? (
                      <Loader2Icon className="size-4.5 animate-spin" />
                    ) : (
                      <WifiOffIcon className="size-4.5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">Codex login</span>
                      <CodexStatusBadge status={codexStatus} />
                    </div>
                    {sharedCodexAuthenticatedAt && codexStatus === "connected" ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Connected {new Date(sharedCodexAuthenticatedAt).toLocaleString()}
                        {codexProviders.length > 0
                          ? ` · ${codexProviders.length} provider${codexProviders.length !== 1 ? "s" : ""} using this`
                          : ""}
                      </p>
                    ) : codexStatus === "disconnected" ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Connect to use Codex providers
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {codexStatus === "connected" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disconnectCodexAuthMutation.isPending}
                      onClick={() => disconnectCodexAuthMutation.mutate()}
                    >
                      {disconnectCodexAuthMutation.isPending ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : null}
                      Disconnect
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant={codexStatus === "connected" ? "outline" : "default"}
                    size="sm"
                    disabled={startCodexAuthMutation.isPending}
                    onClick={() => startCodexAuthMutation.mutate()}
                  >
                    {startCodexAuthMutation.isPending ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <ExternalLinkIcon className="size-3.5" />
                    )}
                    {codexStatus === "connected" ? "Reconnect" : "Sign in with Codex"}
                  </Button>
                </div>
              </div>

              {/* Error banner */}
              {sharedCodexAuthError ? (
                <div className="mx-4 mb-4 rounded-xl border border-destructive/20 bg-destructive/6 px-4 py-3 text-sm text-destructive">
                  {sharedCodexAuthError}
                </div>
              ) : null}

              {/* Pending auth flow */}
              {activePendingDeviceAuth ? (
                <div className="border-t border-border/60 px-5 py-4">
                  <p className="mb-3 text-sm font-medium text-foreground">Complete sign-in</p>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3 rounded-xl bg-muted/50 px-4 py-3">
                      <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">
                          Enter this one-time code in the OpenAI browser tab:
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="rounded-lg border border-border/70 bg-background px-3 py-1.5 font-mono text-base font-semibold tracking-widest text-foreground">
                            {activePendingDeviceAuth.userCode}
                          </code>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Copy Codex login code"
                            onClick={() => {
                              void navigator.clipboard.writeText(activePendingDeviceAuth.userCode);
                              toast.success("Login code copied.");
                            }}
                          >
                            <CopyIcon className="size-3.5" />
                          </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          This page checks for approval automatically. Expires{" "}
                          {new Date(activePendingDeviceAuth.expiresAt).toLocaleTimeString()}.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(
                          activePendingDeviceAuth.verificationUrl,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      Open OpenAI sign-in
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <ProviderUsageChart
            title="Provider usage"
            description="Daily token consumption for your personal providers."
            usage={userProviderUsageQuery.data}
          />

          {/* ── Section: Providers ──────────────────────────────────────────── */}
          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
                  Providers
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  The provider selected on a task sets its default model.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addProvider("manual")}
                >
                  <PlusIcon className="size-3.5" />
                  API key
                </Button>
                <Button type="button" size="sm" onClick={() => addProvider("codex")}>
                  <ZapIcon className="size-3.5" />
                  Codex
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {isProvidersLoading && providers.length === 0 ? (
                <div className="flex items-center justify-center rounded-2xl border border-border/60 bg-card px-5 py-10">
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : null}

              {!isProvidersLoading && sortedProviders.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 bg-card/40 px-5 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No providers yet</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    Add an API key provider for any OpenAI-compatible endpoint, or add a Codex
                    provider once you've connected above.
                  </p>
                  <div className="mt-1 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addProvider("manual")}
                    >
                      <PlusIcon className="size-3.5" />
                      Add API key provider
                    </Button>
                    <Button type="button" size="sm" onClick={() => addProvider("codex")}>
                      <ZapIcon className="size-3.5" />
                      Add Codex provider
                    </Button>
                  </div>
                </div>
              ) : null}

              {sortedProviders.map((provider) => {
                const isCodex = provider.providerKind === "codex";

                return (
                  <div
                    key={provider.id}
                    className="rounded-2xl border border-border/70 bg-card shadow-xs"
                  >
                    {/* Card header */}
                    <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3.5">
                      <div
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-lg",
                          isCodex
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        )}
                      >
                        {isCodex ? (
                          <ZapIcon className="size-3.5" />
                        ) : (
                          <KeyRoundIcon className="size-3.5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {provider.name || (
                              <span className="text-muted-foreground italic">
                                Untitled provider
                              </span>
                            )}
                          </span>
                          {provider.isDefault && (
                            <Badge
                              variant="warning"
                              className="inline-flex items-center gap-1 px-1.5"
                            >
                              <StarIcon className="size-2.5" />
                              Default
                            </Badge>
                          )}
                        </div>
                        {provider.providerModel ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {provider.providerModel}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {!provider.isDefault && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setDefaultProvider(provider.id)}
                          >
                            <StarIcon className="size-3.5" />
                            Set default
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeProvider(provider.id)}
                        >
                          <Trash2Icon className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Card body */}
                    <div className="px-5 py-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* Display name */}
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`name-${provider.id}`} className="text-xs">
                            Display name
                          </Label>
                          <Input
                            id={`name-${provider.id}`}
                            value={provider.name}
                            onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                            placeholder={isCodex ? "My Codex" : "OpenAI production"}
                            className="h-8 text-sm"
                          />
                        </div>

                        {/* Provider type */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs leading-none font-medium text-foreground">
                            Type
                          </span>
                          <div className="flex h-8 items-center">
                            <ProviderTypeToggle
                              value={provider.providerKind}
                              onChange={(kind) => setProviderKind(provider.id, kind)}
                            />
                          </div>
                        </div>

                        {/* Provider ID */}
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`pid-${provider.id}`} className="text-xs">
                            Provider ID
                          </Label>
                          <Input
                            id={`pid-${provider.id}`}
                            value={provider.providerId}
                            onChange={(e) =>
                              updateProvider(provider.id, {
                                providerId: e.target.value.trim().toLowerCase(),
                              })
                            }
                            disabled={isCodex}
                            placeholder={isCodex ? "codex" : "openai"}
                            className="h-8 font-mono text-sm"
                          />
                        </div>

                        {/* Default model */}
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`model-${provider.id}`} className="text-xs">
                            Default model
                          </Label>
                          {isCodex ? (
                            <Select
                              value={provider.providerModel || undefined}
                              onValueChange={(v) =>
                                updateProvider(provider.id, {
                                  providerModel: v ?? DEFAULT_CODEX_MODEL,
                                })
                              }
                            >
                              <SelectTrigger
                                id={`model-${provider.id}`}
                                className="h-8 w-full text-sm"
                              >
                                <SelectValue placeholder="Select model" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableCodexModels.map((model) => (
                                  <SelectItem key={model} value={model}>
                                    {model}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              id={`model-${provider.id}`}
                              value={provider.providerModel}
                              onChange={(e) =>
                                updateProvider(provider.id, { providerModel: e.target.value })
                              }
                              placeholder="gpt-4o"
                              className="h-8 text-sm"
                            />
                          )}
                        </div>

                        {isCodex ? (
                          /* Codex auth note */
                          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 sm:col-span-2">
                            <CheckCircle2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">
                              Uses the shared Codex login above — no API key needed.
                              {availableCodexModels.length > 0
                                ? ` ${availableCodexModels.length} model${availableCodexModels.length !== 1 ? "s" : ""} available.`
                                : ""}
                            </p>
                          </div>
                        ) : (
                          <>
                            {/* Base URL */}
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                              <Label htmlFor={`url-${provider.id}`} className="text-xs">
                                API base URL
                              </Label>
                              <Input
                                id={`url-${provider.id}`}
                                value={provider.providerBaseUrl}
                                onChange={(e) =>
                                  updateProvider(provider.id, { providerBaseUrl: e.target.value })
                                }
                                placeholder="https://api.openai.com/v1"
                                className="h-8 font-mono text-sm"
                              />
                            </div>

                            {/* API key */}
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                              <Label htmlFor={`key-${provider.id}`} className="text-xs">
                                API key
                              </Label>
                              <Input
                                id={`key-${provider.id}`}
                                type="password"
                                autoComplete="off"
                                value={provider.providerApiKey}
                                onChange={(e) =>
                                  updateProvider(provider.id, { providerApiKey: e.target.value })
                                }
                                placeholder="sk-..."
                                className="h-8 font-mono text-sm"
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* ── Sticky save bar ────────────────────────────────────────────────── */}
      {hasUnsavedChanges ? (
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border/60 bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <p className="text-sm text-muted-foreground">You have unsaved changes.</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={isSaving} onClick={resetDrafts}>
              Discard
            </Button>
            <Button size="sm" disabled={isSaving} onClick={() => saveProviders()}>
              {isSaving ? (
                <>
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
