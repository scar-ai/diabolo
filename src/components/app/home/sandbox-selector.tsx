import { BoxIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DEFAULT_SANDBOX_TIER_ID,
  isSandboxTierId,
  SANDBOX_TIER_LIST,
  SANDBOX_TIERS,
  type SandboxTierId,
} from "@/lib/sandbox/tiers";

const STORAGE_KEY = "diabolo.sandbox-tier";
const listeners = new Set<() => void>();

const subscribe = (onStoreChange: () => void) => {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
};

const readStoredTierId = (): SandboxTierId => {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isSandboxTierId(stored) ? stored : DEFAULT_SANDBOX_TIER_ID;
};

/**
 * The selected sandbox size, remembered per browser. Server renders get the
 * default so hydration matches; the stored value lands on the first client
 * render after that.
 */
export function useSandboxTier() {
  const tierId = useSyncExternalStore(subscribe, readStoredTierId, () => DEFAULT_SANDBOX_TIER_ID);

  const setTierId = useCallback((next: SandboxTierId) => {
    window.localStorage.setItem(STORAGE_KEY, next);

    for (const listener of listeners) {
      listener();
    }
  }, []);

  return [tierId, setTierId] as const;
}

export function SandboxSelector({
  disabled = false,
  onSelectTier,
  tierId,
}: {
  disabled?: boolean;
  onSelectTier: (tierId: SandboxTierId) => void;
  tierId: SandboxTierId;
}) {
  const currentTier = SANDBOX_TIERS[tierId];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label="Sandbox size"
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground/70 transition-colors hover:border-border hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70 aria-expanded:border-border aria-expanded:bg-accent aria-expanded:text-foreground"
      >
        <BoxIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{currentTier.label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="min-w-60">
        {SANDBOX_TIER_LIST.map((tier) => (
          <DropdownMenuItem key={tier.id} onClick={() => onSelectTier(tier.id)}>
            <span className="flex w-full items-center justify-between gap-3">
              <span className="flex flex-col gap-1">
                <span>{tier.label}</span>
                <span className="text-xs text-muted-foreground">{tier.summary}</span>
              </span>
              {tier.id === tierId ? (
                <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
