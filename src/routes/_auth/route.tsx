import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authQueryOptions } from "@/lib/auth/queries";

/**
 * This is the _auth layout, which enables 'protected routes'
 * for all child routes under _auth (e.g. _auth/app/*)
 *
 * The returned context from beforeLoad is also available to all child routes & loaders.
 */
export const Route = createFileRoute("/_auth")({
  component: Outlet,
  beforeLoad: async ({ context }) => {
    const user = await context.queryClient.ensureQueryData({
      ...authQueryOptions(),
      revalidateIfStale: true,
    });
    if (!user) {
      throw redirect({ to: "/login" });
    }

    // return context for use in child routes & loaders
    return { user };
  },
});
