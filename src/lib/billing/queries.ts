import { queryOptions } from "@tanstack/react-query";

import { $getBillingSummary } from "./functions";

export const billingSummaryQueryOptions = () =>
  queryOptions({
    queryKey: ["billing-summary"],
    queryFn: ({ signal }) => $getBillingSummary({ signal }),
  });
