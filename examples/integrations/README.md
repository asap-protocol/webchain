# Example agent integrations

Phase 2 documents **deterministic MCP smoke suites** beside the MCP conformance Vitest targets under `services/mcp`:

| Command | Purpose |
| --- | --- |
| `pnpm test:integration` | Companion browser loop plus MCP stdio conformance (authoritative CI gate once Chromium is installed). |
| `pnpm test:mcp-conformance` | Alias for the MCP integration target only (`@webchain/mcp`). |
| **`pnpm test:integrations`** | This workspace (**`@examples/webchain-agent-smokes`**) — `framework-smokes.integration.test.ts` runs stub-LLM scenarios (OpenAI Agents SDK + LangGraph via `describe.each`) against the same companion relay real framework nodes would use. |

Run the examples package from the repo root after installing Chromium (`README.md` prerequisites):

```bash
pnpm --filter @examples/webchain-agent-smokes test:smoke-only
```

Or from the repo root: **`pnpm test:integrations`** (same command).

(`pnpm exec` invokes the MCP stdio harness from **`services/mcp`**; no OpenAI billing or outbound LLM requests are involved.)

## OpenAI Agents SDK

See [`openai-agents/README.md`](openai-agents/README.md).

## LangGraph

See [`langgraph/README.md`](langgraph/README.md).

## Environment

Reuse the MCP defaults from [`services/mcp/README.md`](../../services/mcp/README.md): **`WEBCHAIN_COMPANION_ORIGIN`**, **`WEBCHAIN_LOCAL_TOKEN`**, and a companion reachable via **`pnpm dev:companion`** before MCP-driven smoke runs attempt `GET /health`.
