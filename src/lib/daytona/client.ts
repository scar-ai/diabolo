import "@tanstack/react-start/server-only";
import { Daytona } from "@daytonaio/sdk";

import { env } from "@/env/server";

const LEGACY_UNSUPPORTED_IMAGES = new Set(["daytonaio/workspace", "daytonaio/workspace:latest"]);

export const getConfiguredDaytonaImage = () => {
  const image = env.DAYTONA_DEFAULT_IMAGE?.trim();

  if (!image || LEGACY_UNSUPPORTED_IMAGES.has(image)) {
    return undefined;
  }

  return image;
};

export const getDaytonaClient = () => {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is not configured.");
  }

  return new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL || undefined,
    target: env.DAYTONA_TARGET || undefined,
  });
};

export const formatDaytonaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected sandbox provider error.";

  if (
    message.toLowerCase().includes("unprocessable entity") &&
    message.toLowerCase().includes("pull access denied")
  ) {
    const configuredImage = env.DAYTONA_DEFAULT_IMAGE?.trim();

    if (configuredImage) {
      return `Daytona could not pull the configured image "${configuredImage}". Clear DAYTONA_DEFAULT_IMAGE to use Daytona's default sandbox image, or set it to a valid image your Daytona target can access.`;
    }

    return "Daytona could not start the sandbox because the resolved image was not accessible. Set a valid DAYTONA_DEFAULT_IMAGE for your Daytona target, or leave it unset to use Daytona's default sandbox image.";
  }

  return message;
};
