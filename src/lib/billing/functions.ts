import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";

import { authMiddleware } from "@/lib/auth/middleware";
import { db } from "@/lib/db";
import { userBilling } from "@/lib/db/schema";

import { type BillingPlanId, isPaidBillingPlanId } from "./plans";

const toBillingPlanId = (plan: string | null | undefined): BillingPlanId => {
  if (plan === "free") {
    return plan;
  }

  const planValue = plan ?? "";
  if (isPaidBillingPlanId(planValue)) {
    return planValue;
  }

  return "free";
};

export const $getBillingSummary = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const billing = await db.query.userBilling.findFirst({
      where: eq(userBilling.userId, context.user.id),
    });

    return {
      currentPeriodEnd: billing?.currentPeriodEnd?.toISOString() ?? null,
      plan: toBillingPlanId(billing?.plan),
      stripeSubscriptionStatus: billing?.stripeSubscriptionStatus ?? null,
      canManageBilling: Boolean(billing?.stripeCustomerId),
    };
  });
