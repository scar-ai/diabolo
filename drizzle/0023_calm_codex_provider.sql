ALTER TABLE "user_llm_provider" ADD COLUMN "provider_kind" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ALTER COLUMN "provider_base_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ALTER COLUMN "provider_api_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_access_token" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_refresh_token" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_access_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_refresh_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_device_code" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_device_code_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_user_code" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_verification_uri" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_verification_uri_complete" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_polling_interval_seconds" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_scope" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_authenticated_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "oauth_error" text;
