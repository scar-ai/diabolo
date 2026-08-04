import "@tanstack/react-start/server-only";
import { DaytonaNotFoundError, Image, type Daytona } from "@daytona/sdk";

import { env } from "@/env/server";
import { Log } from "@/lib/log";
import { AGENT_BROWSER_VERSION, OPENCODE_VERSION } from "@/lib/opencode/constants";
import { DEFAULT_SANDBOX_TIER_ID, normalizeSandboxTierId } from "@/lib/sandbox/tiers";

const log = Log.create({ ns: "daytona.snapshot" });

// Must match `scripts/daytona-snapshot.mjs`, which is what actually builds it.
const SNAPSHOT_VERSION = "v5";
const DEFAULT_BASE_IMAGE = "node:22-bookworm";
const SNAPSHOT_NAME_PREFIX = `diabolo-opencode-browser-${SNAPSHOT_VERSION}`;

/**
 * One snapshot per sandbox tier: Daytona bakes the resource allocation into the
 * snapshot, so the tier is what picks the snapshot. `DAYTONA_BROWSER_SNAPSHOT`
 * overrides the shared prefix, not the full name.
 */
export const getBrowserSnapshotName = (tierId: unknown = DEFAULT_SANDBOX_TIER_ID) =>
  `${env.DAYTONA_BROWSER_SNAPSHOT?.trim() || SNAPSHOT_NAME_PREFIX}-${normalizeSandboxTierId(tierId)}`;

export const getBrowserSnapshotBaseImage = () =>
  env.DAYTONA_DEFAULT_IMAGE?.trim() || env.DAYTONA_BROWSER_BASE_IMAGE?.trim() || DEFAULT_BASE_IMAGE;

export const createBrowserSnapshotImage = () =>
  Image.base(getBrowserSnapshotBaseImage())
    .runCommands(
      "apt-get update",
      [
        "bash",
        "-lc",
        "export DEBIAN_FRONTEND=noninteractive && apt-get install -y git curl ca-certificates sudo python3 build-essential chromium",
      ],
      "rm -rf /var/lib/apt/lists/*",
      "corepack enable",
      "corepack prepare pnpm@10.33.0 --activate",
      `npm install -g opencode-ai@${OPENCODE_VERSION} @opencode-ai/plugin@${OPENCODE_VERSION} agent-browser@${AGENT_BROWSER_VERSION} zod`,
      [
        "bash",
        "-lc",
        'if command -v chromium >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then ln -sf "$(command -v chromium)" /usr/local/bin/google-chrome; fi',
      ],
      "node --version",
      "npm --version",
      "pnpm --version",
      "opencode --version",
      "agent-browser --version",
      [
        "bash",
        "-lc",
        "agent-browser open about:blank --json && agent-browser get url --json && agent-browser close --json",
      ],
      "mkdir -p /home/daytona/.config/opencode/tools /root/.config/opencode/tools",
    )
    .env({
      PATH: "/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin",
    });

const isBuildingState = (state: string | null | undefined) => {
  const normalized = state?.toLowerCase() || "";
  return (
    normalized === "building" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "creating"
  );
};

export const getRequiredBrowserSnapshot = async (daytona: Daytona, tierId?: unknown) => {
  const snapshotName = getBrowserSnapshotName(tierId);
  let snapshot = await daytona.snapshot.get(snapshotName);

  if (isBuildingState(snapshot.state)) {
    throw new Error(
      `Daytona browser snapshot "${snapshotName}" is still ${snapshot.state}. Finish building it with \`pnpm daytona:snapshot\` and try again.`,
    );
  }

  if (snapshot.state?.toLowerCase() !== "active") {
    log.debug("activating snapshot", { snapshotName, state: snapshot.state });
    snapshot = await daytona.snapshot.activate(snapshot);

    if (snapshot.state?.toLowerCase() !== "active") {
      throw new Error(
        `Daytona browser snapshot "${snapshotName}" is not active. Current state: ${snapshot.state ?? "unknown"}.`,
      );
    }
  }

  return snapshotName;
};

export const formatMissingBrowserSnapshotError = (error: unknown, tierId?: unknown) => {
  if (error instanceof DaytonaNotFoundError) {
    return `Daytona browser snapshot "${getBrowserSnapshotName(tierId)}" does not exist. Build it first with \`pnpm daytona:snapshot\`.`;
  }

  return error instanceof Error ? error.message : String(error);
};
