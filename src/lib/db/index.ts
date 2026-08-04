import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env/server";
import * as schema from "@/lib/db/schema";

// Drizzle reads `timestamp` (no time zone) columns as UTC — it parses the raw
// string with a `+0000` suffix — so the session has to write them in UTC too.
// Without this, every `defaultNow()` column is stored as the server's local
// wall clock and reads back shifted by its UTC offset.
const client = postgres(env.DATABASE_URL, { connection: { TimeZone: "UTC" } });

export const db = drizzle({
  client,
  schema,
  casing: "snake_case",
});
