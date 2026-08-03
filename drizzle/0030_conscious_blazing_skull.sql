CREATE TABLE "user_billing" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_subscription_status" text,
	"stripe_price_id" text,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_billing" ADD CONSTRAINT "user_billing_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_billing_plan_idx" ON "user_billing" USING btree ("plan");--> statement-breakpoint
CREATE UNIQUE INDEX "user_billing_stripe_customer_id_idx" ON "user_billing" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_billing_stripe_subscription_id_idx" ON "user_billing" USING btree ("stripe_subscription_id");