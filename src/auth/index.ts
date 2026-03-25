import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";

import { AuthServer } from "@/auth/server";

export namespace Auth {
  export type QueryResult = Awaited<ReturnType<typeof AuthServer.$getUser>>;

  export const queryOptionsForUser = () =>
    queryOptions({
      queryKey: ["user"],
      queryFn: ({ signal }) => AuthServer.$getUser({ signal }),
      staleTime: 30_000,
    });

  export function use() {
    const { data: user, isPending } = useQuery(queryOptionsForUser());
    return { isPending, user };
  }

  export function useSuspense() {
    const { data: user } = useSuspenseQuery(queryOptionsForUser());
    return { user };
  }
}

export type AuthQueryResult = Auth.QueryResult;
export const authQueryOptions = Auth.queryOptionsForUser;
export const useAuth = Auth.use;
export const useAuthSuspense = Auth.useSuspense;
