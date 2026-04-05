import { queryOptions } from "@tanstack/react-query";

import { $getUserProviderSettings, $listUserLlmProviders } from "./functions";

export const userProviderSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["user-provider-settings"],
    queryFn: () => $getUserProviderSettings(),
  });

export const userLlmProvidersQueryOptions = () =>
  queryOptions({
    queryKey: ["user-llm-providers"],
    queryFn: () => $listUserLlmProviders(),
  });
