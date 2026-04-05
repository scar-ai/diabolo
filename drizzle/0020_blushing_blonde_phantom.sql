CREATE TABLE "user_llm_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider_id" text NOT NULL,
	"provider_base_url" text NOT NULL,
	"provider_model" text NOT NULL,
	"provider_api_key" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "opencode_provider_id" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD CONSTRAINT "user_llm_provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_llm_provider_user_id_idx" ON "user_llm_provider" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_llm_provider_user_id_is_default_idx" ON "user_llm_provider" USING btree ("user_id","is_default");--> statement-breakpoint
INSERT INTO "user_llm_provider" (
	"id",
	"user_id",
	"name",
	"provider_id",
	"provider_base_url",
	"provider_model",
	"provider_api_key",
	"is_default"
)
SELECT
	'legacy-' || "user_id",
	"user_id",
	'Imported provider',
	'openai',
	"provider_base_url",
	"provider_model",
	"provider_api_key",
	true
FROM "user_provider_settings"
WHERE coalesce(trim("provider_base_url"), '') <> ''
	AND coalesce(trim("provider_model"), '') <> ''
	AND coalesce(trim("provider_api_key"), '') <> '';
