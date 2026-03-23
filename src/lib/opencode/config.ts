import "@tanstack/react-start/server-only";
import { env } from "@/env/server";

const DEFAULT_OPENCODE_MODEL = "openrouter/openai/gpt-5-codex";

export type OpenCodeConfig = {
  apiKey: string;
  model: string;
};

export const getProviderScopedModelId = (model: string) => {
  if (model.startsWith("openrouter/")) {
    return model.slice("openrouter/".length);
  }

  return model;
};

export const normalizeOpenRouterModel = (value: string) => {
  const model = value.trim();

  if (!model) {
    return DEFAULT_OPENCODE_MODEL;
  }

  if (model.startsWith("openrouter/")) {
    return model;
  }

  // This app only provisions the OpenRouter provider for OpenCode, so any
  // provider-scoped model id like "openai/gpt-5.4-nano" still needs the
  // "openrouter/" prefix to resolve correctly inside OpenCode.
  return `openrouter/${model}`;
};

export const getConfiguredOpenCodeModel = () =>
  normalizeOpenRouterModel(env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL);

export const ensureOpenCodeConfig = (): OpenCodeConfig => {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  return {
    apiKey: env.OPENROUTER_API_KEY,
    model: getConfiguredOpenCodeModel(),
  };
};

export const buildOpenCodeConfigContent = (model: string) => {
  const providerScopedModelId = getProviderScopedModelId(model);

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model,
    permission: {
      bash: {
        "*": "allow",
      },
      edit: "allow",
      webfetch: "allow",
    },
    provider: {
      openrouter: {
        models: {
          [providerScopedModelId]: {},
        },
        options: {},
      },
    },
  };

  return JSON.stringify(config);
};
