import "@tanstack/react-start/server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JsonObject } from "@/lib/json";

const ATTACHMENT_STORAGE_ROOT = path.join(process.cwd(), ".data", "task-attachments");
const INVALID_FILE_CHARS = /[^a-zA-Z0-9._-]+/g;

export const TASK_ATTACHMENT_ARTIFACT_TYPE = "attachment";
export const MAX_TASK_ATTACHMENTS = 8;
export const MAX_TASK_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TASK_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

export type TaskAttachmentMetadata = {
  fileName: string;
  mediaType: string;
  originalName: string;
  size: number;
  storageKey: string;
};

export const collectTaskAttachmentFiles = (formData: FormData, fieldName = "attachments") =>
  formData
    .getAll(fieldName)
    .filter((value): value is File => value instanceof File && value.size > 0);

export const validateTaskAttachmentFiles = (files: File[]) => {
  if (files.length > MAX_TASK_ATTACHMENTS) {
    throw new Error(`You can attach up to ${MAX_TASK_ATTACHMENTS} files per prompt.`);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (totalBytes > MAX_TASK_ATTACHMENT_TOTAL_BYTES) {
    throw new Error(
      `Total attachment size must stay under ${Math.floor(MAX_TASK_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))} MB.`,
    );
  }

  for (const file of files) {
    if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
      throw new Error(
        `${file.name || "Attachment"} is too large. Each file must stay under ${Math.floor(MAX_TASK_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
      );
    }
  }
};

const sanitizeFileName = (value: string) => {
  const parsed = path.parse(value);
  const baseName = parsed.name.replaceAll(INVALID_FILE_CHARS, "-").replace(/^-+|-+$/g, "");
  const extension = parsed.ext.replaceAll(INVALID_FILE_CHARS, "");

  return `${baseName || "attachment"}${extension}`.slice(0, 120);
};

const buildUniqueFileName = (fileName: string, usedNames: Set<string>) => {
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "attachment";
  const extension = parsed.ext;

  let candidate = `${baseName}${extension}`;
  let suffix = 1;

  while (usedNames.has(candidate)) {
    candidate = `${baseName}-${suffix}${extension}`;
    suffix += 1;
  }

  usedNames.add(candidate);
  return candidate;
};

export const isTaskAttachmentMetadata = (
  value: JsonObject | null | undefined,
): value is JsonObject & TaskAttachmentMetadata =>
  typeof value?.fileName === "string" &&
  typeof value?.mediaType === "string" &&
  typeof value?.originalName === "string" &&
  typeof value?.size === "number" &&
  typeof value?.storageKey === "string";

export const resolveTaskAttachmentPath = (storageKey: string) =>
  path.join(ATTACHMENT_STORAGE_ROOT, storageKey);

export const createTaskAttachmentMetadata = async (input: {
  file: File;
  messageId: string;
  taskId: string;
  usedNames?: Set<string>;
}): Promise<TaskAttachmentMetadata> => {
  const originalName = input.file.name.trim() || "attachment";
  const safeName = sanitizeFileName(originalName);
  const uniqueName = buildUniqueFileName(safeName, input.usedNames ?? new Set<string>());
  const storageKey = path.join(input.taskId, input.messageId, uniqueName);
  const targetPath = resolveTaskAttachmentPath(storageKey);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from(await input.file.arrayBuffer()));

  return {
    fileName: uniqueName,
    mediaType: input.file.type || "application/octet-stream",
    originalName,
    size: input.file.size,
    storageKey,
  };
};
