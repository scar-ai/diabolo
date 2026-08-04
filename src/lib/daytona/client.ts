import "@tanstack/react-start/server-only";
import { Daytona, DaytonaNotFoundError } from "@daytona/sdk";

import { env } from "@/env/server";
import { formatMissingBrowserSnapshotError } from "@/lib/daytona/snapshot";

const DAYTONA_REQUEST_TIMEOUT_MS = 30_000;

export const getDaytonaClient = () => {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is not configured.");
  }

  return new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL || undefined,
    requestTimeoutMs: DAYTONA_REQUEST_TIMEOUT_MS,
    target: env.DAYTONA_TARGET || undefined,
  });
};

export const formatDaytonaError = (error: unknown) => {
  if (error instanceof DaytonaNotFoundError) {
    return formatMissingBrowserSnapshotError(error);
  }

  const message = error instanceof Error ? error.message : "Unexpected sandbox provider error.";

  if (message.toLowerCase().includes("pull access denied")) {
    const configuredImage =
      env.DAYTONA_DEFAULT_IMAGE?.trim() || env.DAYTONA_BROWSER_BASE_IMAGE?.trim();

    if (configuredImage) {
      return `Daytona could not pull the configured base image "${configuredImage}" while building the browser snapshot. Set DAYTONA_DEFAULT_IMAGE or DAYTONA_BROWSER_BASE_IMAGE to an image your Daytona target can access.`;
    }

    return "Daytona could not pull the base image used to build the browser snapshot. Set DAYTONA_BROWSER_BASE_IMAGE to an image your Daytona target can access.";
  }

  return message;
};
