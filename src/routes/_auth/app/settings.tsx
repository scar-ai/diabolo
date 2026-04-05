import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRightIcon, HouseIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useSetHeaderSlots } from "@/components/app/header-portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { $updateUserProviderSettings } from "@/lib/user/functions";
import { userProviderSettingsQueryOptions } from "@/lib/user/queries";

export const Route = createFileRoute("/_auth/app/settings")({
  component: SettingsPage,
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

  const { data } = useQuery(userProviderSettingsQueryOptions());

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (data) {
      setBaseUrl(data.providerBaseUrl ?? "");
      setModel(data.providerModel ?? "");
      setApiKey(data.providerApiKey ?? "");
    }
  }, [data]);

  const updateFn = useServerFn($updateUserProviderSettings);
  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      updateFn({
        data: { providerBaseUrl: baseUrl, providerModel: model, providerApiKey: apiKey },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(userProviderSettingsQueryOptions());
      toast.success("Provider settings saved.");
    },
    onError: () => {
      toast.error("Failed to save provider settings.");
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-6 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="mt-10 w-full max-w-lg">
        <h2 className="text-base font-semibold">Provider Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure a custom OpenAI-compatible provider. Leave all fields empty to use the server
          default.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="base-url">API Base URL</Label>
            <Input
              id="base-url"
              type="text"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              type="text"
              placeholder="gpt-4o"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="api-key">API Key</Label>
            <Input
              id="api-key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <Button className="self-end" disabled={isPending} onClick={() => save()}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
