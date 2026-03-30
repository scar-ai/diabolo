import "@tanstack/react-start/server-only";
import { ensureOpenCodeConfig, getProviderScopedModelId } from "@/lib/opencode/config";

import { buildTaskTitle } from "./shared";

const TASK_TITLE_TIMEOUT_MS = 8_000;
const TASK_TITLE_MAX_LENGTH = 48;

const normalizeGeneratedTaskTitle = (value: string) => {
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

export const generateTaskTitle = async (prompt: string) => {
  const fallbackTitle = buildTaskTitle(prompt);

  try {
    const config = ensureOpenCodeConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TASK_TITLE_TIMEOUT_MS);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: [
                "You write short titles for coding work sessions.",
                "Return only the title text, with no quotes or markdown.",
                "Make it explicit and descriptive, based on the user's initial prompt.",
                "Keep it under 48 characters and 2 to 6 words when possible.",
                "Avoid vague filler like task, help, update, fix this, or miscellaneous.",
              ].join(" "),
            },
            {
              role: "user",
              content: prompt.trim(),
            },
          ],
          model: getProviderScopedModelId(config.model),
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        return fallbackTitle;
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      return (
        normalizeGeneratedTaskTitle(data.choices?.[0]?.message?.content || "") || fallbackTitle
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return fallbackTitle;
  }
};
