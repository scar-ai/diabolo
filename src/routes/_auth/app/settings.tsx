import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OPENAI_CODEX_RESPONSES_PROVIDER_ID } from "@/lib/opencode/config";
import {
  $completeCodexLogin,
  $disconnectCodexProvider,
  $saveUserLlmProviders,
  $startCodexDeviceAuthorization,
} from "@/lib/user/functions";
import { userLlmProvidersQueryOptions } from "@/lib/user/queries";

export const Route = createFileRoute("/_auth/app/settings")({
  component: SettingsPage,
});

type ProviderDraft = {
  authStatus?: "connected" | "disconnected" | "pending";
  canManage?: boolean;
  codexAuthenticatedAt?: string | null;
  codexAuthError?: string | null;
  id: string;
  isDefault: boolean;
  name: string;
  providerApiKey: string;
  providerBaseUrl: string;
  providerId: string;
  providerKind: "codex" | "manual";
  providerModel: string;
  scope?: string;
};

type DeviceAuthState = {
  authorizeUrl: string;
  expiresAt: string;
  redirectUri: string;
};

const createProviderDraft = (overrides?: Partial<ProviderDraft>): ProviderDraft => ({
  authStatus: "connected",
  codexAuthenticatedAt: null,
  codexAuthError: null,
  id: crypto.randomUUID(),
  isDefault: false,
  name: "",
  providerApiKey: "",
  providerBaseUrl: "https://api.openai.com/v1",
  providerId: "openai",
  providerKind: "manual",
  providerModel: "",
  ...overrides,
});

function SettingsPage() {
  const queryClient = useQueryClient();

  const providersQuery = useQuery(userLlmProvidersQueryOptions());
  const [draftProviders, setDraftProviders] = useState<ProviderDraft[] | null>(null);
  const [pendingDeviceAuth, setPendingDeviceAuth] = useState<Record<string, DeviceAuthState>>({});
  const isProvidersLoading = providersQuery.isPending && !providersQuery.isFetched;

  const allProviders = providersQuery.data ?? [];
  const personalProviders = allProviders.filter((provider) => provider.scope === "personal");
  const providers = (draftProviders ?? personalProviders) as ProviderDraft[];
  const hasUnsavedChanges = draftProviders !== null;

  const saveFn = useServerFn($saveUserLlmProviders);
  const startCodexAuth = useServerFn($startCodexDeviceAuthorization);
  const completeCodexAuth = useServerFn($completeCodexLogin);
  const disconnectCodexAuth = useServerFn($disconnectCodexProvider);
  const [callbackUrlDrafts, setCallbackUrlDrafts] = useState<Record<string, string>>({});

  const { mutate: saveProviders, isPending } = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          providers: providers.map((provider) => ({
            ...provider,
            scope: "personal" as const,
          })),
        },
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
    mutationFn: (providerId: string) => startCodexAuth({ data: { providerId } }),
    onSuccess: (payload, providerId) => {
      setPendingDeviceAuth((current) => ({
        ...current,
        [providerId]: payload,
      }));
      setCallbackUrlDrafts((current) => ({
        ...current,
        [providerId]: "",
      }));
      window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
      toast.success("Codex login started in a new tab.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start Codex login.");
    },
  });

  const completeCodexAuthMutation = useMutation({
    mutationFn: (input: { callbackUrl: string; providerId: string }) =>
      completeCodexAuth({
        data: {
          callbackUrl: input.callbackUrl,
          providerId: input.providerId,
        },
      }),
    onSuccess: async (_, variables) => {
      setPendingDeviceAuth((current) => {
        const next = { ...current };
        delete next[variables.providerId];
        return next;
      });
      setCallbackUrlDrafts((current) => {
        const next = { ...current };
        delete next[variables.providerId];
        return next;
      });
      await queryClient.invalidateQueries(userLlmProvidersQueryOptions());
      toast.success("Codex provider connected.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to complete Codex login.");
    },
  });

  const disconnectCodexAuthMutation = useMutation({
    mutationFn: (providerId: string) => disconnectCodexAuth({ data: { providerId } }),
    onSuccess: async (_, providerId) => {
      setPendingDeviceAuth((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      await queryClient.invalidateQueries(userLlmProvidersQueryOptions());
      toast.success("Codex provider disconnected.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Codex provider.");
    },
  });

  const sortedProviders = [...providers].sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  const updateProvider = (providerId: string, patch: Partial<ProviderDraft>) => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      return source.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      );
    });
  };

  const setProviderKind = (providerId: string, providerKind: "codex" | "manual") => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];

      return source.map((provider) => {
        if (provider.id !== providerId) {
          return provider;
        }

        if (providerKind === "codex") {
          return {
            ...provider,
            authStatus: "disconnected",
            codexAuthError: null,
            providerApiKey: "",
            providerBaseUrl: "",
            providerId: OPENAI_CODEX_RESPONSES_PROVIDER_ID,
            providerKind,
          };
        }

        return {
          ...provider,
          providerApiKey: "",
          providerBaseUrl: "https://api.openai.com/v1",
          providerId:
            provider.providerId === OPENAI_CODEX_RESPONSES_PROVIDER_ID
              ? "openai"
              : provider.providerId,
          providerKind,
        };
      });
    });
  };

  const setDefaultProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      return source.map((provider) => ({
        ...provider,
        isDefault: provider.id === providerId,
      }));
    });
  };

  const addProvider = (providerKind: "codex" | "manual" = "manual") => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      return [
        ...source,
        createProviderDraft({
          authStatus: providerKind === "codex" ? "disconnected" : "connected",
          isDefault: source.length === 0,
          name: `Provider ${source.length + 1}`,
          providerApiKey: providerKind === "codex" ? "" : "",
          providerBaseUrl: providerKind === "codex" ? "" : "https://api.openai.com/v1",
          providerId: providerKind === "codex" ? OPENAI_CODEX_RESPONSES_PROVIDER_ID : "openai",
          providerKind,
        }),
      ];
    });
  };

  const removeProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = (current ?? personalProviders) as ProviderDraft[];
      const next = source.filter((provider) => provider.id !== providerId);

      if (next.length > 0 && !next.some((provider) => provider.isDefault)) {
        const nextDefaultProvider = next[0];
        return next.map((provider) =>
          provider.id === nextDefaultProvider.id ? { ...provider, isDefault: true } : provider,
        );
      }

      return next;
    });
  };

  const resetDrafts = () => {
    setDraftProviders(null);
    setPendingDeviceAuth({});
    setCallbackUrlDrafts({});
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center border-b border-border/60 px-6">
        <h1 className="text-base font-medium text-foreground">Settings</h1>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-5xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">Providers</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Add OpenAI-compatible providers or connect Codex with device login. Tasks store the
                selected provider and use its configured model as the default.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => addProvider("manual")}>
                <PlusIcon />
                Add manual provider
              </Button>
              <Button type="button" onClick={() => addProvider("codex")}>
                <PlusIcon />
                Add Codex provider
              </Button>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4">
            {isProvidersLoading && providers.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground">
                Loading providers...
              </div>
            ) : null}

            {!isProvidersLoading && sortedProviders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 px-5 py-6 text-sm text-muted-foreground">
                No saved providers yet. Add one before starting tasks.
              </div>
            ) : null}

            {sortedProviders.map((provider) => {
              const deviceAuthState = pendingDeviceAuth[provider.id];
              const isCodexProvider = provider.providerKind === "codex";
              const codexStatus = deviceAuthState
                ? "pending"
                : (provider.authStatus ?? "disconnected");
              const callbackUrlDraft = callbackUrlDrafts[provider.id] ?? "";

              return (
                <section
                  key={provider.id}
                  className="rounded-2xl border border-border/70 bg-card px-5 py-5 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold">
                          {provider.name || "Untitled provider"}
                        </h2>
                        {provider.isDefault ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                            <StarIcon className="size-3" />
                            Default
                          </span>
                        ) : null}
                        <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">
                          {isCodexProvider ? "Codex" : "Manual"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isCodexProvider
                          ? "Codex providers use the official ChatGPT PKCE login flow and run through the OpenCode proxy."
                          : "Manual providers use an OpenAI-compatible base URL and API key."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!provider.isDefault ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setDefaultProvider(provider.id)}
                        >
                          Make default
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeProvider(provider.id)}
                      >
                        <Trash2Icon />
                        Remove
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`provider-name-${provider.id}`}>Display name</Label>
                      <Input
                        id={`provider-name-${provider.id}`}
                        value={provider.name}
                        onChange={(event) =>
                          updateProvider(provider.id, { name: event.target.value })
                        }
                        placeholder={isCodexProvider ? "Codex" : "OpenAI production"}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label>Provider type</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={isCodexProvider ? "outline" : "default"}
                          onClick={() => setProviderKind(provider.id, "manual")}
                        >
                          Manual
                        </Button>
                        <Button
                          type="button"
                          variant={isCodexProvider ? "default" : "outline"}
                          onClick={() => setProviderKind(provider.id, "codex")}
                        >
                          Codex
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`provider-id-${provider.id}`}>Provider ID</Label>
                      <Input
                        id={`provider-id-${provider.id}`}
                        value={provider.providerId}
                        onChange={(event) =>
                          updateProvider(provider.id, {
                            providerId: event.target.value.trim().toLowerCase(),
                          })
                        }
                        disabled={isCodexProvider}
                        placeholder={isCodexProvider ? "codex" : "openai"}
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`provider-model-${provider.id}`}>Default model</Label>
                      <Input
                        id={`provider-model-${provider.id}`}
                        value={provider.providerModel}
                        onChange={(event) =>
                          updateProvider(provider.id, { providerModel: event.target.value })
                        }
                        placeholder={isCodexProvider ? "gpt-5-codex" : "gpt-4o"}
                      />
                    </div>

                    {isCodexProvider ? (
                      <div className="rounded-2xl border border-border/60 bg-card/60 px-4 py-4 md:col-span-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Codex login</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              Status:{" "}
                              {codexStatus === "connected"
                                ? "Connected"
                                : codexStatus === "pending"
                                  ? "Waiting for authorization"
                                  : "Disconnected"}
                            </p>
                            {provider.codexAuthenticatedAt ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Connected at{" "}
                                {new Date(provider.codexAuthenticatedAt).toLocaleString()}
                              </p>
                            ) : null}
                            {provider.codexAuthError ? (
                              <p className="mt-1 text-xs text-red-600">{provider.codexAuthError}</p>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={hasUnsavedChanges || startCodexAuthMutation.isPending}
                              onClick={() => startCodexAuthMutation.mutate(provider.id)}
                            >
                              {codexStatus === "connected" ? "Reconnect" : "Start login"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={
                                hasUnsavedChanges ||
                                disconnectCodexAuthMutation.isPending ||
                                codexStatus === "disconnected"
                              }
                              onClick={() => disconnectCodexAuthMutation.mutate(provider.id)}
                            >
                              Disconnect
                            </Button>
                          </div>
                        </div>

                        {hasUnsavedChanges ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Save providers before starting Codex login.
                          </p>
                        ) : null}

                        {deviceAuthState ? (
                          <div className="mt-4 rounded-xl border border-border/60 bg-background px-4 py-4">
                            <p className="text-sm font-medium">Browser login</p>
                            <p className="mt-2 text-sm text-muted-foreground">
                              A browser tab should have opened. After approving access, your browser
                              will be redirected to:
                            </p>
                            <p className="mt-2 font-mono text-xs break-all text-foreground">
                              {deviceAuthState.redirectUri}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                              If the localhost page fails to load, copy the full URL from the
                              browser address bar and paste it here before{" "}
                              {new Date(deviceAuthState.expiresAt).toLocaleTimeString()}.
                            </p>
                            <div className="mt-3 flex flex-col gap-3">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                  window.open(
                                    deviceAuthState.authorizeUrl,
                                    "_blank",
                                    "noopener,noreferrer",
                                  )
                                }
                              >
                                Open ChatGPT login again
                              </Button>
                              <div className="flex flex-col gap-1.5">
                                <Label htmlFor={`codex-callback-url-${provider.id}`}>
                                  Callback URL
                                </Label>
                                <Input
                                  id={`codex-callback-url-${provider.id}`}
                                  value={callbackUrlDraft}
                                  onChange={(event) =>
                                    setCallbackUrlDrafts((current) => ({
                                      ...current,
                                      [provider.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="http://localhost:1455/auth/callback?code=..."
                                />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={
                                  completeCodexAuthMutation.isPending ||
                                  callbackUrlDraft.trim().length === 0
                                }
                                onClick={() =>
                                  completeCodexAuthMutation.mutate({
                                    callbackUrl: callbackUrlDraft.trim(),
                                    providerId: provider.id,
                                  })
                                }
                              >
                                Complete login
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <Label htmlFor={`provider-base-url-${provider.id}`}>API Base URL</Label>
                          <Input
                            id={`provider-base-url-${provider.id}`}
                            value={provider.providerBaseUrl}
                            onChange={(event) =>
                              updateProvider(provider.id, { providerBaseUrl: event.target.value })
                            }
                            placeholder="https://api.openai.com/v1"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <Label htmlFor={`provider-api-key-${provider.id}`}>API key</Label>
                          <Input
                            id={`provider-api-key-${provider.id}`}
                            type="password"
                            autoComplete="off"
                            value={provider.providerApiKey}
                            onChange={(event) =>
                              updateProvider(provider.id, { providerApiKey: event.target.value })
                            }
                            placeholder="sk-..."
                          />
                        </div>
                      </>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="mt-8 flex items-center justify-end gap-3">
            {hasUnsavedChanges ? (
              <Button variant="ghost" disabled={isPending} onClick={resetDrafts}>
                Reset
              </Button>
            ) : null}
            <Button disabled={isPending || !hasUnsavedChanges} onClick={() => saveProviders()}>
              {isPending ? "Saving..." : "Save providers"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
