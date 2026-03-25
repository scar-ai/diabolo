import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import "@tanstack/react-start/server-only";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { betterAuth } from "better-auth/minimal";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import * as schema from "@/auth/auth.sql";
import { Config } from "@/config/config";
import { db } from "@/db/db";

interface GetUserQuery {
  disableCookieCache?: boolean | undefined;
  disableRefresh?: boolean | undefined;
}

const fallbackAuthUrl = Config.serverEnv.VITE_BASE_URL;
const allowedAuthHosts = Array.from(
  new Set(["localhost:3000", "127.0.0.1:3000", new URL(fallbackAuthUrl).host]),
);

export namespace AuthServer {
  export const auth = betterAuth({
    baseURL: {
      allowedHosts: allowedAuthHosts,
      fallback: fallbackAuthUrl,
    },
    telemetry: {
      enabled: false,
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    plugins: [tanstackStartCookies()],
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    socialProviders: {
      github: {
        clientId: Config.serverEnv.GITHUB_CLIENT_ID!,
        clientSecret: Config.serverEnv.GITHUB_CLIENT_SECRET!,
        scope: ["read:user", "user:email", "repo"],
      },
      google: {
        clientId: Config.serverEnv.GOOGLE_CLIENT_ID!,
        clientSecret: Config.serverEnv.GOOGLE_CLIENT_SECRET!,
      },
    },
    emailAndPassword: {
      enabled: true,
    },
    experimental: {
      joins: true,
    },
  });

  export async function getUser(query?: GetUserQuery) {
    const session = await auth.api.getSession({
      headers: getRequest().headers,
      query,
      returnHeaders: true,
    });

    const cookies = session.headers?.getSetCookie();

    if (cookies?.length) {
      setResponseHeader("Set-Cookie", cookies);
    }

    return session.response?.user || null;
  }

  export const $getUser = createServerFn({ method: "GET" }).handler(async () => getUser());
}

export const auth = AuthServer.auth;
export const _getUser = AuthServer.getUser;
export const $getUser = AuthServer.$getUser;
