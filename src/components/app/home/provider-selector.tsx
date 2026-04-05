import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type UserProviderOption = {
  id: string;
  isDefault: boolean;
  name: string;
  providerId: string;
  providerModel: string;
};

export const SERVER_DEFAULT_PROVIDER_VALUE = "__server_default__";

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
  const currentProvider =
    currentProviderId === SERVER_DEFAULT_PROVIDER_VALUE
      ? null
      : (providers.find((provider) => provider.id === currentProviderId) ?? null);

  return (
    <Select
      value={currentProviderId}
      onValueChange={(value) => onSelectProvider(value ?? SERVER_DEFAULT_PROVIDER_VALUE)}
      disabled={disabled || isPending}
    >
      <SelectTrigger aria-label="Select provider" size="sm">
        <SelectValue>
          {currentProvider
            ? `${currentProvider.name}${currentProvider.isDefault ? " · Default" : ""}`
            : isPending
              ? "Loading providers..."
              : "Server default"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SERVER_DEFAULT_PROVIDER_VALUE}>
          <span className="flex flex-col">
            <span>Server default</span>
            <span className="text-xs text-muted-foreground">OpenRouter fallback</span>
          </span>
        </SelectItem>
        {providers.map((provider) => (
          <SelectItem key={provider.id} value={provider.id}>
            <span className="flex flex-col">
              <span>{provider.name}</span>
              <span className="text-xs text-muted-foreground">
                {provider.providerId}/{provider.providerModel}
                {provider.isDefault ? " · Default" : ""}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
