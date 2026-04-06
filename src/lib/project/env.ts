export type ProjectEnvEntry = {
  key: string;
  value: string;
};

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOTENV_UNQUOTED_VALUE_PATTERN = /^[A-Za-z0-9_./:@%+=,-]*$/;

const stripWrappingQuotes = (value: string) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

export const isValidProjectEnvKey = (value: string) => ENV_KEY_PATTERN.test(value);

export const normalizeProjectEnvEntries = (entries: ProjectEnvEntry[]) => {
  const deduped = new Map<string, string>();

  for (const entry of entries) {
    const key = entry.key.trim();

    if (!key) {
      continue;
    }

    if (!isValidProjectEnvKey(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }

    deduped.set(key, entry.value);
  }

  return Array.from(deduped.entries()).map(([key, value]) => ({
    key,
    value,
  }));
};

export const parseDotEnvText = (value: string): ProjectEnvEntry[] => {
  const entries: ProjectEnvEntry[] = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const lineWithoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = lineWithoutExport.indexOf("=");

    if (separatorIndex <= 0) {
      throw new Error(`Invalid .env line: ${rawLine}`);
    }

    const key = lineWithoutExport.slice(0, separatorIndex).trim();
    const rawValue = lineWithoutExport.slice(separatorIndex + 1).trim();
    const unquotedValue = stripWrappingQuotes(rawValue).replace(/\\n/g, "\n").replace(/\\r/g, "\r");

    entries.push({
      key,
      value: unquotedValue,
    });
  }

  return normalizeProjectEnvEntries(entries);
};

export const serializeProjectEnvEntries = (entries: ProjectEnvEntry[]) =>
  normalizeProjectEnvEntries(entries).reduce<Record<string, string>>((acc, entry) => {
    acc[entry.key] = entry.value;
    return acc;
  }, {});

const formatProjectEnvValueForDotEnv = (value: string) => {
  if (!value) {
    return "";
  }

  if (DOTENV_UNQUOTED_VALUE_PATTERN.test(value)) {
    return value;
  }

  return JSON.stringify(value);
};

export const formatProjectEnvEntriesForDotEnv = (entries: ProjectEnvEntry[]) =>
  normalizeProjectEnvEntries(entries)
    .map((entry) => `${entry.key}=${formatProjectEnvValueForDotEnv(entry.value)}`)
    .join("\n");

export const formatProjectEnvVarsForDotEnv = (envVars: Record<string, string>) =>
  formatProjectEnvEntriesForDotEnv(
    Object.entries(envVars).map(([key, value]) => ({
      key,
      value,
    })),
  );

export const parseStoredProjectEnvEntries = (
  value: string | null | undefined,
): ProjectEnvEntry[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeProjectEnvEntries(
      parsed.flatMap((entry) =>
        typeof entry?.key === "string" && typeof entry?.value === "string"
          ? [{ key: entry.key, value: entry.value }]
          : [],
      ),
    );
  } catch {
    return [];
  }
};
