import { BrainIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { REASONING_EFFORT_VALUES, type ReasoningEffort } from "@/lib/models/reasoning-effort";

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  high: "High",
  low: "Low",
  medium: "Medium",
};

export function ReasoningEffortSelector({
  disabled = false,
  onValueChange,
  value,
}: {
  disabled?: boolean;
  onValueChange: (value: ReasoningEffort | null) => void;
  value: ReasoningEffort | null;
}) {
  return (
    <Select
      value={value ?? "default"}
      onValueChange={(next) => onValueChange(next === "default" ? null : (next as ReasoningEffort))}
    >
      <SelectTrigger
        size="sm"
        disabled={disabled}
        aria-label="Reasoning effort"
        className="h-8 rounded-lg border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
      >
        <BrainIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <SelectValue placeholder="Reasoning" className="capitalize" />
      </SelectTrigger>
      <SelectContent side="top" sideOffset={8} className="min-w-40">
        <SelectItem value="default">Reasoning: Default</SelectItem>
        {REASONING_EFFORT_VALUES.map((effort) => (
          <SelectItem key={effort} value={effort}>
            {`Reasoning: ${REASONING_EFFORT_LABELS[effort]}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
