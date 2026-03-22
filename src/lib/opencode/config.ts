import "@tanstack/react-start/server-only";
import { env } from "@/env/server";

const DEFAULT_OPENCODE_MODEL = "openrouter/openai/gpt-5-codex";

const KNOWN_NON_OPENROUTER_PROVIDERS = new Set([
  "amazon-bedrock",
  "anthropic",
  "azure",
  "azure-openai",
  "cerebras",
  "deepseek",
  "fireworks",
  "google",
  "google-vertex",
  "groq",
  "lmstudio",
  "ollama",
  "openai",
  "openrouter",
  "opencode",
  "together",
  "xai",
]);

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

  const providerPrefix = model.split("/", 1)[0];

  if (!providerPrefix || !KNOWN_NON_OPENROUTER_PROVIDERS.has(providerPrefix)) {
    return `openrouter/${model}`;
  }

  return model;
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

export const buildOpenCodeConfigContent = (
  model: string,
  options?: {
    enableDaytonaTools?: boolean;
  },
) => {
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

  if (options?.enableDaytonaTools) {
    config.tools = {
      "daytona_*": false,
    };
    config.agent = {
      frontend: {
        tools: {
          "daytona_*": true,
        },
      },
    };
  }

  return JSON.stringify(config);
};
