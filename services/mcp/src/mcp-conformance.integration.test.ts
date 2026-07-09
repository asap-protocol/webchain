import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  bootstrapMcpStack,
  type McpIntegrationStack,
} from "@webchain/mcp/test-support/bootstrap-mcp-stack";
import { parseToolJson } from "@webchain/mcp/test-support/mcp-client-helpers";
import {
  CompanionCommandSuccessSchema,
  McpToolErrorEnvelopeSchema,
  SessionCreatedResponseSchema,
  SessionLifecycleEventSchema,
  SnapshotResultSchema,
} from "@webchain/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("MCP stdio conformance (real companion + Chromium)", () => {
  let stack: McpIntegrationStack;
  let client: Client;

  beforeAll(async () => {
    stack = await bootstrapMcpStack({
      token: "mcp-conformance-token",
      clientName: "webchain-mcp-conformance",
    });
    client = stack.client;
  });

  afterAll(async () => {
    await stack.shutdown();
  });

  it("returns structured INVALID_TOOL_INPUT for bad navigate MCP args", async () => {
    const created = await client.callTool({
      name: "create_session",
      arguments: {},
    });
    const session = SessionCreatedResponseSchema.parse(parseToolJson(created));

    const failed = await client.callTool({
      name: "navigate",
      arguments: {
        sessionId: session.sessionId,
        url: "not-an-absolute-url",
      },
    });
    expect(failed.isError).toBe(true);
    const envelope = McpToolErrorEnvelopeSchema.parse(parseToolJson(failed));
    expect(envelope.code).toBe("INVALID_TOOL_INPUT");
    expect(envelope.lifecycle?.code).toBe("INVALID_TOOL_INPUT");
    expect(envelope.lifecycle?.kind).toBe("command_error");

    await client.callTool({
      name: "close_session",
      arguments: { sessionId: session.sessionId },
    });
  });

  it("lists tools and runs create_session → navigate → snapshot → type → click → close_session", async () => {
    const { tools } = await client.listTools();
    const names = tools?.map((t) => t.name).sort() ?? [];
    expect(names).toEqual([
      "click",
      "close_session",
      "create_session",
      "navigate",
      "snapshot",
      "type",
    ]);

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

    const html =
      '<!DOCTYPE html><html><body><input id="t" type="text" /><p id="p">x</p></body></html>';
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

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
    expect(snapResult.htmlSnippet.length).toBeGreaterThan(0);
    expect(
      snapResult.traceId?.length ?? snapEnvelope.trace.traceId.length,
    ).toBeGreaterThan(0);
    // data: URLs may omit an accessibility tree in some Chromium builds; require html + correlation + layered hint.
    expect(
      snapResult.accessibilityTree != null ||
        (snapResult.domSummary != null && snapResult.domSummary.length > 0),
    ).toBe(true);

    const typed = await client.callTool({
      name: "type",
      arguments: {
        sessionId: session.sessionId,
        selector: "#t",
        text: "hello",
      },
    });
    expect(typed.isError).not.toBe(true);
    CompanionCommandSuccessSchema.parse(parseToolJson(typed));

    const clicked = await client.callTool({
      name: "click",
      arguments: { sessionId: session.sessionId, selector: "#p" },
    });
    expect(clicked.isError).not.toBe(true);
    CompanionCommandSuccessSchema.parse(parseToolJson(clicked));

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
