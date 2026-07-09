import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { bootstrapMcpStack } from "@webchain/mcp/test-support/bootstrap-mcp-stack";
import { parseToolJson } from "@webchain/mcp/test-support/mcp-client-helpers";
import {
  CompanionCommandSuccessSchema,
  SessionCreatedResponseSchema,
  SessionLifecycleEventSchema,
  SnapshotResultSchema,
} from "@webchain/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const frameworkSmokes = [
  {
    label: "OpenAI Agents SDK",
    clientName: "examples-openai-agents-doc-smoke",
    marker: "Agents SDK stubs use this MCP stdio relay",
    html: '<!DOCTYPE html><html><body><main id="m">Agents SDK stubs use this MCP stdio relay</main></body></html>',
    testName:
      "minimal session loop (create_session → navigate → snapshot → close_session)",
  },
  {
    label: "LangGraph",
    clientName: "examples-langgraph-doc-smoke",
    marker: "LangGraph stubs call the same MCP stdio relay",
    html: '<!DOCTYPE html><html><body><section id="g">LangGraph stubs call the same MCP stdio relay</section></body></html>',
    testName:
      "minimal session loop wired like a LangGraph tool node calling MCP tools",
  },
] as const;

describe.each(frameworkSmokes)("$label smoke (stub: MCP SDK client)", ({
  clientName,
  html,
  marker,
  testName,
}) => {
  let client: Client;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const stack = await bootstrapMcpStack({ clientName });
    client = stack.client;
    teardown = stack.shutdown;
  });

  afterAll(async () => {
    await teardown();
  });

  it(testName, async () => {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    const created = await client.callTool({
      name: "create_session",
      arguments: {},
    });
    expect(created.isError).not.toBe(true);
    const session = SessionCreatedResponseSchema.parse(parseToolJson(created));
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.trace.traceId.length).toBeGreaterThan(0);
    const createdLifecycle = SessionLifecycleEventSchema.parse(
      session.lifecycle,
    );
    expect(createdLifecycle.kind).toBe("session_created");
    expect(createdLifecycle.sessionId).toBe(session.sessionId);

    const nav = await client.callTool({
      name: "navigate",
      arguments: { sessionId: session.sessionId, url: dataUrl },
    });
    expect(nav.isError).not.toBe(true);
    CompanionCommandSuccessSchema.parse(parseToolJson(nav));

    const snap = await client.callTool({
      name: "snapshot",
      arguments: { sessionId: session.sessionId },
    });
    expect(snap.isError).not.toBe(true);
    const snapEnvelope = CompanionCommandSuccessSchema.parse(
      parseToolJson(snap),
    );
    const snapResult = SnapshotResultSchema.parse(snapEnvelope.result);
    expect(snapResult.htmlSnippet).toContain(marker);
    expect(
      snapResult.accessibilityTree != null ||
        (snapResult.domSummary != null && snapResult.domSummary.length > 0),
    ).toBe(true);

    const closed = await client.callTool({
      name: "close_session",
      arguments: { sessionId: session.sessionId },
    });
    expect(closed.isError).not.toBe(true);
    const closedEnvelope = CompanionCommandSuccessSchema.parse(
      parseToolJson(closed),
    );
    const closedLifecycle = SessionLifecycleEventSchema.parse(
      closedEnvelope.lifecycle,
    );
    expect(closedLifecycle.kind).toBe("session_closed");
    expect(closedLifecycle.sessionId).toBe(session.sessionId);
  });
});
