import type { Config } from "drizzle-kit";

import { env } from "@/env/server";

export default {
  out: "./drizzle",
  schema: ["./src/auth/auth.sql.ts", "./src/project/project.sql.ts"],
  breakpoints: true,
  verbose: true,
  strict: true,
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
} satisfies Config;
