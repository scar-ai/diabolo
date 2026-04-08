import { useEffect, useState } from "react";

type ClientTimeTextProps = {
  options?: Intl.DateTimeFormatOptions;
  value: Date | string;
};

export function ClientTimeText({ options, value }: ClientTimeTextProps) {
  const isHydrated = useClientHydrated();

  if (!isHydrated) {
    return null;
  }

  return new Date(value).toLocaleTimeString([], options);
}

export function useClientNow(intervalMs = 60_000) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const updateNow = () => {
      setNow(new Date());
    };

    const timeout = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, intervalMs);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}

function useClientHydrated() {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setIsHydrated(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  return isHydrated;
}
