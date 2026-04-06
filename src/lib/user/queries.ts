import { queryOptions } from "@tanstack/react-query";

import { $listUserLlmProviders } from "./functions";

export const userLlmProvidersQueryOptions = () =>
  queryOptions({
    queryKey: ["user-llm-providers"],
    queryFn: () => $listUserLlmProviders(),
    staleTime: 30_000,
  });
