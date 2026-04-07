import { queryOptions } from "@tanstack/react-query";

import {
  $getCodexSharedLoginStatus,
  $listAvailableCodexModels,
  $listUserLlmProviders,
} from "./functions";

export const userLlmProvidersQueryOptions = () =>
  queryOptions({
    queryKey: ["user-llm-providers"],
    queryFn: () => $listUserLlmProviders(),
    staleTime: 30_000,
  });

export const codexSharedLoginStatusQueryOptions = () =>
  queryOptions({
    queryKey: ["codex-shared-login-status"],
    queryFn: () => $getCodexSharedLoginStatus(),
    staleTime: 30_000,
  });

export const codexModelsQueryOptions = () =>
  queryOptions({
    queryKey: ["codex-models"],
    queryFn: () => $listAvailableCodexModels(),
    staleTime: 5 * 60_000,
  });
