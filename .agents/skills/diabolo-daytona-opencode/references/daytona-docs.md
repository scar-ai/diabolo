# Daytona Docs

Official docs root: <https://www.daytona.io/docs/en/>

Use this reference when changing sandbox lifecycle, snapshot creation, SDK usage, or Daytona environment behavior in diabolo.

## Docs to open

- Overview: <https://www.daytona.io/docs/en/>
- Snapshots: <https://www.daytona.io/docs/en/snapshots/>
- TypeScript SDK: <https://www.daytona.io/docs/en/typescript-sdk/daytona/>

## Relevant points for this repo

- Daytona supports creating sandboxes programmatically through the SDK and from snapshots. That matches diabolo's current design: create a reusable browser-ready snapshot, then create sandboxes from it.
- Snapshot states matter. `active` snapshots can be used for sandbox creation; `inactive` snapshots must be re-activated first.
- Snapshot base images should use explicit tags or digests. Daytona's docs explicitly discourage mutable tags such as `latest`, `stable`, or `lts`.
- Daytona documents default sandbox resources for snapshot-backed sandboxes as 1 vCPU, 1 GiB memory, and 3 GiB storage unless overridden.
- The TypeScript SDK documents `apiUrl` defaulting to `https://app.daytona.io/api` if not otherwise configured. Diabolo passes `apiUrl` and `target` through env vars when present.

## How that maps to diabolo

- `scripts/daytona-snapshot.mjs` and `src/lib/daytona/snapshot.ts` already implement the snapshot-first pattern. Preserve that bias.
- `src/lib/sandbox/daytona-provider.ts` intentionally creates workspaces from a snapshot instead of baking tools at task start.
- If you need more tools in the sandbox, prefer changing the snapshot image build once instead of re-installing tools on every task.
- If you change snapshot naming or activation behavior, keep the script and app-side helper in sync.

## Design bias

- Prefer reproducible snapshots over imperative per-task bootstrap.
- Prefer explicit image tags over floating tags.
- Treat snapshot readiness and activation as part of the normal control flow, not as exceptional edge cases.
