export const OPENCODE_VERSION = "1.18.11";
export const OPENAI_CODEX_RESPONSES_PROVIDER_ID = "openai";

export const CODEX_MODEL_OPTIONS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export const DEFAULT_CODEX_MODEL = CODEX_MODEL_OPTIONS[0];

export const isCodexModelOption = (model: string) =>
  CODEX_MODEL_OPTIONS.some((option) => option === model);
