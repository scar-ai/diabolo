import { ChevronDownIcon, CpuIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type UserProviderOption = {
  id: string;
  isDefault: boolean;
  name: string;
  providerId: string;
  providerModel: string;
  scope?: string;
};

export function ProviderSelector({
  currentProviderId,
  disabled = false,
  isPending = false,
  onSelectProvider,
  providers,
}: {
  currentProviderId: string;
  disabled?: boolean;
  isPending?: boolean;
  onSelectProvider: (providerId: string) => void;
  providers: UserProviderOption[];
}) {
  const currentProvider = providers.find((provider) => provider.id === currentProviderId) ?? null;

  const providerDisplayName = (provider: UserProviderOption) =>
    `${provider.name}${provider.isDefault ? " · Default" : ""}`;

  const label = currentProvider
    ? providerDisplayName(currentProvider)
    : isPending
      ? "Loading..."
      : "No providers";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || isPending || providers.length === 0}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1.5 text-sm text-muted-foreground/70 transition-colors hover:border-border hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70 aria-expanded:border-border aria-expanded:bg-accent aria-expanded:text-foreground"
      >
        <CpuIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" sideOffset={8} className="min-w-56">
        {providers.map((provider) => (
          <DropdownMenuItem key={provider.id} onClick={() => onSelectProvider(provider.id)}>
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5">
                <span>{providerDisplayName(provider)}</span>
                {provider.scope === "organisation" && (
                  <Badge variant="secondary" className="text-[10px]">
                    Organisation
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {provider.providerId}/{provider.providerModel}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
