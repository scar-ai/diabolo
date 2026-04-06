import "@tanstack/react-start/server-only";

const CUSTOM_OPENCODE_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible";
const CUSTOM_OPENCODE_API_KEY_ENV_VAR = "OPENCODE_PROVIDER_API_KEY";
const OPENROUTER_BASE_URL_PATTERN = /^https?:\/\/(?:www\.)?openrouter\.ai\/api(?:\/v\d+)?\/?$/i;

export type SavedOpenCodeProvider = {
  id?: string | null;
  name?: string | null;
  providerApiKey?: string | null;
  providerBaseUrl?: string | null;
  providerId?: string | null;
  providerModel?: string | null;
};

export type OpenCodeConfig = {
  apiKey: string;
  apiKeyEnvVar: string;
  baseUrl: string;
  model: string;
  providerId: string;
  providerName: string;
  selectedProviderId: string;
};

const trimToNull = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

export const normalizeProviderApiKey = (value?: string | null) => {
  const trimmed = trimToNull(value);

  if (!trimmed) {
    return null;
  }

  const withoutAssignment = trimmed.replace(/^(?:export\s+)?[A-Z][A-Z0-9_]*\s*=\s*/i, "");
  const withoutBearer = withoutAssignment.replace(/^Bearer\s+/i, "");
  const unquoted =
    (withoutBearer.startsWith('"') && withoutBearer.endsWith('"')) ||
    (withoutBearer.startsWith("'") && withoutBearer.endsWith("'"))
      ? withoutBearer.slice(1, -1).trim()
      : withoutBearer;

  return unquoted || null;
};

const isOpenRouterBaseUrl = (value: string) => OPENROUTER_BASE_URL_PATTERN.test(value);

export const getProviderScopedModelId = (model: string, providerId: string) => {
  const prefix = `${providerId}/`;

  if (model.startsWith(prefix)) {
    return model.slice(prefix.length);
  }

  return model;
};

export const normalizeOpenCodeModelForProvider = (model: string, providerId: string) => {
  const trimmed = model.trim();

  if (!trimmed) {
    throw new Error("Provider model is required.");
  }

  const prefix = `${providerId}/`;

  if (trimmed.startsWith(prefix)) {
    return trimmed;
  }

  return `${providerId}/${trimmed}`;
};

export const resolveOpenCodeConfig = (input: {
  model?: string | null;
  provider: SavedOpenCodeProvider;
}): OpenCodeConfig => {
  const providerId = trimToNull(input.provider.providerId);
  const baseUrl = trimToNull(input.provider.providerBaseUrl);
  const model = trimToNull(input.model ?? input.provider.providerModel);
  const apiKey = normalizeProviderApiKey(input.provider.providerApiKey);
  const selectedProviderId = trimToNull(input.provider.id);

  if (!providerId || !baseUrl || !model || !apiKey || !selectedProviderId) {
    throw new Error(
      "Selected provider is incomplete. Set Provider ID, API Base URL, Model, and API Key before starting a task.",
    );
  }

  if (isOpenRouterBaseUrl(baseUrl) && !apiKey.startsWith("sk-or-v1-")) {
    throw new Error(
      "Selected provider uses OpenRouter, but its API key does not look like a raw OpenRouter key. Paste the secret itself, not a header or env assignment.",
    );
  }

  return {
    apiKey,
    apiKeyEnvVar: CUSTOM_OPENCODE_API_KEY_ENV_VAR,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: normalizeOpenCodeModelForProvider(model, providerId),
    providerId,
    providerName: trimToNull(input.provider.name) || providerId,
    selectedProviderId,
  };
};

export const buildOpenCodeConfigContent = (config: OpenCodeConfig) => {
  const providerScopedModelId = getProviderScopedModelId(config.model, config.providerId);

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
    provider: {
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
    },
  };

  return JSON.stringify(output);
};

export const getOpenCodeChatCompletionsEndpoint = (config: OpenCodeConfig) =>
  `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;
