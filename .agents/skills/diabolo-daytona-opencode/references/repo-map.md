# Repo Map

Use this file first. It maps Daytona and OpenCode concepts onto the diabolo codebase.

## Core files

- `scripts/daytona-snapshot.mjs`
  Builds or activates the browser-ready Daytona snapshot used by the app. Installs `opencode-ai`, `@opencode-ai/plugin`, `agent-browser`, and `zod`.
- `src/lib/daytona/snapshot.ts`
  App-side snapshot naming, base-image selection, snapshot activation, and missing-snapshot errors.
- `src/lib/daytona/client.ts`
  Daytona client creation and Daytona-specific error formatting.
- `src/lib/sandbox/daytona-provider.ts`
  Sandbox provider implementation. Creates sandboxes from a snapshot, sets `autoStopInterval: 30`, and uses `CodeLanguage.TYPESCRIPT`.
- `src/lib/sandbox/workspace.ts`
  Clones the repository into the sandbox, prepares git identity, and runs OpenCode setup commands.
- `src/lib/sandbox/opencode.ts`
  OpenCode install check, generated config handoff, runtime prompt construction, and `opencode run` command assembly.
- `src/lib/opencode/config.ts`
  OpenCode model normalization and generated `opencode` config content. Codex uses OpenCode's native `openai` provider; API-key providers use generated custom-provider config.
- `src/lib/opencode/agent-browser.ts`
  Browser tool setup injected into OpenCode when browser capabilities are enabled.
- `src/lib/opencode/spawn-task.ts`
  Spawn-task tool setup for nested task creation from inside OpenCode.
- `src/lib/sandbox/index.ts`
  Sandbox orchestration entry point and task classification, including frontend/browser heuristics.

## Environment and commands

- `.env.example`
  Check the expected Daytona and OpenCode/OpenRouter environment variables before changing setup code.
- `package.json`
  `pnpm daytona:snapshot` is the repo entry point for preparing the browser snapshot.
- `README.md`
  High-level architecture statement: Daytona powers isolated execution and OpenCode powers agent behavior inside the sandbox.

## Existing repo assumptions

- The browser-ready snapshot is named `diabolo-opencode-browser-v2` unless overridden by `DAYTONA_BROWSER_SNAPSHOT`.
- The default base image is `node:22-bookworm` unless overridden by `DAYTONA_DEFAULT_IMAGE` or `DAYTONA_BROWSER_BASE_IMAGE`.
- Sandbox creation depends on an active Daytona snapshot, not an ad-hoc image build during task startup.
- OpenCode is executed non-interactively with a generated config file and model selection passed in at runtime.
- Codex login runs through OpenCode's built-in headless OAuth provider flow in a short-lived Daytona sandbox. OpenCode's native `auth.json` is persisted per user and injected into task sandboxes.
- Browser tooling is expected to live inside the Daytona sandbox, not on the host machine.

## Practical guidance

- If a task mentions screenshots, browser automation, localhost inspection, or UI validation, inspect the browser-tool setup path before changing prompts or runtime behavior.
- If a task mentions snapshot failures, image pulls, missing tools, or sandbox startup issues, inspect both `scripts/daytona-snapshot.mjs` and `src/lib/daytona/snapshot.ts`.
- If a task mentions models, permissions, or tool availability inside OpenCode, inspect `src/lib/opencode/config.ts` and `src/lib/sandbox/opencode.ts`.
