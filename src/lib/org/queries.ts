import { queryOptions } from "@tanstack/react-query";

import { $getMyInvites, $getMyOrg } from "@/lib/org/functions";

export const orgKeys = {
  all: ["org"],
  myOrg: (userId: string) => [...orgKeys.all, "my-org", userId],
  myInvites: (userId: string) => [...orgKeys.all, "my-invites", userId],
};

export const myOrgQueryOptions = (userId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $getMyOrg({ signal }),
    queryKey: orgKeys.myOrg(userId),
    staleTime: 30_000,
  });

export const myInvitesQueryOptions = (userId: string) =>
  queryOptions({
    queryFn: ({ signal }) => $getMyInvites({ signal }),
    queryKey: orgKeys.myInvites(userId),
    staleTime: 30_000,
  });
