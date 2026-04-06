export const MAX_SCHEDULED_TASK_NAME_LENGTH = 200;
export const MAX_SCHEDULED_TASK_INSTRUCTIONS_LENGTH = 10_000;

export const SCHEDULE_PRESETS = [
  {
    value: "hourly",
    label: "Every hour",
    description: "Run every hour at the selected minute",
  },
  {
    value: "daily",
    label: "Daily",
    description: "Run every day at the selected time",
  },
  {
    value: "weekly",
    label: "Weekly",
    description: "Run on the selected weekday at the selected time",
  },
  {
    value: "monthly",
    label: "Monthly",
    description: "Run on the selected day of the month at the selected time",
  },
  {
    value: "custom",
    label: "Custom cron expression",
    description: "Use a 5-field cron expression",
  },
] as const;

export type SchedulePresetValue = (typeof SCHEDULE_PRESETS)[number]["value"];

export type SchedulePresetConfig = {
  dayOfMonth: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
};

export const DEFAULT_SCHEDULE_PRESET_CONFIG: SchedulePresetConfig = {
  dayOfMonth: 1,
  dayOfWeek: 1,
  hour: 9,
  minute: 0,
};

const CRON_FIELDS = [
  { max: 59, min: 0 },
  { max: 23, min: 0 },
  { max: 31, min: 1 },
  { max: 12, min: 1 },
  { max: 7, min: 0 },
] as const;

const integerPattern = /^\d+$/;

function parseCronPart(
  part: string,
  range: { min: number; max: number },
  allowSevenForSunday = false,
) {
  const normalized = allowSevenForSunday ? part.replace(/\b7\b/g, "0") : part;

  for (const segment of normalized.split(",")) {
    if (!segment) {
      return false;
    }

    const [base, stepValue] = segment.split("/");
    const step = stepValue ? Number(stepValue) : null;

    if (stepValue && (!integerPattern.test(stepValue) || !step || step < 1)) {
      return false;
    }

    if (base === "*") {
      continue;
    }

    if (base.includes("-")) {
      const [start, end] = base.split("-");

      if (!integerPattern.test(start ?? "") || !integerPattern.test(end ?? "")) {
        return false;
      }

      const startNumber = Number(start);
      const endNumber = Number(end);

      if (startNumber < range.min || endNumber > range.max || startNumber > endNumber) {
        return false;
      }

      continue;
    }

    if (!integerPattern.test(base)) {
      return false;
    }

    const value = Number(base);
    if (value < range.min || value > range.max) {
      return false;
    }
  }

  return true;
}

export function isValidCronExpression(value: string) {
  const parts = value.trim().split(/\s+/);

  if (parts.length !== 5) {
    return false;
  }

  return parts.every((part, index) => parseCronPart(part, CRON_FIELDS[index], index === 4));
}

export function isValidTimezone(value: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function getSchedulePreset(value: string) {
  return SCHEDULE_PRESETS.find((preset) => preset.value === value) ?? SCHEDULE_PRESETS.at(-1)!;
}

export function buildScheduleCron(
  preset: Exclude<SchedulePresetValue, "custom">,
  config: SchedulePresetConfig,
) {
  switch (preset) {
    case "hourly":
      return `${config.minute} * * * *`;
    case "daily":
      return `${config.minute} ${config.hour} * * *`;
    case "weekly":
      return `${config.minute} ${config.hour} * * ${config.dayOfWeek}`;
    case "monthly":
      return `${config.minute} ${config.hour} ${config.dayOfMonth} * *`;
  }
}

export function detectSchedulePreset(cron: string): {
  config: SchedulePresetConfig;
  preset: SchedulePresetValue;
} {
  const parts = cron.trim().split(/\s+/);

  if (parts.length !== 5) {
    return { config: DEFAULT_SCHEDULE_PRESET_CONFIG, preset: "custom" };
  }

  const [minute, hour, dayOfMonth, _month, dayOfWeek] = parts;

  const config: SchedulePresetConfig = {
    dayOfMonth: integerPattern.test(dayOfMonth)
      ? Number(dayOfMonth)
      : DEFAULT_SCHEDULE_PRESET_CONFIG.dayOfMonth,
    dayOfWeek: integerPattern.test(dayOfWeek)
      ? Number(dayOfWeek.replace("7", "0"))
      : DEFAULT_SCHEDULE_PRESET_CONFIG.dayOfWeek,
    hour: integerPattern.test(hour) ? Number(hour) : DEFAULT_SCHEDULE_PRESET_CONFIG.hour,
    minute: integerPattern.test(minute) ? Number(minute) : DEFAULT_SCHEDULE_PRESET_CONFIG.minute,
  };

  if (minute !== "*" && hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    return { config, preset: "hourly" };
  }

  if (
    integerPattern.test(minute) &&
    integerPattern.test(hour) &&
    dayOfMonth === "*" &&
    dayOfWeek === "*"
  ) {
    return { config, preset: "daily" };
  }

  if (
    integerPattern.test(minute) &&
    integerPattern.test(hour) &&
    dayOfMonth === "*" &&
    integerPattern.test(dayOfWeek.replace("7", "0"))
  ) {
    return { config, preset: "weekly" };
  }

  if (
    integerPattern.test(minute) &&
    integerPattern.test(hour) &&
    integerPattern.test(dayOfMonth) &&
    dayOfWeek === "*"
  ) {
    return { config, preset: "monthly" };
  }

  return { config, preset: "custom" };
}

const weekdayLabels = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function describeSchedule(cron: string) {
  const detected = detectSchedulePreset(cron);
  const { config, preset } = detected;

  switch (preset) {
    case "hourly":
      return `Every hour at minute ${String(config.minute).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${formatTime(config.hour, config.minute)}`;
    case "weekly":
      return `Every ${weekdayLabels[config.dayOfWeek] ?? "Monday"} at ${formatTime(config.hour, config.minute)}`;
    case "monthly":
      return `Every month on day ${config.dayOfMonth} at ${formatTime(config.hour, config.minute)}`;
    default:
      return `Custom cron: ${cron}`;
  }
}
