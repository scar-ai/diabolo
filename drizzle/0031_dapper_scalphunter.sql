ALTER TABLE "user_llm_provider" ADD COLUMN "opencode_auth" text;--> statement-breakpoint
ALTER TABLE "user_llm_provider" ADD COLUMN "opencode_auth_sandbox_id" text;--> statement-breakpoint
UPDATE "user_llm_provider"
SET "opencode_auth" = json_build_object(
  'openai',
  json_build_object(
    'type', 'oauth',
    'access', "oauth_access_token",
    'refresh', "oauth_refresh_token",
    'expires', FLOOR(EXTRACT(EPOCH FROM "oauth_access_token_expires_at") * 1000)
  )
)::text
WHERE "provider_kind" = 'codex'
  AND "oauth_access_token" IS NOT NULL
  AND "oauth_refresh_token" IS NOT NULL
  AND "oauth_access_token_expires_at" IS NOT NULL;
