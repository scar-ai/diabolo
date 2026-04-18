import "@tanstack/react-start/server-only";
import { buildTaskTitle } from "./shared";

const TASK_TITLE_MAX_LENGTH = 48;

export const normalizeGeneratedTaskTitle = (value: string) => {
  const normalized = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "");

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, TASK_TITLE_MAX_LENGTH).trim() || null;
};

export const buildFallbackTaskTitle = (prompt: string) => buildTaskTitle(prompt);

export const resolveTaskTitle = (prompt: string, sessionTitle?: string | null) =>
  normalizeGeneratedTaskTitle(sessionTitle ?? "") || buildFallbackTaskTitle(prompt);
