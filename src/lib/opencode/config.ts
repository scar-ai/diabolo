import "@tanstack/react-start/server-only";
import { env } from "@/env/server";

const DEFAULT_OPENCODE_PROVIDER_ID = "openrouter";
const DEFAULT_OPENCODE_MODEL = "openrouter/openai/gpt-5-codex";
const DEFAULT_OPENCODE_NAME = "OpenRouter";
const CUSTOM_OPENCODE_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible";
const CUSTOM_OPENCODE_API_KEY_ENV_VAR = "OPENCODE_PROVIDER_API_KEY";
const LEGACY_CUSTOM_PROVIDER_ID = "openai";
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

type LegacyUserProviderSettings = {
  providerApiKey?: string | null;
  providerBaseUrl?: string | null;
  providerModel?: string | null;
};

type SavedUserProvider = {
  id?: string | null;
  isDefault?: boolean | null;
  name?: string | null;
  providerApiKey?: string | null;
  providerBaseUrl?: string | null;
  providerId?: string | null;
  providerModel?: string | null;
};

export type OpenCodeConfig = {
  apiKey: string;
  apiKeyEnvVar: string;
  baseUrl: string | null;
  model: string;
  providerId: string;
  providerName: string;
  selectedProviderId: string | null;
};

const trimToNull = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

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

const buildSavedProviderConfig = (
  provider: SavedUserProvider,
  modelOverride?: string | null,
): OpenCodeConfig => {
  const providerId = trimToNull(provider.providerId);
  const baseUrl = trimToNull(provider.providerBaseUrl);
  const model = trimToNull(modelOverride ?? provider.providerModel);
  const apiKey = trimToNull(provider.providerApiKey);

  if (!providerId || !baseUrl || !model || !apiKey) {
    throw new Error(
      "Selected provider is incomplete. Set Provider ID, API Base URL, Model, and API Key before starting a task.",
    );
  }

  return {
    apiKey,
    apiKeyEnvVar: CUSTOM_OPENCODE_API_KEY_ENV_VAR,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: normalizeOpenCodeModelForProvider(model, providerId),
    providerId,
    providerName: trimToNull(provider.name) || providerId,
    selectedProviderId: provider.id ?? null,
  };
};

const buildLegacyCustomProviderConfig = (
  legacySettings: LegacyUserProviderSettings,
  modelOverride?: string | null,
): OpenCodeConfig => {
  const baseUrl = trimToNull(legacySettings.providerBaseUrl);
  const model = trimToNull(modelOverride ?? legacySettings.providerModel);
  const apiKey = trimToNull(legacySettings.providerApiKey);
  const hasAnyCustomSetting = Boolean(baseUrl || model || apiKey);

  if (!hasAnyCustomSetting) {
    if (!env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }

    return {
      apiKey: env.OPENROUTER_API_KEY,
      apiKeyEnvVar: "OPENROUTER_API_KEY",
      baseUrl: null,
      model: modelOverride?.trim()
        ? normalizeOpenCodeModelForProvider(modelOverride, DEFAULT_OPENCODE_PROVIDER_ID)
        : getConfiguredOpenCodeModel(),
      providerId: DEFAULT_OPENCODE_PROVIDER_ID,
      providerName: DEFAULT_OPENCODE_NAME,
      selectedProviderId: null,
    };
  }

  if (!baseUrl || !model || !apiKey) {
    throw new Error(
      "Custom provider settings are incomplete. Set API Base URL, Model, and API Key, or clear all three fields to use the server default.",
    );
  }

  return {
    apiKey,
    apiKeyEnvVar: CUSTOM_OPENCODE_API_KEY_ENV_VAR,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: normalizeOpenCodeModelForProvider(model, LEGACY_CUSTOM_PROVIDER_ID),
    providerId: LEGACY_CUSTOM_PROVIDER_ID,
    providerName: "Legacy Provider",
    selectedProviderId: null,
  };
};

export const resolveOpenCodeConfig = (input?: {
  legacySettings?: LegacyUserProviderSettings | null;
  model?: string | null;
  provider?: SavedUserProvider | null;
}): OpenCodeConfig => {
  if (input?.provider) {
    return buildSavedProviderConfig(input.provider, input.model);
  }

  return buildLegacyCustomProviderConfig(input?.legacySettings ?? {}, input?.model);
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
            name: config.providerName,
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

export const getOpenCodeChatCompletionsEndpoint = (config: OpenCodeConfig) =>
  config.providerId === DEFAULT_OPENCODE_PROVIDER_ID
    ? OPENROUTER_CHAT_COMPLETIONS_URL
    : `${normalizeBaseUrl(config.baseUrl ?? "")}/chat/completions`;
