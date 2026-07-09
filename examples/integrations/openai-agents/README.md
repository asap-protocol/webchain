# OpenAI Agents SDK (smoke / integration notes)

**Default CI posture:** the OpenAI Agents SDK case in **`../framework-smokes.integration.test.ts`** (`describe.each`) mimics the MCP tool wiring Agents SDK integrations would expose, without invoking a billed LLM router.

On a developer machine,

`pnpm dev:companion` → run **`pnpm test:integrations`** (or **`pnpm --filter @examples/webchain-agent-smokes test:smoke-only`**) → point your Agents host at **`pnpm --filter @webchain/mcp start`** with companion-aligned env vars documented in [`services/mcp/README.md`](../../../services/mcp/README.md).

**Optional live path:** upstream Agents SDK MCP connectors may send traffic to OpenAI-hosted models—prefer environment variables mirrored from `.env.example` placeholders and never commit real keys.

### Product traceability

[`product/specs/prd-phase-2-mcp-native-surface.md`](../../../product/specs/prd-phase-2-mcp-native-surface.md)
