import "@tanstack/react-start/server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/env/server";

const hashRuntimeEventToken = (taskId: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(`opencode-runtime:${taskId}`).digest("hex");

export const createRuntimeEventToken = (taskId: string) => hashRuntimeEventToken(taskId);

export const verifyRuntimeEventToken = (taskId: string, token: string) => {
  const expected = Buffer.from(hashRuntimeEventToken(taskId));
  const actual = Buffer.from(token);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
};

export const getRuntimeEventEndpoint = () =>
  new URL("/api/opencode/runtime-events", env.VITE_BASE_URL).toString();
