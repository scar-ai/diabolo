import { createFileRoute } from "@tanstack/react-router";

import { handleStripeWebhook } from "@/lib/billing/stripe.server";
import { Log } from "@/lib/log";

const log = Log.create({ route: "/api/billing/webhook" });

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await handleStripeWebhook({
            payload: await request.text(),
            signature: request.headers.get("stripe-signature"),
          });

          return Response.json({ received: true });
        } catch (error) {
          log.warn("rejected Stripe webhook", { error });
          return Response.json({ error: "Invalid Stripe webhook." }, { status: 400 });
        }
      },
    },
  },
});
