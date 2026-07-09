# Webchain MCP server (`@webchain/mcp`)

Stdio MCP server that exposes the **companion** HTTP API to agent frameworks (ADR-0001: **companion** owns browser sessions; MCP does not embed `BrowserRuntime`).

Tool inputs are validated with the same Zod schemas as [`@webchain/protocol`](../../packages/protocol).

## Prerequisites

1. Run the **companion** locally (`pnpm dev:companion` from the repo root).
2. Align environment variables with the daemon:
   - **`WEBCHAIN_COMPANION_ORIGIN`** — base URL (default `http://127.0.0.1:8787`).
   - **`WEBCHAIN_LOCAL_TOKEN`** — must match the companion’s `WEBCHAIN_LOCAL_TOKEN` (default `change-me-in-local-dev` in local dev).

On startup, MCP calls **`GET /health`**; if the companion is unreachable, the process exits with a short error (start the companion first).

## Tools (exported)

| MCP tool | Companion mapping |
| --- | --- |
| `create_session` | `POST /sessions` |
| `navigate` | `POST /commands` (`action: "navigate"`) |
| `snapshot` | `POST /commands` (`action: "snapshot"`) |
| `click` | `POST /commands` (`action: "click"`) |
| `type` | `POST /commands` (`action: "type"`) |
| `close_session` | `POST /commands` (`action: "closeSession"`) |

Successful **command** tool responses include companion **`{ trace, result }`** (and optional **`lifecycle`** on close). **`create_session`** is different: success is a flat **`SessionCreatedResponse`** (`sessionId`, `pageId`, `createdAt`, `trace`, optional `lifecycle`) — not wrapped in `{ trace, result }`.

Errors return JSON (`McpToolErrorEnvelope`): **`error`** (human-readable message), optional **`code`** (`RuntimeErrorCode`), optional **`trace`**, **`validation`** detail for Zod issues, and optional **`lifecycle`** (`SessionLifecycleEvent`). No secrets belong in payloads.

**Error code boundaries:** **`INVALID_TOOL_INPUT`** is emitted only when MCP validates tool arguments locally (before calling the companion). When the companion rejects a malformed `POST /commands` body, it returns **`INVALID_COMMAND_BODY`** upstream; MCP forwards that code (and companion trace/lifecycle) in the error envelope. MCP-local validation failures generate their own trace/lifecycle at the MCP boundary—they do not correlate with companion upstream traces.

## Capability matrix: MCP vs runtime vs ASAP

| Command / action | `@webchain/protocol` | `BrowserRuntime` | MCP tools | `packages/adapters/asap` |
| --- | --- | --- | --- | --- |
| Create session | `SessionCreatedSchema` | `createSession()` | `create_session` | — |
| Navigate | `navigate` | `navigate()` | `navigate` | Skill `browse_page` |
| Snapshot | `snapshot` | `snapshot()` | `snapshot` | Skills `browse_page`, `capture_artifact` |
| Click | `click` | `click()` | `click` | Skill `perform_flow` |
| Type | `type` | `type()` | `type` | Skill `perform_flow` |
| Close session | `closeSession` | `closeSession()` | `close_session` | Skill `capture_artifact` |

## Run locally

From the repo root:

```bash
pnpm dev:mcp
```

Optional: `WEBCHAIN_HEADLESS=false` is ignored by MCP (headless is controlled by the companion’s runtime).

## Tests

- **Unit:** `pnpm --filter @webchain/mcp test`
- **Integration (stdio + companion + Chromium):** `pnpm --filter @webchain/mcp test:integration` (also available as `pnpm test:mcp-conformance` from the repo root).

### Test support exports (`./test-support/*`)

Subpath exports are **for integration tests only** (MCP conformance, `examples/integrations` smokes). They spin up Chromium, companion, and the MCP stdio process — not for production or agent runtime use.

| Export | Purpose |
| --- | --- |
| `@webchain/mcp/test-support/bootstrap-mcp-stack` | `bootstrapMcpStack()` — headless Chromium, companion on ephemeral port, MCP stdio client |
| `@webchain/mcp/test-support/mcp-client-helpers` | `readToolText()`, `parseToolJson()` — parse MCP `tools/call` text content |

`bootstrapMcpStack({ token?, clientName? })` returns `{ client, app, runtime, shutdown }`. Call `shutdown()` in `afterAll` to close the MCP client, stdio transport, browser, and companion. On connect failure, stderr from the MCP child is included in the thrown error.
