import path from "node:path";

import type { JsonObject } from "@/lib/json";

export const TASK_SCREENSHOT_ARTIFACT_TYPE = "screenshot";

export type TaskScreenshotMetadata = {
  fileName: string;
  mediaType: string;
  sandboxPath: string;
};

const getMediaTypeFromPath = (value: string) => {
  const extension = path.extname(value).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";

  return "application/octet-stream";
};

export const buildTaskScreenshotMetadata = (
  sandboxPath: string,
  extra?: JsonObject | null,
): JsonObject & TaskScreenshotMetadata => ({
  ...(extra ?? {}),
  fileName: path.basename(sandboxPath) || "screenshot.png",
  mediaType: getMediaTypeFromPath(sandboxPath),
  sandboxPath,
});

export const isTaskScreenshotMetadata = (
  value: JsonObject | null | undefined,
): value is JsonObject & TaskScreenshotMetadata =>
  typeof value?.fileName === "string" &&
  typeof value?.mediaType === "string" &&
  typeof value?.sandboxPath === "string";
