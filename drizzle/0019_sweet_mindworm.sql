CREATE TABLE "user_provider_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider_base_url" text,
	"provider_model" text,
	"provider_api_key" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_provider_settings" ADD CONSTRAINT "user_provider_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;