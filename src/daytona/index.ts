import "@tanstack/react-start/server-only";
import { Daytona, DaytonaNotFoundError } from "@daytonaio/sdk";

import { Config } from "@/config/config";
import { DaytonaSnapshot } from "@/daytona/snapshot";

export namespace DaytonaClient {
  export const get = () => {
    if (!Config.serverEnv.DAYTONA_API_KEY) {
      throw new Error("DAYTONA_API_KEY is not configured.");
    }

    return new Daytona({
      apiKey: Config.serverEnv.DAYTONA_API_KEY,
      apiUrl: Config.serverEnv.DAYTONA_API_URL || undefined,
      target: Config.serverEnv.DAYTONA_TARGET || undefined,
    });
  };

  export const formatError = (error: unknown) => {
    if (error instanceof DaytonaNotFoundError) {
      return DaytonaSnapshot.formatMissingError(error);
    }

    const message = error instanceof Error ? error.message : "Unexpected sandbox provider error.";

    if (message.toLowerCase().includes("pull access denied")) {
      const configuredImage =
        Config.serverEnv.DAYTONA_DEFAULT_IMAGE?.trim() ||
        Config.serverEnv.DAYTONA_BROWSER_BASE_IMAGE?.trim();

      if (configuredImage) {
        return `Daytona could not pull the configured base image "${configuredImage}" while building the browser snapshot. Set DAYTONA_DEFAULT_IMAGE or DAYTONA_BROWSER_BASE_IMAGE to an image your Daytona target can access.`;
      }

      return "Daytona could not pull the base image used to build the browser snapshot. Set DAYTONA_BROWSER_BASE_IMAGE to an image your Daytona target can access.";
    }

    return message;
  };
}
