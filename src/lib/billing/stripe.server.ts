import "@tanstack/react-start/server-only";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { env } from "@/env/server";
import { db } from "@/lib/db";
import { userBilling } from "@/lib/db/schema";

import { isPaidBillingPlanId, type BillingPlanId, type PaidBillingPlanId } from "./plans";

const getStripe = () => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }

  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-07-29.dahlia",
  });
};

const priceIdByPlan = {
  max: env.STRIPE_MAX_PRICE_ID,
  pro: env.STRIPE_PRO_PRICE_ID,
};

const planByPriceId = new Map(
  Object.entries(priceIdByPlan)
    .filter((entry) => Boolean(entry[1]))
    .map(([planId, priceId]) => [priceId, planId]),
);

const getPriceIdForPlan = (planId: PaidBillingPlanId) => {
  const priceId = priceIdByPlan[planId];

  if (!priceId) {
    throw new Error(`STRIPE_${planId.toUpperCase()}_PRICE_ID is not configured.`);
  }

  return priceId;
};

const toDate = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null;

const getPlanForPriceId = (priceId: string | null | undefined): BillingPlanId => {
  if (!priceId) {
    return "free";
  }

  const planId = planByPriceId.get(priceId);
  return planId === "pro" || planId === "max" ? planId : "free";
};

export const createBillingCheckoutSession = async (input: {
  email: string;
  name: string;
  planId: PaidBillingPlanId;
  userId: string;
}) => {
  const stripe = getStripe();
  const existingBilling = await db.query.userBilling.findFirst({
    where: eq(userBilling.userId, input.userId),
  });

  const stripeCustomerId =
    existingBilling?.stripeCustomerId ??
    (
      await stripe.customers.create({
        email: input.email,
        metadata: {
          userId: input.userId,
        },
        name: input.name,
      })
    ).id;

  if (!existingBilling?.stripeCustomerId) {
    await db
      .insert(userBilling)
      .values({
        stripeCustomerId,
        userId: input.userId,
      })
      .onConflictDoUpdate({
        set: {
          stripeCustomerId,
          updatedAt: new Date(),
        },
        target: userBilling.userId,
      });
  }

  return stripe.checkout.sessions.create({
    cancel_url: `${env.VITE_BASE_URL}/pricing`,
    customer: stripeCustomerId,
    line_items: [
      {
        price: getPriceIdForPlan(input.planId),
        quantity: 1,
      },
    ],
    metadata: {
      planId: input.planId,
      userId: input.userId,
    },
    mode: "subscription",
    subscription_data: {
      metadata: {
        planId: input.planId,
        userId: input.userId,
      },
    },
    success_url: `${env.VITE_BASE_URL}/app/settings?checkout=success`,
  });
};

export const createBillingPortalSession = async (input: { userId: string }) => {
  const stripe = getStripe();
  const existingBilling = await db.query.userBilling.findFirst({
    where: eq(userBilling.userId, input.userId),
  });

  if (!existingBilling?.stripeCustomerId) {
    throw new Error("No Stripe customer found for this user.");
  }

  return stripe.billingPortal.sessions.create({
    customer: existingBilling.stripeCustomerId,
    return_url: `${env.VITE_BASE_URL}/app/settings`,
  });
};

const getSubscriptionBillingState = (subscription: Stripe.Subscription) => {
  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? null;
  const status = subscription.status;
  const active =
    status === "active" || status === "trialing" || status === "past_due" || status === "paused";

  return {
    currentPeriodEnd: toDate(item?.current_period_end),
    plan: active ? getPlanForPriceId(priceId) : "free",
    priceId,
    status,
  };
};

const upsertBillingFromSubscription = async (subscription: Stripe.Subscription) => {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userIdFromMetadata = subscription.metadata.userId;
  const state = getSubscriptionBillingState(subscription);

  if (userIdFromMetadata) {
    await db
      .insert(userBilling)
      .values({
        currentPeriodEnd: state.currentPeriodEnd,
        plan: state.plan,
        stripeCustomerId: customerId,
        stripePriceId: state.priceId,
        stripeSubscriptionId: subscription.id,
        stripeSubscriptionStatus: state.status,
        userId: userIdFromMetadata,
      })
      .onConflictDoUpdate({
        set: {
          currentPeriodEnd: state.currentPeriodEnd,
          plan: state.plan,
          stripeCustomerId: customerId,
          stripePriceId: state.priceId,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionStatus: state.status,
          updatedAt: new Date(),
        },
        target: userBilling.userId,
      });
    return;
  }

  await db
    .update(userBilling)
    .set({
      currentPeriodEnd: state.currentPeriodEnd,
      plan: state.plan,
      stripePriceId: state.priceId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: state.status,
      updatedAt: new Date(),
    })
    .where(eq(userBilling.stripeCustomerId, customerId));
};

const handleCheckoutCompleted = async (session: Stripe.Checkout.Session) => {
  if (session.mode !== "subscription" || !session.subscription) {
    return;
  }

  const stripe = getStripe();
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertBillingFromSubscription(subscription);
};

export const handleStripeWebhook = async (input: { payload: string; signature: string | null }) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  }

  if (!input.signature) {
    throw new Error("Missing Stripe signature.");
  }

  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(
    input.payload,
    input.signature,
    env.STRIPE_WEBHOOK_SECRET,
  );

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.updated":
      await upsertBillingFromSubscription(event.data.object);
      break;
    default:
      break;
  }
};

export const parsePaidBillingPlan = (value: string) => {
  if (!isPaidBillingPlanId(value)) {
    throw new Error("Unknown billing plan.");
  }

  return value;
};
