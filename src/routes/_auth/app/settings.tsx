import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRightIcon, HouseIcon, PlusIcon, StarIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { $saveUserLlmProviders } from "@/lib/user/functions";
import { userLlmProvidersQueryOptions } from "@/lib/user/queries";

export const Route = createFileRoute("/_auth/app/settings")({
  component: SettingsPage,
});

type ProviderDraft = {
  id: string;
  isDefault: boolean;
  name: string;
  providerApiKey: string;
  providerBaseUrl: string;
  providerId: string;
  providerModel: string;
};

const createProviderDraft = (overrides?: Partial<ProviderDraft>): ProviderDraft => ({
  id: crypto.randomUUID(),
  isDefault: false,
  name: "",
  providerApiKey: "",
  providerBaseUrl: "https://api.openai.com/v1",
  providerId: "openai",
  providerModel: "",
  ...overrides,
});

function SettingsPage() {
  const setHeaderSlots = useSetHeaderSlots();
  const queryClient = useQueryClient();

  useEffect(() => {
    setHeaderSlots({
      left: (
        <nav className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/70 px-4 py-2 text-base">
          <Link
            to="/app/projects"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <HouseIcon className="size-4" />
            Home
          </Link>
          <ChevronRightIcon className="size-3.5 text-muted-foreground/40" aria-hidden="true" />
          <span className="font-medium text-foreground">Settings</span>
        </nav>
      ),
      projectId: null,
      projectName: null,
      right: null,
    });
    return () => setHeaderSlots({ left: null, projectId: null, projectName: null, right: null });
  }, [setHeaderSlots]);

  const providersQuery = useQuery(userLlmProvidersQueryOptions());
  const [draftProviders, setDraftProviders] = useState<ProviderDraft[] | null>(null);

  const providers = draftProviders ?? providersQuery.data ?? [];
  const hasUnsavedChanges = draftProviders !== null;

  const saveFn = useServerFn($saveUserLlmProviders);
  const { mutate: saveProviders, isPending } = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          providers,
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

  const sortedProviders = [...providers].sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });

  const updateProvider = (providerId: string, patch: Partial<ProviderDraft>) => {
    setDraftProviders((current) => {
      const source = current ?? providersQuery.data ?? [];
      return source.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      );
    });
  };

  const setDefaultProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = current ?? providersQuery.data ?? [];
      return source.map((provider) => ({
        ...provider,
        isDefault: provider.id === providerId,
      }));
    });
  };

  const addProvider = () => {
    setDraftProviders((current) => {
      const source = current ?? providersQuery.data ?? [];
      return [
        ...source,
        createProviderDraft({
          isDefault: source.length === 0,
          name: `Provider ${source.length + 1}`,
        }),
      ];
    });
  };

  const removeProvider = (providerId: string) => {
    setDraftProviders((current) => {
      const source = current ?? providersQuery.data ?? [];
      const next = source.filter((provider) => provider.id !== providerId);

      if (next.length > 0 && !next.some((provider) => provider.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }

      return next;
    });
  };

  const resetDrafts = () => setDraftProviders(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-6 py-8">
      <div className="w-full max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Providers</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Add multiple OpenAI-compatible providers, choose a default, and switch between them
              from the home composer before you start a task.
            </p>
          </div>
          <Button onClick={addProvider}>
            <PlusIcon />
            Add provider
          </Button>
        </div>

        <div className="mt-8 flex flex-col gap-4">
          {providersQuery.isPending && providers.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card px-5 py-6 text-sm text-muted-foreground">
              Loading providers...
            </div>
          ) : null}

          {!providersQuery.isPending && sortedProviders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 px-5 py-6 text-sm text-muted-foreground">
              No saved providers yet. Use “Add provider” to configure one, or leave this empty to
              keep using the server default.
            </div>
          ) : null}

          {sortedProviders.map((provider) => (
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
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Tasks store the selected provider and use its configured model as the default.
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
                  <Button type="button" variant="ghost" onClick={() => removeProvider(provider.id)}>
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
                    onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
                    placeholder="OpenAI production"
                  />
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
                    placeholder="openai"
                  />
                </div>

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

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`provider-model-${provider.id}`}>Default model</Label>
                  <Input
                    id={`provider-model-${provider.id}`}
                    value={provider.providerModel}
                    onChange={(event) =>
                      updateProvider(provider.id, { providerModel: event.target.value })
                    }
                    placeholder="gpt-4o"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`provider-api-key-${provider.id}`}>API key</Label>
                  <Input
                    id={`provider-api-key-${provider.id}`}
                    type="password"
                    value={provider.providerApiKey}
                    onChange={(event) =>
                      updateProvider(provider.id, { providerApiKey: event.target.value })
                    }
                    placeholder="sk-..."
                  />
                </div>
              </div>
            </section>
          ))}
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
  );
}
