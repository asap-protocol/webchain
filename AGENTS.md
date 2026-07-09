# AGENTS.md

Context and instructions for AI coding agents working on **Webchain**. This file follows the idea of [AGENTS.md](https://github.com/agentsmd/agents.md): a single, predictable place for project guidance (complementing `README.md` and Cursor rules under `.cursor/rules`).

## Product documentation (`product/`)

Strategic and product context lives here—not application source code.

| Path | Purpose |
| --- | --- |
| `product/strategy/FOUNDATION.md` | Canonical long-form product/architecture context: runtime-first positioning, MCP vs ASAP, monorepo boundaries, MVP roadmap, risks. **Read this before large design changes.** |
| `product/ADRs/` | Architecture Decision Records (`0001`–`0006`, etc.); see `product/ADRs/README.md`. |
| `product/specs/` | Product requirements documents (PRDs). Create new PRDs here as `prd-<feature-name>.md` when using `.cursor/commands/create-prd.md`. |
| `product/README.md` | Index of `product/` (foundation, ADRs, specs). |
| `product/specs/prd-phase-0-foundation-alignment.md` | Phase 0 PRD — foundation/hardening scope. |
| `product/specs/prd-phase-1-local-browser-loop.md` | Phase 1 PRD — prove local browser loop (launch, integration test, extension handshake). |
| `product/specs/prd-phase-2-mcp-native-surface.md` | Phase 2 PRD — MCP parity, conformance, ADR-0001/0002, framework smoke tests. |
| `engineering/tasks/tasks-prd-phase-1-local-browser-loop.md` | Task list for Phase 1. |
| `engineering/tasks/tasks-prd-phase-2-mcp-native-surface.md` | Task list for Phase 2. |

## Engineering workflow (`engineering/`)

Execution planning and templates—not runtime services (those live under `services/` and `apps/`).

| Path | Purpose |
| --- | --- |
| `engineering/tasks/` | Task lists derived from PRDs (e.g. `tasks-prd-<feature-name>.md`). Generate with `.cursor/commands/generate-tasks.md`. |
| `engineering/templates/task-template.md` | Skeleton for structured task lists. |

## Monorepo layout (code)

- `apps/control-plane` — Next.js operator UI (Vercel-oriented).
- `apps/extension` — WXT browser extension.
- `services/companion` — Fastify local daemon; session authority toward the runtime.
- `services/mcp` — MCP stdio server for agent frameworks.
- `packages/protocol` — Shared Zod schemas and command/result contracts.
- `packages/runtime` — Playwright-first browser execution.
- `packages/adapters/asap` — ASAP / browser-gateway mapping.

Workspace packages are declared in `pnpm-workspace.yaml`.

## Dev environment

- **Package manager:** `pnpm` (see root `package.json` `packageManager` field). Commit **`pnpm-lock.yaml`**.
- **Install:** `pnpm install`
- **Node:** `>=22` (see root `package.json` `engines`).
- **Playwright browsers (once):** `pnpm --filter @webchain/runtime exec playwright install chromium` — full Phase 1 context, CI plan, and PRD link: root [`README.md`](README.md) § *Browser / integration (Phase 1)*.
- **Env:** Copy `.env.example` → `.env` for local secrets; never commit real credentials.

### Common scripts (repository root)

- `pnpm dev` — Turbo dev across packages (or use filtered dev below).
- `pnpm dev:web` — Control plane (`@webchain/control-plane`).
- `pnpm dev:companion` — Companion (`@webchain/companion`).
- `pnpm dev:extension` — Extension (`@webchain/extension`).
- `pnpm dev:mcp` — MCP server (`@webchain/mcp`).

To run a script in one package: `pnpm --filter <package-name> <script>` (read each package’s `package.json` `name` field for the exact scope).

## Testing and quality

Before opening a PR or handing work off:

1. `pnpm lint` — Biome (`biome check .`).
2. `pnpm typecheck` — Turborepo `turbo typecheck`.
3. `pnpm test` — Turborepo `turbo test` (Vitest in packages that define tests).
4. `pnpm test:coverage` — Turborepo `turbo test:coverage` (line coverage thresholds per FR11).
5. `pnpm test:integration` — companion local browser loop **and** MCP stdio conformance (requires Playwright Chromium installed; see root `README.md`).
6. `pnpm test:mcp-conformance` — MCP integration tests only (subset of step 5).
7. `pnpm test:integrations` — framework smoke examples under `examples/integrations` (deterministic MCP stdio harness).

Fix failures until green. Add or update tests when changing behavior in `packages/protocol`, `packages/runtime`, or HTTP/MCP surfaces.

**CI:** On push to `main` and on pull requests, GitHub Actions runs `pnpm lint`, `typecheck`, `test`, `test:coverage`, `test:integration` (Playwright Chromium + companion loop + MCP conformance), `test:integrations`, and `build` on `ubuntu-latest` with Node 22 — see `.github/workflows/ci.yml`.

## Architecture guardrails

- **Runtime-first:** Prefer changes that strengthen the local browser loop and contracts in `packages/protocol` / `packages/runtime` over control-plane polish unless the PRD says otherwise.
- **Hosted control, local execution:** Do not assume long-lived browser sessions inside serverless hosts; companion/MCP own local execution.
- **Validation:** Use **Zod** at TypeScript trust boundaries (HTTP, MCP tool inputs, shared types)—see `.cursor/rules/security-standards.mdc`.

## PRs and commits

- Prefer [**Conventional Commits**](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.); details in `.cursor/rules/git-commits.mdc`.
- Keep changes focused; split large refactors when possible.

## Cursor-specific assets

- **Rules:** `.cursor/rules/` (architecture, security, frontend control plane, testing).
- **Commands:** `.cursor/commands/` (PRD and task generation).
- **Skills:** `.cursor/skills/` (optional deep workflows).

When instructions conflict, canonical product intent wins: `product/strategy/FOUNDATION.md` and recorded ADRs under `product/ADRs/`.
