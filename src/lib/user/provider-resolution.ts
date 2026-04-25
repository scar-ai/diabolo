import "@tanstack/react-start/server-only";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import {
  normalizeOpenCodeModelForProvider,
  resolveOpenCodeConfig,
  type OpenCodeConfig,
} from "@/lib/opencode/config";
import { fromPromise } from "@/lib/result";

import { findUserLlmProvider, listUserLlmProviders, type UserLlmProviderRecord } from "./data";

const findProviderForModel = (
  providers: UserLlmProviderRecord[],
  model?: string | null,
): UserLlmProviderRecord | null => {
  const trimmedModel = model?.trim();

  if (!trimmedModel) {
    return null;
  }

  return (
    providers.find((candidate) => {
      if (!candidate.providerId?.trim() || !candidate.providerModel?.trim()) {
        return false;
      }

      if (candidate.providerModel.trim() === trimmedModel) {
        return true;
      }

      try {
        return (
          normalizeOpenCodeModelForProvider(candidate.providerModel, candidate.providerId) ===
          trimmedModel
        );
      } catch {
        return false;
      }
    }) ?? null
  );
};

export type ResolvedUserProvider = {
  openCodeConfig: OpenCodeConfig;
  provider: UserLlmProviderRecord;
  selectionSource: "default" | "explicit" | "first_available" | "model_match";
};

export const resolveUserProvider = (input: {
  model?: string | null;
  providerRecordId?: string | null;
  userId: string;
}): ResultAsync<ResolvedUserProvider, Error> =>
  fromPromise(
    Promise.all([
      input.providerRecordId
        ? findUserLlmProvider(input.userId, input.providerRecordId)
        : Promise.resolve(null),
      listUserLlmProviders(input.userId),
    ]),
  ).andThen(([explicitProvider, providers]) => {
    if (input.providerRecordId && !explicitProvider) {
      return errAsync(new Error("Selected provider was not found."));
    }

    const modelMatchedProvider = input.providerRecordId
      ? null
      : findProviderForModel(providers, input.model ?? null);
    const defaultProvider = providers.find((provider) => provider.isDefault) ?? null;
    const firstProvider = providers[0] ?? null;
    const provider = explicitProvider ?? modelMatchedProvider ?? defaultProvider ?? firstProvider;

    if (!provider) {
      return errAsync(new Error("Add at least one provider in Settings before starting a task."));
    }

    const selectionSource: ResolvedUserProvider["selectionSource"] =
      explicitProvider !== null
        ? "explicit"
        : modelMatchedProvider !== null
          ? "model_match"
          : defaultProvider?.id === provider.id
            ? "default"
            : "first_available";

    return fromPromise(
      resolveOpenCodeConfig({
        model: input.model ?? null,
        provider,
      }),
    ).andThen((openCodeConfig) =>
      okAsync({
        openCodeConfig,
        provider,
        selectionSource,
      }),
    );
  });
