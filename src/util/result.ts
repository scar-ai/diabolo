import { ResultAsync } from "neverthrow";

export const toError = (value: unknown) =>
  value instanceof Error ? value : new Error(String(value));

export const fromPromise = <T>(promise: Promise<T>) => ResultAsync.fromPromise(promise, toError);

export const unwrap = <T>(result: ResultAsync<T, Error>) =>
  result.match(
    (value) => value,
    (error) => {
      throw error;
    },
  );
