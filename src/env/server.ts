import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    VITE_BASE_URL: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z.string().min(1),

    // OAuth2 providers, optional, update as needed
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    DAYTONA_API_KEY: z.string().optional(),
    DAYTONA_API_URL: z.url().optional(),
    DAYTONA_TARGET: z.string().optional(),
    DAYTONA_DEFAULT_IMAGE: z.string().optional(),
    DAYTONA_BROWSER_BASE_IMAGE: z.string().optional(),
    DAYTONA_BROWSER_SNAPSHOT: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    OPENCODE_MODEL: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRO_PRICE_ID: z.string().optional(),
    STRIPE_MAX_PRICE_ID: z.string().optional(),
  },
  runtimeEnv: process.env,
});
