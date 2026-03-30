import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildScheduleCron,
  DEFAULT_SCHEDULE_PRESET_CONFIG,
  getSchedulePreset,
  isValidCronExpression,
  isValidTimezone,
  MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH,
  MAX_SCHEDULED_TASK_NAME_LENGTH,
  SCHEDULE_PRESETS,
  type SchedulePresetConfig,
  type SchedulePresetValue,
} from "@/lib/project/scheduled-tasks";

const supportedTimezones =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];

const minutes = Array.from({ length: 60 }, (_, value) => value);
const hours = Array.from({ length: 24 }, (_, value) => value);
const weekdays = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];
const monthDays = Array.from({ length: 31 }, (_, index) => index + 1);

function formatTwoDigits(value: number) {
  return String(value).padStart(2, "0");
}

function timeLabel(hour: number, minute: number) {
  return `${formatTwoDigits(hour)}:${formatTwoDigits(minute)}`;
}

export function ScheduledTaskDialog({
  branches,
  defaultBranch,
  isPending,
  onOpenChange,
  onSubmit,
  open,
}: {
  branches: string[];
  defaultBranch: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    branchName: string | null;
    instructions: string;
    name: string;
    scheduleCron: string;
    scheduleTimezone: string;
  }) => void;
  open: boolean;
}) {
  const timezoneListId = useId();
  const nameInputId = useId();
  const scheduleInputId = useId();
  const timezoneInputId = useId();
  const branchInputId = useId();
  const instructionsInputId = useId();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<SchedulePresetValue>("daily");
  const [customCron, setCustomCron] = useState("");
  const [scheduleTimezone, setScheduleTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [instructions, setInstructions] = useState("");
  const [branchMode, setBranchMode] = useState<"default" | "custom">("default");
  const [branchName, setBranchName] = useState(defaultBranch);
  const [presetConfig, setPresetConfig] = useState<SchedulePresetConfig>(
    DEFAULT_SCHEDULE_PRESET_CONFIG,
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setName("");
    setPreset("daily");
    setCustomCron("");
    setScheduleTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setInstructions("");
    setBranchMode("default");
    setBranchName(defaultBranch);
    setPresetConfig(DEFAULT_SCHEDULE_PRESET_CONFIG);
  }, [defaultBranch, open]);

  const selectedPreset = getSchedulePreset(preset);
  const scheduleCron = useMemo(() => {
    if (preset === "custom") {
      return customCron.trim();
    }

    return buildScheduleCron(preset, presetConfig);
  }, [customCron, preset, presetConfig]);

  const cronIsValid = isValidCronExpression(scheduleCron);
  const timezoneIsValid = isValidTimezone(scheduleTimezone);
  const instructionsValue = instructions.trim();
  const nameValue = name.trim();
  const selectedBranchName = branchMode === "custom" ? branchName : null;
  const selectedBranchLabel =
    branchMode === "default" ? `Project default (${defaultBranch})` : branchName;

  const canSubmit =
    nameValue.length > 0 &&
    nameValue.length <= MAX_SCHEDULED_TASK_NAME_LENGTH &&
    instructionsValue.length > 0 &&
    instructionsValue.length <= MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH &&
    cronIsValid &&
    timezoneIsValid &&
    (branchMode === "default" || branchName.length > 0) &&
    !isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New scheduled task</DialogTitle>
          <DialogDescription>
            Save an automation that will start future sessions on a schedule for this project.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label
              htmlFor={nameInputId}
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Name
            </label>
            <Input
              id={nameInputId}
              maxLength={MAX_SCHEDULED_TASK_NAME_LENGTH}
              placeholder="Daily dependency audit"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {name.length}/{MAX_SCHEDULED_TASK_NAME_LENGTH}
            </p>
          </div>

          <div className="sm:col-span-2">
            <div id={scheduleInputId} className="mb-1.5 text-sm font-medium text-foreground">
              Schedule
            </div>
            <Select
              aria-labelledby={scheduleInputId}
              value={preset}
              onValueChange={(value) => {
                const nextPreset = value as SchedulePresetValue;
                setPreset(nextPreset);
                if (nextPreset !== "custom") {
                  setCustomCron("");
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_PRESETS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{selectedPreset.description}</p>

            {preset === "hourly" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Minute</div>
                  <Select
                    value={String(presetConfig.minute)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, minute: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {minutes.map((minute) => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatTwoDigits(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {preset === "daily" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Hour</div>
                  <Select
                    value={String(presetConfig.hour)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, hour: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {hours.map((hour) => (
                        <SelectItem key={hour} value={String(hour)}>
                          {formatTwoDigits(hour)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Minute</div>
                  <Select
                    value={String(presetConfig.minute)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, minute: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {minutes.map((minute) => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatTwoDigits(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {preset === "weekly" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Weekday</div>
                  <Select
                    value={String(presetConfig.dayOfWeek)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, dayOfWeek: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {weekdays.map((day) => (
                        <SelectItem key={day.value} value={String(day.value)}>
                          {day.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Hour</div>
                  <Select
                    value={String(presetConfig.hour)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, hour: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {hours.map((hour) => (
                        <SelectItem key={hour} value={String(hour)}>
                          {formatTwoDigits(hour)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Minute</div>
                  <Select
                    value={String(presetConfig.minute)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, minute: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {minutes.map((minute) => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatTwoDigits(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {preset === "monthly" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Day of month
                  </div>
                  <Select
                    value={String(presetConfig.dayOfMonth)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, dayOfMonth: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {monthDays.map((day) => (
                        <SelectItem key={day} value={String(day)}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Hour</div>
                  <Select
                    value={String(presetConfig.hour)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, hour: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {hours.map((hour) => (
                        <SelectItem key={hour} value={String(hour)}>
                          {formatTwoDigits(hour)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Minute</div>
                  <Select
                    value={String(presetConfig.minute)}
                    onValueChange={(value) =>
                      setPresetConfig((current) => ({ ...current, minute: Number(value) }))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {minutes.map((minute) => (
                        <SelectItem key={minute} value={String(minute)}>
                          {formatTwoDigits(minute)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {preset !== "custom" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Cron: {scheduleCron} · Local time{" "}
                {timeLabel(presetConfig.hour, presetConfig.minute)}
              </p>
            ) : null}

            {preset === "custom" ? (
              <div className="mt-3">
                <Input
                  className="font-mono"
                  placeholder="0 9 * * 1-5"
                  value={customCron}
                  onChange={(event) => setCustomCron(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Use a 5-field cron expression: minute hour day month weekday.
                </p>
                {customCron.trim().length > 0 && !cronIsValid ? (
                  <p className="mt-1 text-xs text-destructive">Enter a valid cron expression.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor={timezoneInputId}
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Timezone
            </label>
            <Input
              id={timezoneInputId}
              list={timezoneListId}
              placeholder="Europe/Paris"
              value={scheduleTimezone}
              onChange={(event) => setScheduleTimezone(event.target.value)}
            />
            <datalist id={timezoneListId}>
              {supportedTimezones.map((timezone) => (
                <option key={timezone} value={timezone} />
              ))}
            </datalist>
            {!timezoneIsValid ? (
              <p className="mt-1 text-xs text-destructive">Enter a valid IANA timezone.</p>
            ) : null}
          </div>

          <div>
            <div id={branchInputId} className="mb-1.5 text-sm font-medium text-foreground">
              Branch
              <span className="ml-1 text-xs font-normal text-muted-foreground">Optional</span>
            </div>
            <Select
              aria-labelledby={branchInputId}
              value={branchMode === "default" ? "__default__" : branchName}
              onValueChange={(value) => {
                if (value === "__default__") {
                  setBranchMode("default");
                  setBranchName(defaultBranch);
                  return;
                }

                setBranchMode("custom");
                setBranchName(typeof value === "string" ? value : defaultBranch);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{selectedBranchLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Project default ({defaultBranch})</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor={instructionsInputId}
              className="mb-1.5 block text-sm font-medium text-foreground"
            >
              Instructions
            </label>
            <Textarea
              id={instructionsInputId}
              className="min-h-36 resize-y"
              maxLength={MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH}
              placeholder="Review the open work in this repository, run the relevant checks, and implement the highest-impact safe improvement you can make."
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {instructions.length}/{MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                branchName: selectedBranchName,
                instructions: instructionsValue,
                name: nameValue,
                scheduleCron,
                scheduleTimezone,
              })
            }
          >
            {isPending ? "Starting..." : "Start scheduled task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
