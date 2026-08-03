import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "@/lib/db/schema/schema";

export const userBilling = pgTable(
  "user_billing",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    plan: text().notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripeSubscriptionStatus: text("stripe_subscription_status"),
    stripePriceId: text("stripe_price_id"),
    currentPeriodEnd: timestamp("current_period_end"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("user_billing_plan_idx").on(table.plan),
    uniqueIndex("user_billing_stripe_customer_id_idx").on(table.stripeCustomerId),
    uniqueIndex("user_billing_stripe_subscription_id_idx").on(table.stripeSubscriptionId),
  ],
);
