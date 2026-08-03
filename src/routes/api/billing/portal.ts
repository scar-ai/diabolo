import { createFileRoute } from "@tanstack/react-router";

import { badRequest, requireApiUser } from "@/lib/api-helpers";
import { createBillingPortalSession } from "@/lib/billing/stripe.server";
import { Log } from "@/lib/log";

const log = Log.create({ route: "/api/billing/portal" });

export const Route = createFileRoute("/api/billing/portal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireApiUser(request);
        if (!user) {
          return Response.redirect(new URL("/login", request.url), 303);
        }

        try {
          const portalSession = await createBillingPortalSession({ userId: user.id });
          return Response.redirect(portalSession.url, 303);
        } catch (error) {
          log.error("failed to create billing portal session", { error, userId: user.id });
          return badRequest("Failed to create billing portal session.");
        }
      },
    },
  },
});
