import { createFileRoute } from "@tanstack/react-router";

import { badRequest, getFormString, requireApiUser } from "@/lib/api-helpers";
import { createBillingCheckoutSession, parsePaidBillingPlan } from "@/lib/billing/stripe.server";
import { Log } from "@/lib/log";

const log = Log.create({ route: "/api/billing/checkout" });

export const Route = createFileRoute("/api/billing/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireApiUser(request);
        if (!user) {
          return Response.redirect(new URL("/login", request.url), 303);
        }

        try {
          const formData = await request.formData();
          const planId = parsePaidBillingPlan(getFormString(formData, "planId"));
          const checkoutSession = await createBillingCheckoutSession({
            email: user.email,
            name: user.name,
            planId,
            userId: user.id,
          });

          if (!checkoutSession.url) {
            return badRequest("Stripe did not return a checkout URL.");
          }

          return Response.redirect(checkoutSession.url, 303);
        } catch (error) {
          log.error("failed to create checkout session", { error, userId: user.id });
          return badRequest("Failed to create checkout session.");
        }
      },
    },
  },
});
