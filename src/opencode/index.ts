import "@tanstack/react-start/server-only";
import { Config } from "@/config/config";

const DEFAULT_MODEL = "openrouter/openai/gpt-5-codex";

export type OpenCodeConfig = {
  apiKey: string;
  model: string;
};

export namespace OpenCode {
  export const getProviderScopedModelId = (model: string) => {
    if (model.startsWith("openrouter/")) {
      return model.slice("openrouter/".length);
    }

    return model;
  };

  export const normalizeModel = (value: string) => {
    const model = value.trim();

    if (!model) {
      return DEFAULT_MODEL;
    }

    if (model.startsWith("openrouter/")) {
      return model;
    }

    return `openrouter/${model}`;
  };

  export const getConfiguredModel = () =>
    normalizeModel(Config.serverEnv.OPENCODE_MODEL?.trim() || DEFAULT_MODEL);

  export const ensureConfig = (): OpenCodeConfig => {
    if (!Config.serverEnv.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    return {
      apiKey: Config.serverEnv.OPENROUTER_API_KEY,
      model: getConfiguredModel(),
    };
  };

  export const buildConfigContent = (model: string) => {
    const providerScopedModelId = getProviderScopedModelId(model);

    return JSON.stringify({
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
    });
  };
}
