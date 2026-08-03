import { DEFAULT_CODEX_MODEL, OPENAI_CODEX_RESPONSES_PROVIDER_ID } from "@/lib/opencode/constants";

export { DEFAULT_CODEX_MODEL };
const DEFAULT_MANUAL_BASE_URL = "https://api.openai.com/v1";

export type ProviderDraft = {
  authStatus?: "connected" | "disconnected" | "pending";
  canManage?: boolean;
  codexAuthenticatedAt?: string | null;
  codexAuthError?: string | null;
  id: string;
  isDefault: boolean;
  name: string;
  providerApiKey: string;
  providerBaseUrl: string;
  providerId: string;
  providerKind: "codex" | "manual";
  providerModel: string;
  scope: "organisation" | "personal";
};

export const toSaveProviderInput = <TProvider extends ProviderDraft>(provider: TProvider) => ({
  authStatus: provider.authStatus,
  codexAuthenticatedAt: provider.codexAuthenticatedAt ?? null,
  codexAuthError: provider.codexAuthError ?? null,
  id: provider.id,
  isDefault: provider.isDefault,
  name: provider.name,
  providerApiKey: provider.providerApiKey,
  providerBaseUrl: provider.providerBaseUrl,
  providerId: provider.providerId,
  providerKind: provider.providerKind,
  providerModel: provider.providerModel,
  scope: provider.scope,
});

export const toSerializableProviders = <TProvider extends ProviderDraft>(providers: TProvider[]) =>
  JSON.parse(JSON.stringify(providers.map(toSaveProviderInput))) as Array<
    ReturnType<typeof toSaveProviderInput<TProvider>>
  >;

export const createProviderDraft = (
  scope: ProviderDraft["scope"],
  overrides?: Partial<ProviderDraft>,
): ProviderDraft => ({
  authStatus: "connected",
  codexAuthenticatedAt: null,
  codexAuthError: null,
  id: crypto.randomUUID(),
  isDefault: false,
  name: "",
  providerApiKey: "",
  providerBaseUrl: DEFAULT_MANUAL_BASE_URL,
  providerId: "openai",
  providerKind: "manual",
  providerModel: "",
  scope,
  ...overrides,
});

export const setProviderDraftKind = <TProvider extends ProviderDraft>(
  provider: TProvider,
  providerKind: ProviderDraft["providerKind"],
): TProvider => {
  if (providerKind === "codex") {
    return {
      ...provider,
      authStatus: "disconnected",
      codexAuthError: null,
      providerApiKey: "",
      providerBaseUrl: "",
      providerId: OPENAI_CODEX_RESPONSES_PROVIDER_ID,
      providerKind,
      providerModel: provider.providerModel || DEFAULT_CODEX_MODEL,
    };
  }

  return {
    ...provider,
    providerApiKey: "",
    providerBaseUrl: DEFAULT_MANUAL_BASE_URL,
    providerId:
      provider.providerId === OPENAI_CODEX_RESPONSES_PROVIDER_ID ? "openai" : provider.providerId,
    providerKind,
  };
};
