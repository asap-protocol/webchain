import { describe, expect, it } from "vitest";
import {
  ActionResultSchema,
  CloseSessionResultSchema,
  CompanionApiErrorBodySchema,
  CompanionCommandSuccessSchema,
  CompanionHealthSchema,
  CompanionRuntimeErrorBodySchema,
  commandErrorLifecycle,
  createTraceContext,
  isMutationCommand,
  McpToolErrorEnvelopeSchema,
  NavigateArgsSchema,
  NavigateCommandSchema,
  RuntimeCommandSchema,
  RuntimeErrorCodeSchema,
  SessionCreatedResponseSchema,
  SessionCreatedSchema,
  SessionIdArgsSchema,
  SessionLifecycleEventSchema,
  SnapshotResultSchema,
  sessionClosedLifecycle,
  sessionCreatedLifecycle,
} from "./index.js";

describe("RuntimeCommandSchema", () => {
  it("parses a valid navigate command", () => {
    const command = NavigateCommandSchema.parse({
      action: "navigate",
      sessionId: "session-1",
      url: "https://example.com",
    });

    expect(command.url).toBe("https://example.com");
  });

  it("marks mutation commands correctly", () => {
    expect(
      isMutationCommand({
        action: "click",
        sessionId: "session-1",
        selector: "#submit",
      }),
    ).toBe(true);

    expect(
      isMutationCommand({
        action: "snapshot",
        sessionId: "session-1",
      }),
    ).toBe(false);
  });

  it("creates stable trace metadata", () => {
    const trace = createTraceContext();

    expect(trace.traceId).toBeTruthy();
    expect(trace.runId).toBeTruthy();
    expect(trace.createdAt).toContain("T");
  });

  it("parses MCP-aligned navigate args without action discriminant", () => {
    const args = NavigateArgsSchema.parse({
      sessionId: "s1",
      url: "https://example.com",
    });

    expect(args.sessionId).toBe("s1");
    expect(args.url).toBe("https://example.com");
  });

  it("parses session-only args for snapshot and close_session tools", () => {
    const args = SessionIdArgsSchema.parse({ sessionId: "s1" });
    expect(args.sessionId).toBe("s1");
  });

  it("parses close-session results", () => {
    const result = CloseSessionResultSchema.parse({
      sessionId: "s1",
      closed: true,
    });
    expect(result.closed).toBe(true);
  });
});

describe("RuntimeCommandSchema union coverage", () => {
  it("accepts every runtime command shape", () => {
    const samples = [
      {
        action: "navigate" as const,
        sessionId: "s",
        url: "https://example.com",
      },
      { action: "snapshot" as const, sessionId: "s" },
      {
        action: "click" as const,
        sessionId: "s",
        selector: "#a",
      },
      {
        action: "type" as const,
        sessionId: "s",
        selector: "#a",
        text: "x",
      },
      { action: "closeSession" as const, sessionId: "s" },
    ];

    for (const body of samples) {
      const parsed = RuntimeCommandSchema.parse(body);
      expect(parsed.action).toBe(body.action);
    }
  });

  it("rejects invalid commands", () => {
    expect(() =>
      RuntimeCommandSchema.parse({ action: "navigate", sessionId: "" }),
    ).toThrow();
  });
});

describe("runtime error schemas", () => {
  it("parses companion runtime error bodies", () => {
    const body = CompanionRuntimeErrorBodySchema.parse({
      error: "msg",
      code: "SESSION_NOT_FOUND",
    });
    expect(body.code).toBe("SESSION_NOT_FOUND");

    expect(RuntimeErrorCodeSchema.safeParse("invalid").success).toBe(false);
  });

  it("accepts INVALID_COMMAND_BODY and INVALID_TOOL_INPUT as distinct codes", () => {
    expect(RuntimeErrorCodeSchema.parse("INVALID_COMMAND_BODY")).toBe(
      "INVALID_COMMAND_BODY",
    );
    expect(RuntimeErrorCodeSchema.parse("INVALID_TOOL_INPUT")).toBe(
      "INVALID_TOOL_INPUT",
    );
  });

  it("parses companion API error bodies with trace", () => {
    const trace = createTraceContext();
    const parsed = CompanionApiErrorBodySchema.parse({
      error: "x",
      trace,
      code: "COMMAND_FAILED",
    });
    expect(parsed.trace.traceId).toBe(trace.traceId);
  });
});

describe("result and health schemas", () => {
  it("parses snapshot and action results", () => {
    SnapshotResultSchema.parse({
      sessionId: "s",
      url: "https://a.com",
      title: "t",
      htmlSnippet: "<p/>",
      domSummary: "hello",
      accessibilityTree: { role: "root" },
      links: [{ href: "https://a.com/x", text: "x" }],
      landmarks: [{ role: "main" }],
      traceId: "00000000-0000-4000-8000-000000000001",
    });
    ActionResultSchema.parse({
      sessionId: "s",
      url: "https://a.com",
      title: "t",
      traceId: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("parses session created response with trace", () => {
    const trace = createTraceContext();
    SessionCreatedResponseSchema.parse({
      sessionId: "s",
      pageId: "p",
      createdAt: new Date().toISOString(),
      trace,
    });
  });

  it("parses standalone SessionCreated payloads and CompanionHealth", () => {
    SessionCreatedSchema.parse({
      sessionId: "s",
      pageId: "p",
      createdAt: new Date().toISOString(),
    });
    CompanionHealthSchema.parse({
      status: "ok",
      service: "webchain-companion",
      version: "0.1.0",
      capabilities: ["navigate", "snapshot", "click", "type", "closeSession"],
    });
  });

  it("parses MCP and lifecycle envelopes", () => {
    const trace = createTraceContext();
    SessionLifecycleEventSchema.parse({
      kind: "session_closed",
      traceId: trace.traceId,
      sessionId: "s1",
    });
    SessionCreatedResponseSchema.parse({
      sessionId: "s1",
      pageId: "p1",
      createdAt: new Date().toISOString(),
      trace,
      lifecycle: {
        kind: "session_created",
        traceId: trace.traceId,
        sessionId: "s1",
      },
    });
    const err = McpToolErrorEnvelopeSchema.parse({
      error: "oops",
      code: "COMMAND_FAILED",
      trace,
      validation: {},
    });
    expect(err.code).toBe("COMMAND_FAILED");
  });

  it("parses companion command success responses with lifecycle", () => {
    const trace = createTraceContext();
    CompanionCommandSuccessSchema.parse({
      trace,
      result: { foo: 1 },
      lifecycle: SessionLifecycleEventSchema.parse({
        kind: "session_closed",
        traceId: trace.traceId,
        sessionId: "sid",
      }),
    });
  });
});

describe("lifecycle helpers", () => {
  const traceId = "00000000-0000-4000-8000-000000000001";
  const sessionId = "session-abc";

  it("commandErrorLifecycle builds command_error without code", () => {
    const event = commandErrorLifecycle(traceId);
    expect(event).toEqual({
      kind: "command_error",
      traceId,
    });
    expect(SessionLifecycleEventSchema.safeParse(event).success).toBe(true);
  });

  it("commandErrorLifecycle builds command_error with code", () => {
    const event = commandErrorLifecycle(traceId, "INVALID_COMMAND_BODY");
    expect(event).toEqual({
      kind: "command_error",
      traceId,
      code: "INVALID_COMMAND_BODY",
    });
    expect(SessionLifecycleEventSchema.safeParse(event).success).toBe(true);
  });

  it("commandErrorLifecycle includes sessionId when provided", () => {
    const event = commandErrorLifecycle(
      traceId,
      "SESSION_NOT_FOUND",
      sessionId,
    );
    expect(event).toEqual({
      kind: "command_error",
      traceId,
      code: "SESSION_NOT_FOUND",
      sessionId,
    });
    expect(SessionLifecycleEventSchema.safeParse(event).success).toBe(true);
  });

  it("sessionCreatedLifecycle builds session_created", () => {
    const event = sessionCreatedLifecycle(traceId, sessionId);
    expect(event).toEqual({
      kind: "session_created",
      traceId,
      sessionId,
    });
    expect(SessionLifecycleEventSchema.safeParse(event).success).toBe(true);
  });

  it("sessionClosedLifecycle builds session_closed", () => {
    const event = sessionClosedLifecycle(traceId, sessionId);
    expect(event).toEqual({
      kind: "session_closed",
      traceId,
      sessionId,
    });
    expect(SessionLifecycleEventSchema.safeParse(event).success).toBe(true);
  });

  it("rejects invalid traceId in lifecycle helpers", () => {
    expect(() => commandErrorLifecycle("not-a-uuid")).toThrow();
    expect(() => sessionCreatedLifecycle("not-a-uuid", sessionId)).toThrow();
    expect(() => sessionClosedLifecycle(traceId, sessionId)).not.toThrow();
  });
});
