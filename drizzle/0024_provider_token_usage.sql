CREATE TABLE "provider_token_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"provider_kind" text NOT NULL,
	"provider_model" text NOT NULL,
	"provider_name" text NOT NULL,
	"provider_scope" text NOT NULL,
	"user_id" text,
	"org_id" text,
	"task_id" text,
	"message_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'sandbox_proxy' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_token_usage" ADD CONSTRAINT "provider_token_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_token_usage" ADD CONSTRAINT "provider_token_usage_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_token_usage_provider_id_idx" ON "provider_token_usage" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "provider_token_usage_user_id_idx" ON "provider_token_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_token_usage_org_id_idx" ON "provider_token_usage" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "provider_token_usage_occurred_at_idx" ON "provider_token_usage" USING btree ("occurred_at");
