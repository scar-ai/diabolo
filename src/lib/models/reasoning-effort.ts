export const REASONING_EFFORT_VALUES = ["low", "medium", "high"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

const REASONING_COMPATIBLE_MODEL_PATTERN =
  /(gpt-5(\.\d+)?(-codex(-mini|-max)?)?|o1|o3|o4|claude-3\.7|claude-sonnet-4|claude-opus-4)/i;

export const modelSupportsReasoningEffort = (model: string) =>
  REASONING_COMPATIBLE_MODEL_PATTERN.test(model);

export const normalizeReasoningEffort = (value?: string | null) => {
  const trimmed = value?.trim().toLowerCase() || null;

  if (!trimmed) {
    return null;
  }

  if (!REASONING_EFFORT_VALUES.includes(trimmed as ReasoningEffort)) {
    throw new Error("Reasoning effort must be one of: low, medium, high.");
  }

  return trimmed;
};
