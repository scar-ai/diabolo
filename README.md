# Diabolo

A platform for orchestrating AI agents in isolated, reproducible sandbox environments. Connect a GitHub repo, describe a task, and Diabolo spins up a secure [Daytona](https://www.daytona.io/) sandbox, runs an [OpenCode](https://opencode.ai/) agent inside it, and streams progress back in real time.

## Features

- **Sandboxed execution** — AI agents run in isolated Daytona environments with full filesystem, shell, and Git access
- **Task orchestration** — Parent/child task trees with real-time status streaming via SSE
- **Browser automation** — Agents can open a browser, take screenshots, and verify web output inside the sandbox
- **Project management** — Projects linked to GitHub repos with per-project env vars and skill detection
- **Collaboration** — Project membership, user invitations, and shared task sessions
- **LLM flexibility** — Multiple provider support (OpenRouter, custom endpoints) configured per user
- **Task scheduling** — Cron-based recurring task execution
- **Subscription billing** — Stripe Checkout, customer portal, and webhook-backed plan state

## Tech Stack

| Layer        | Technology                                                          |
| ------------ | ------------------------------------------------------------------- |
| Framework    | [TanStack Start](https://tanstack.com/start) (React 19 + Nitro)     |
| Routing      | TanStack Router (file-based, type-safe)                             |
| Server state | TanStack Query                                                      |
| Styling      | Tailwind CSS v4 + shadcn/ui                                         |
| Database     | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)             |
| Auth         | [Better Auth](https://www.better-auth.com/) (GitHub + Google OAuth) |
| Sandbox      | [Daytona SDK](https://www.daytona.io/)                              |
| AI runtime   | OpenCode with Codex OAuth or OpenAI-compatible API providers        |
| Validation   | Zod + Neverthrow                                                    |
| Tooling      | TypeScript, Vite, Oxlint, Oxfmt                                     |

## Prerequisites

- Node.js 22.12+
- pnpm 10
- PostgreSQL (or Docker)
- Daytona account and API key
- GitHub OAuth app
- A Codex subscription or an OpenAI-compatible API provider

## Setup

**1. Install dependencies**

```bash
pnpm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Key variables to fill in:

```env
VITE_BASE_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/tanstarter

BETTER_AUTH_SECRET=        # generate with: pnpm auth:secret
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

DAYTONA_API_KEY=
DAYTONA_API_URL=
DAYTONA_TARGET=

# Optional paid plans
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
STRIPE_MAX_PRICE_ID=
```

**3. Start the database**

```bash
docker compose up -d   # or start your local PostgreSQL
```

**4. Run migrations**

```bash
pnpm db migrate
```

**5. Build the Daytona snapshot**

```bash
pnpm daytona:snapshot
```

This creates the versioned browser image with OpenCode 1.18.11 and the agent tools used by both
Codex login and task sandboxes.

**6. Start dev server**

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production

Build and start the Nitro Node server with the same environment variables used in development:

```bash
pnpm install --frozen-lockfile
pnpm db migrate
pnpm build
pnpm start
```

Set `VITE_BASE_URL` to the public HTTPS origin. If billing is enabled, register
`https://your-domain.example/api/billing/webhook` in Stripe and subscribe it to Checkout Session
and Customer Subscription events.

## Scripts

| Command                 | Description                                 |
| ----------------------- | ------------------------------------------- |
| `pnpm dev`              | Start dev server                            |
| `pnpm build`            | Production build                            |
| `pnpm start`            | Run production server                       |
| `pnpm daytona:snapshot` | Build the OpenCode 1.18.11 Daytona snapshot |
| `pnpm db:studio`        | Open Drizzle Studio (DB browser)            |
| `pnpm auth:migrate`     | Sync Better Auth schema                     |
| `pnpm check`            | Format + lint                               |
| `pnpm lint`             | Run Oxlint                                  |
| `pnpm format`           | Run Oxfmt                                   |
| `pnpm deps`             | Check for dependency updates                |

## Project Structure

```
src/
├── components/        # UI components (app/, ui/)
├── lib/
│   ├── auth/          # Better Auth setup and hooks
│   ├── billing/       # Stripe billing and subscription state
│   ├── db/            # Drizzle schema
│   ├── project/       # Project domain (data, functions, queries, scheduler)
│   ├── sandbox/       # Daytona orchestration and OpenCode runner
│   ├── opencode/      # Agent tools (git, browser, spawn-task)
│   ├── github/        # GitHub API integration
│   └── org/           # Organization management
└── routes/
    ├── _auth/         # Protected app routes
    ├── _guest/        # Login / signup
    └── api/           # Backend endpoints (auth, tasks, artifacts)
```

## API Endpoints

| Method | Path                                   | Description                       |
| ------ | -------------------------------------- | --------------------------------- |
| `POST` | `/api/tasks/create`                    | Create a task                     |
| `POST` | `/api/tasks/:id/follow-up`             | Queue a follow-up prompt          |
| `POST` | `/api/tasks/:id/attachments`           | Upload file attachments           |
| `GET`  | `/api/tasks/:id/artifacts/:artifactId` | Download a task artifact          |
| `POST` | `/api/opencode/spawn-task`             | Spawn a child task (agent-facing) |
| `POST` | `/api/billing/checkout`                | Start Stripe Checkout             |
| `POST` | `/api/billing/portal`                  | Open the Stripe customer portal   |
| `POST` | `/api/billing/webhook`                 | Process signed Stripe events      |
| `*`    | `/api/auth/*`                          | Better Auth endpoints             |
