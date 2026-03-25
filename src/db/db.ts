import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as AuthTable from "@/auth/auth.sql";
import { Config } from "@/config/config";
import * as ProjectTable from "@/project/project.sql";

const client = postgres(Config.serverEnv.DATABASE_URL);

export const db = drizzle({
  client,
  schema: {
    ...AuthTable,
    ...ProjectTable,
  },
  casing: "snake_case",
});
