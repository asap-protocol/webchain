# LangGraph (smoke / integration notes)

LangGraph integrations typically wrap MCP transports via tool-call nodes.

The LangGraph case lives beside the Agents SDK stub in **`../framework-smokes.integration.test.ts`** (`describe.each`).

**Smoke command (`pnpm test:integrations`):**

```bash
pnpm --filter @examples/webchain-agent-smokes test:smoke-only
```

This shares the MCP stdio launcher + Chromium expectations described in [`../openai-agents/README.md`](../openai-agents/README.md).

### Product traceability

[`product/specs/prd-phase-2-mcp-native-surface.md`](../../../product/specs/prd-phase-2-mcp-native-surface.md)
