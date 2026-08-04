export const BILLING_PLANS = {
  free: {
    cta: "Get started",
    description: "Try it out",
    interval: null,
    name: "Free",
    price: "$0",
  },
  pro: {
    cta: "Upgrade to Pro",
    description: "For small teams",
    interval: "month",
    name: "Pro",
    price: "$20",
  },
  max: {
    cta: "Upgrade to Max",
    description: "For growing orgs",
    interval: "month",
    name: "Max",
    price: "$80",
  },
};

export const PAID_BILLING_PLAN_IDS = ["pro", "max"] as const;

export type BillingPlanId = keyof typeof BILLING_PLANS;
export type PaidBillingPlanId = (typeof PAID_BILLING_PLAN_IDS)[number];

export const isPaidBillingPlanId = (value: string): value is PaidBillingPlanId =>
  PAID_BILLING_PLAN_IDS.some((planId) => planId === value);
