import { CheckCircle2Icon, CircleDotIcon, LoaderIcon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig = {
  queued: {
    label: "Queued",
    icon: CircleDotIcon,
    variant: "secondary" as const,
  },
  running: {
    label: "Running",
    icon: LoaderIcon,
    variant: "info" as const,
  },
  succeeded: {
    label: "Completed",
    icon: CheckCircle2Icon,
    variant: "success" as const,
  },
  failed: {
    label: "Failed",
    icon: XCircleIcon,
    variant: "error" as const,
  },
};

export type TaskStatus = keyof typeof statusConfig;

export function TaskStatusBadge({ status, className }: { className?: string; status: string }) {
  const config = status in statusConfig ? statusConfig[status as TaskStatus] : statusConfig.queued;
  const StatusIcon = config.icon;
  const isSpinning = status === "running";

  return (
    <Badge variant={config.variant} size="sm" className={cn("gap-1", className)}>
      <StatusIcon className={`size-3 ${isSpinning ? "animate-spin" : ""}`} aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
