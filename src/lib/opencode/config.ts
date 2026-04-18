import "@tanstack/react-start/server-only";
import { ensureCodexAccessToken, isCodexProvider } from "./codex";

const CUSTOM_OPENCODE_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible";
const CUSTOM_OPENCODE_API_KEY_ENV_VAR = "OPENCODE_PROVIDER_API_KEY";
const OPENCODE_LOCAL_PROXY_BASE_URL = "http://127.0.0.1:4312";
export const OPENAI_CODEX_RESPONSES_PROVIDER_ID = "openai-codex-responses";
const OPENROUTER_BASE_URL_PATTERN = /^https?:\/\/(?:www\.)?openrouter\.ai\/api(?:\/v\d+)?\/?$/i;

export type SavedOpenCodeProvider = {
  oauthAccessToken?: string | null;
  oauthAccessTokenExpiresAt?: Date | null;
  oauthAuthenticatedAt?: Date | null;
  oauthDeviceCode?: string | null;
  oauthDeviceCodeExpiresAt?: Date | null;
  oauthError?: string | null;
  oauthPollingIntervalSeconds?: string | null;
  oauthRefreshToken?: string | null;
  oauthRefreshTokenExpiresAt?: Date | null;
  oauthScope?: string | null;
  oauthUserCode?: string | null;
  oauthVerificationUri?: string | null;
  oauthVerificationUriComplete?: string | null;
  id?: string | null;
  name?: string | null;
  providerApiKey?: string | null;
  providerBaseUrl?: string | null;
  providerKind?: string | null;
  providerId?: string | null;
  providerModel?: string | null;
};

export type OpenCodeConfig = {
  apiKey: string;
  apiKeyEnvVar: string;
  baseUrl: string;
  model: string;
  providerId: string;
  providerKind: "codex" | "manual";
  providerName: string;
  runtimeApiKey?: string;
  runtimeBaseUrl?: string;
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

export const resolveOpenCodeConfig = async (input: {
  model?: string | null;
  provider: SavedOpenCodeProvider;
}): Promise<OpenCodeConfig> => {
  const providerId = trimToNull(input.provider.providerId);
  const model = trimToNull(input.model ?? input.provider.providerModel);
  const selectedProviderId = trimToNull(input.provider.id);
  const providerKind = isCodexProvider(input.provider) ? "codex" : "manual";

  if (!providerId || !model || !selectedProviderId) {
    throw new Error(
      "Selected provider is incomplete. Set Provider ID and Model before starting a task.",
    );
  }

  if (providerKind === "codex") {
    const codexProviderId = OPENAI_CODEX_RESPONSES_PROVIDER_ID;
    const apiKey = await ensureCodexAccessToken({
      id: selectedProviderId,
      oauthAccessToken: input.provider.oauthAccessToken ?? null,
      oauthAccessTokenExpiresAt: input.provider.oauthAccessTokenExpiresAt ?? null,
      oauthRefreshToken: input.provider.oauthRefreshToken ?? null,
      oauthRefreshTokenExpiresAt: input.provider.oauthRefreshTokenExpiresAt ?? null,
      oauthScope: input.provider.oauthScope ?? null,
      providerKind: "codex",
    });
    const runtimeBaseUrl = OPENCODE_LOCAL_PROXY_BASE_URL;

    return {
      apiKey,
      apiKeyEnvVar: CUSTOM_OPENCODE_API_KEY_ENV_VAR,
      baseUrl: runtimeBaseUrl,
      model: normalizeOpenCodeModelForProvider(model, codexProviderId),
      providerId: codexProviderId,
      providerKind,
      providerName: trimToNull(input.provider.name) || codexProviderId,
      runtimeApiKey: apiKey,
      runtimeBaseUrl,
      selectedProviderId,
    };
  }

  const baseUrl = trimToNull(input.provider.providerBaseUrl);
  const apiKey = normalizeProviderApiKey(input.provider.providerApiKey);

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Selected provider is incomplete. Set API Base URL and API Key before starting a task.",
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
    providerKind,
    providerName: trimToNull(input.provider.name) || providerId,
    runtimeBaseUrl: OPENCODE_LOCAL_PROXY_BASE_URL,
    selectedProviderId,
  };
};

export const buildOpenCodeConfigContent = (config: OpenCodeConfig) => {
  const providerScopedModelId = getProviderScopedModelId(config.model, config.providerId);
  const titlePrompt = [
    "You write short titles for coding work sessions.",
    "Return only the title text, with no quotes or markdown.",
    "Summarize the user's prompt explicitly and descriptively.",
    "Keep it under 48 characters and 2 to 6 words when possible.",
    "Avoid vague filler like task, help, update, fix this, or miscellaneous.",
  ].join(" ");

  const output: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    agent: {
      title: {
        prompt: titlePrompt,
        temperature: 0.1,
      },
    },
    model: config.model,
    permission: {
      bash: {
        "*": "allow",
      },
      edit: "allow",
      question: "deny",
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
          baseURL: config.runtimeBaseUrl ?? config.baseUrl,
          setCacheKey: true,
        },
      },
    },
  };

  return JSON.stringify(output);
};

export const buildOpenCodeRuntimeFingerprint = (config: OpenCodeConfig) =>
  JSON.stringify({
    apiKeyEnvVar: config.apiKeyEnvVar,
    baseUrl: normalizeBaseUrl(config.baseUrl),
    model: config.model,
    providerId: config.providerId,
    providerKind: config.providerKind,
    runtimeBaseUrl: normalizeBaseUrl(config.runtimeBaseUrl ?? config.baseUrl),
    selectedProviderId: config.selectedProviderId,
  });

export const getOpenCodeChatCompletionsEndpoint = (config: OpenCodeConfig) =>
  `${normalizeBaseUrl(config.baseUrl)}/chat/completions`;
