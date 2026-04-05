import { queryOptions } from "@tanstack/react-query";

import { $getUserProviderSettings } from "./functions";

export const userProviderSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["user-provider-settings"],
    queryFn: () => $getUserProviderSettings(),
  });
