/**
 * Sandbox sizes a task can run on.
 *
 * Daytona bakes CPU/memory/disk into the snapshot — `daytona.create` only
 * accepts `resources` for image-based sandboxes — so every size needs its own
 * snapshot. `scripts/daytona-snapshot.mjs` builds one per entry here and must
 * be kept in sync with this list.
 */

export const SANDBOX_TIER_IDS = [
  "diabolobox-v1",
  "diabolobox-v2",
  "diabolobox-v3",
  "diabolobox-max",
] as const;

export type SandboxTierId = (typeof SANDBOX_TIER_IDS)[number];

export type SandboxTier = {
  /** Disk in GiB. */
  disk: number;
  id: SandboxTierId;
  label: string;
  /** Memory in GiB. */
  memory: number;
  summary: string;
  /** Virtual CPUs. */
  vcpu: number;
};

export const SANDBOX_TIERS: Record<SandboxTierId, SandboxTier> = {
  "diabolobox-v1": {
    disk: 3,
    id: "diabolobox-v1",
    label: "Diabolobox v1",
    memory: 1,
    summary: "1 GB RAM · 1 vCPU · 3 GB disk",
    vcpu: 1,
  },
  "diabolobox-v2": {
    disk: 10,
    id: "diabolobox-v2",
    label: "Diabolobox v2",
    memory: 2,
    summary: "2 GB RAM · 2 vCPU · 10 GB disk",
    vcpu: 2,
  },
  "diabolobox-v3": {
    disk: 10,
    id: "diabolobox-v3",
    label: "Diabolobox v3",
    memory: 4,
    summary: "4 GB RAM · 4 vCPU · 10 GB disk",
    vcpu: 4,
  },
  "diabolobox-max": {
    disk: 20,
    id: "diabolobox-max",
    label: "Diabolobox Max",
    memory: 8,
    summary: "8 GB RAM · 8 vCPU · 20 GB disk",
    vcpu: 8,
  },
};

export const SANDBOX_TIER_LIST = SANDBOX_TIER_IDS.map((id) => SANDBOX_TIERS[id]);

/**
 * v1 (1 GiB) is not enough for the OpenCode server, which gets OOM-killed
 * shortly after start, so the default stays at v2.
 */
export const DEFAULT_SANDBOX_TIER_ID: SandboxTierId = "diabolobox-v2";

export const isSandboxTierId = (value: unknown): value is SandboxTierId =>
  typeof value === "string" && SANDBOX_TIER_IDS.includes(value as SandboxTierId);

export const normalizeSandboxTierId = (value: unknown): SandboxTierId =>
  isSandboxTierId(value) ? value : DEFAULT_SANDBOX_TIER_ID;

export const getSandboxTier = (value: unknown): SandboxTier =>
  SANDBOX_TIERS[normalizeSandboxTierId(value)];
