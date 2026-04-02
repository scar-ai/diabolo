export type ProjectSkillEntry = {
  installSpec: string;
  name: string;
  source: string;
  url: string;
};

const isProjectSkillEntry = (value: unknown): value is ProjectSkillEntry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return [candidate.installSpec, candidate.name, candidate.source, candidate.url].every(
    (field) => typeof field === "string" && field.trim().length > 0,
  );
};

export const normalizeProjectSkills = (skills: ProjectSkillEntry[]) => {
  const seen = new Set<string>();

  return skills.reduce<ProjectSkillEntry[]>((acc, skill) => {
    const normalized = {
      installSpec: skill.installSpec.trim(),
      name: skill.name.trim(),
      source: skill.source.trim(),
      url: skill.url.trim(),
    };

    if (
      !normalized.installSpec ||
      !normalized.name ||
      !normalized.source ||
      !normalized.url ||
      seen.has(normalized.installSpec)
    ) {
      return acc;
    }

    seen.add(normalized.installSpec);
    acc.push(normalized);
    return acc;
  }, []);
};

export const parseStoredProjectSkills = (value: string | null | undefined): ProjectSkillEntry[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeProjectSkills(parsed.filter(isProjectSkillEntry)) : [];
  } catch {
    return [];
  }
};
