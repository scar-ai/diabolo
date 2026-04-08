import { useSyncExternalStore } from "react";

type ClientTimeTextProps = {
  options?: Intl.DateTimeFormatOptions;
  value: Date | string;
};

export function ClientTimeText({ options, value }: ClientTimeTextProps) {
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!isHydrated) {
    return null;
  }

  return new Date(value).toLocaleTimeString([], options);
}

export function useClientNow(intervalMs = 60_000) {
  return useSyncExternalStore(
    (onStoreChange) => {
      const interval = window.setInterval(onStoreChange, intervalMs);
      return () => window.clearInterval(interval);
    },
    () => new Date(),
    () => null,
  );
}
