import "@tanstack/react-start/server-only";
import { env } from "@/env/server";

const DEFAULT_OPENCODE_PROVIDER_ID = "openrouter";
const DEFAULT_OPENCODE_MODEL = "openrouter/openai/gpt-5-codex";
const CUSTOM_OPENCODE_PROVIDER_ID = "user-provider";
const CUSTOM_OPENCODE_PROVIDER_NAME = "User Provider";
const CUSTOM_OPENCODE_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible";
const CUSTOM_OPENCODE_API_KEY_ENV_VAR = "OPENCODE_PROVIDER_API_KEY";

type UserProviderSettings = {
  providerApiKey?: string | null;
  providerBaseUrl?: string | null;
  providerModel?: string | null;
};

export type OpenCodeConfig = {
  apiKey: string;
  apiKeyEnvVar: string;
  baseUrl: string | null;
  model: string;
  providerId: string;
};

const trimToNull = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const getProviderScopedModelId = (
  model: string,
  providerId: string = DEFAULT_OPENCODE_PROVIDER_ID,
) => {
  const prefix = `${providerId}/`;

  if (model.startsWith(prefix)) {
    return model.slice(prefix.length);
  }

  return model;
};

export const normalizeOpenCodeModelForProvider = (model: string, providerId: string) => {
  const trimmed = model.trim();

  if (!trimmed) {
    return DEFAULT_OPENCODE_MODEL;
  }

  const prefix = `${providerId}/`;

  if (trimmed.startsWith(prefix)) {
    return trimmed;
  }

  if (providerId === DEFAULT_OPENCODE_PROVIDER_ID && trimmed.startsWith("openrouter/")) {
    return trimmed;
  }

  return `${providerId}/${trimmed}`;
};

export const getConfiguredOpenCodeModel = () =>
  normalizeOpenCodeModelForProvider(
    env.OPENCODE_MODEL?.trim() || DEFAULT_OPENCODE_MODEL,
    DEFAULT_OPENCODE_PROVIDER_ID,
  );

export const resolveOpenCodeConfig = (
  userProviderSettings?: UserProviderSettings,
): OpenCodeConfig => {
  const customBaseUrl = trimToNull(userProviderSettings?.providerBaseUrl);
  const customModel = trimToNull(userProviderSettings?.providerModel);
  const customApiKey = trimToNull(userProviderSettings?.providerApiKey);
  const hasAnyCustomSetting = Boolean(customBaseUrl || customModel || customApiKey);

  if (hasAnyCustomSetting) {
    if (!customBaseUrl || !customModel || !customApiKey) {
      throw new Error(
        "Custom provider settings are incomplete. Set API Base URL, Model, and API Key, or clear all three fields to use the server default.",
      );
    }

    return {
      apiKey: customApiKey,
      apiKeyEnvVar: CUSTOM_OPENCODE_API_KEY_ENV_VAR,
      baseUrl: customBaseUrl,
      model: normalizeOpenCodeModelForProvider(customModel, CUSTOM_OPENCODE_PROVIDER_ID),
      providerId: CUSTOM_OPENCODE_PROVIDER_ID,
    };
  }

  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  return {
    apiKey: env.OPENROUTER_API_KEY,
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    baseUrl: null,
    model: getConfiguredOpenCodeModel(),
    providerId: DEFAULT_OPENCODE_PROVIDER_ID,
  };
};

export const ensureOpenCodeConfig = () => resolveOpenCodeConfig();

export const buildOpenCodeConfigContent = (config: OpenCodeConfig) => {
  const providerScopedModelId = getProviderScopedModelId(config.model, config.providerId);
  const providerConfig =
    config.providerId === DEFAULT_OPENCODE_PROVIDER_ID
      ? {
          [DEFAULT_OPENCODE_PROVIDER_ID]: {
            models: {
              [providerScopedModelId]: {},
            },
            options: {
              apiKey: `{env:${config.apiKeyEnvVar}}`,
            },
          },
        }
      : {
          [config.providerId]: {
            models: {
              [providerScopedModelId]: {},
            },
            name: CUSTOM_OPENCODE_PROVIDER_NAME,
            npm: CUSTOM_OPENCODE_PROVIDER_PACKAGE,
            options: {
              apiKey: `{env:${config.apiKeyEnvVar}}`,
              baseURL: config.baseUrl,
            },
          },
        };

  const output: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: config.model,
    permission: {
      bash: {
        "*": "allow",
      },
      edit: "allow",
      skill: "allow",
      webfetch: "allow",
    },
    provider: providerConfig,
  };

  return JSON.stringify(output);
};
