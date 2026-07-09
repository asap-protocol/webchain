# Webchain

**Runtime-first browser layer for agents:** Playwright sessions, HTTP companion, MCP tools—execution stays local or on dedicated hosts, not inside serverless functions.

## Stack (monorepo)

| Path | Role |
| --- | --- |
| `packages/runtime` | Playwright sessions |
| `services/companion` | HTTP API + token (`/health`, `/sessions`, `/commands`) |
| `services/mcp` | MCP stdio → delegates to companion |
| `apps/control-plane` | Next.js operator UI |
| `apps/extension` | WXT Chromium extension |
| `packages/protocol` | Zod contracts + traces |
| `packages/adapters/asap` | ASAP-oriented mapping |
| [`examples/integrations`](examples/integrations) | MCP smoke harness (stub LLM); doc paths for Agents SDK + LangGraph. Run **`pnpm test:integrations`**. |

Repo conventions for contributors and coding agents: [`AGENTS.md`](AGENTS.md).

## Requirements

- **Node** ≥ 22 (`package.json` → `engines`)
- **pnpm** — version in root `packageManager`; use [Corepack](https://nodejs.org/api/corepack.html) (`corepack enable`)

## Setup

1. `cp .env.example .env` and fill tokens/URLs as needed.
2. `pnpm install` (repo root).
3. **Chromium (once):** `pnpm --filter @webchain/runtime exec playwright install chromium`
4. **Dev:** `pnpm dev:companion` → optional `pnpm dev:web`, `pnpm dev:extension`, `pnpm dev:mcp` (MCP needs companion up).

**MCP env:** `WEBCHAIN_COMPANION_ORIGIN` (default `http://127.0.0.1:8787`), `WEBCHAIN_LOCAL_TOKEN` — must match companion. Details: [`services/mcp/README.md`](services/mcp/README.md), [`examples/integrations/README.md`](examples/integrations/README.md).

**Control plane → companion:** `NEXT_PUBLIC_COMPANION_URL`, `WEBCHAIN_LOCAL_TOKEN` / `NEXT_PUBLIC_WEBCHAIN_LOCAL_TOKEN` — see `.env.example`. Use **Ping companion** in the UI when both are running.

**Companion HTTP:** `GET /health` (no token); `POST /sessions` and `POST /commands` with `x-webchain-token`. Success bodies may carry optional **`lifecycle`** events; errors include JSON **`error`**, **`trace`**, optional **`code`**, optional **`lifecycle`**. CORS allows `localhost` / `127.0.0.1` dev origins.

### MCP integrations (Phase 2)

**Troubleshooting:** MCP exits immediately when **`GET /health`** fails against **`WEBCHAIN_COMPANION_ORIGIN`**. Run **`pnpm dev:companion`**, then reconcile **`WEBCHAIN_LOCAL_TOKEN`** with [`services/mcp/README.md`](services/mcp/README.md).

## Checks (match CI)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm test:integration && pnpm test:integrations && pnpm build
```

- **Integration tests** need Chromium installed; they run companion + MCP conformance (`pnpm test:mcp-conformance` for MCP only).
- **`pnpm test:integrations`** runs [examples/integrations](examples/integrations) smoke tests (deterministic MCP stdio harness; documented stand-in for Agents SDK / LangGraph LLM stubs in Phase 2).
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — Ubuntu, Node 22, same steps as above.

## Deployment note

Control plane targets Vercel; **companion** and **MCP** run as local or dedicated Node processes—do not run long-lived browsers in serverless functions.
