---
name: diabolo-daytona-opencode
description: Prefer the repository's Daytona sandbox and OpenCode workflow when working in the diabolo codebase. Use for repo tasks that touch sandbox execution, browser automation, agent runtime setup, OpenCode configuration, Daytona snapshots, environment bootstrapping, or any change where aligning with diabolo's existing sandbox-first architecture matters.
---

# Diabolo Daytona OpenCode

Treat Daytona and OpenCode as first-class architecture in this repo, not as optional side tooling. Reuse the project's existing sandbox and agent-runtime patterns before inventing local-only workflows.

## Default posture

- Start by checking the repo's existing sandbox and OpenCode integration points before designing changes.
- Prefer extending current Daytona and OpenCode flows over adding parallel execution paths.
- Read [`references/repo-map.md`](references/repo-map.md) first for repo-specific entry points.
- Read [`references/daytona-docs.md`](references/daytona-docs.md) when changing sandbox lifecycle, snapshots, or Daytona SDK behavior.
- Read [`references/opencode-docs.md`](references/opencode-docs.md) when changing OpenCode config, permissions, tools, prompts, or runtime behavior.

## Working rules

- Keep sandbox behavior consistent with the existing Daytona provider and snapshot flow.
- Keep OpenCode behavior consistent with the existing generated config and tool-setup commands.
- Prefer the repo's existing browser-enabled snapshot flow for frontend and browser-validation work.
- When you add or modify setup logic, preserve the separation between:
  - sandbox creation and lifecycle
  - snapshot/image preparation
  - OpenCode config generation
  - browser tool installation/setup
- When you explain or justify a change, tie it back to both:
  - the local implementation in this repo
  - the relevant Daytona or OpenCode docs

## Quick workflow

1. Read [`references/repo-map.md`](references/repo-map.md).
2. Identify whether the task is primarily Daytona, OpenCode, or both.
3. Open the matching reference doc(s).
4. Inspect the referenced source files before editing.
5. Validate with the lightest relevant check. Prefer `pnpm lint` for code changes unless the task specifically needs a build or runtime verification.

## Typical triggers

- "Fix sandbox creation"
- "Update the browser snapshot"
- "Change the OpenCode model or permissions"
- "Add a new agent tool inside the sandbox"
- "Debug Daytona env/config issues"
- "Adjust how diabolo runs coding agents"
