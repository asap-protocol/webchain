import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CompanionHttpClient } from "./companion-client.js";
import { CompanionHttpError } from "./companion-client.js";
import { executeMcpToolCall, getMcpToolDefinitions } from "./tool-runtime.js";

const trace = {
  traceId: "00000000-0000-4000-8000-000000000001",
  runId: "00000000-0000-4000-8000-000000000002",
  createdAt: new Date().toISOString(),
};

function mockClient(): CompanionHttpClient {
  return {
    checkHealth: vi.fn(),
    createSession: vi.fn(async () => ({
      sessionId: "sid",
      pageId: "pid",
      createdAt: new Date().toISOString(),
      trace,
    })),
    postCommand: vi.fn(async (cmd) => {
      if (cmd.action === "navigate") {
        return {
          trace,
          result: {
            sessionId: cmd.sessionId,
            url: "https://example.com",
            title: "t",
            traceId: trace.traceId,
          },
        };
      }
      if (cmd.action === "snapshot") {
        return {
          trace,
          result: {
            sessionId: cmd.sessionId,
            url: "https://example.com",
            title: "t",
            htmlSnippet: "<p/>",
            traceId: trace.traceId,
          },
        };
      }
      if (cmd.action === "click" || cmd.action === "type") {
        return {
          trace,
          result: {
            sessionId: cmd.sessionId,
            url: "https://example.com",
            title: "t",
            traceId: trace.traceId,
          },
        };
      }
      if (cmd.action === "closeSession") {
        return {
          trace,
          result: {
            sessionId: cmd.sessionId,
            closed: true as const,
            traceId: trace.traceId,
          },
        };
      }
      throw new Error("unexpected command");
    }),
  } as unknown as CompanionHttpClient;
}

describe("getMcpToolDefinitions", () => {
  it("lists six tools with input schemas", () => {
    const tools = getMcpToolDefinitions();
    expect(tools.map((t) => t.name)).toEqual([
      "create_session",
      "navigate",
      "snapshot",
      "click",
      "type",
      "close_session",
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });
});

describe("executeMcpToolCall", () => {
  it("rejects unknown tools", async () => {
    const out = await executeMcpToolCall("nope", {}, mockClient());
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as { error: string };
    expect(body.error).toContain("Unknown tool");
  });

  it("creates a session", async () => {
    const client = mockClient();
    const out = await executeMcpToolCall("create_session", {}, client);
    expect(out.isError).toBeUndefined();
    expect(client.createSession).toHaveBeenCalledOnce();
    expect(out.content[0]?.text).toContain("sessionId");
    expect(out.content[0]?.text).toContain("trace");
  });

  it("rejects extra keys on create_session", async () => {
    const out = await executeMcpToolCall(
      "create_session",
      { extra: 1 },
      mockClient(),
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as { code?: string };
    expect(body.code).toBe("INVALID_TOOL_INPUT");
  });

  it("navigates with valid args", async () => {
    const client = mockClient();
    const out = await executeMcpToolCall(
      "navigate",
      {
        sessionId: "s1",
        url: "https://example.com",
      },
      client,
    );
    expect(out.isError).toBeUndefined();
    expect(client.postCommand).toHaveBeenCalledWith({
      action: "navigate",
      sessionId: "s1",
      url: "https://example.com",
    });
  });

  it("returns zod error envelope for bad navigate args", async () => {
    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "", url: "not-a-url" },
      mockClient(),
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as {
      code?: string;
      lifecycle?: { code?: string };
    };
    expect(body.code).toBe("INVALID_TOOL_INPUT");
    expect(body.lifecycle?.code).toBe("INVALID_TOOL_INPUT");
  });

  it("does not label companion response ZodError as INVALID_TOOL_INPUT", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(async () => {
        throw new CompanionHttpError(
          "Companion response failed schema validation: Required",
          { status: 200 },
        );
      }),
      postCommand: vi.fn(),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall("create_session", {}, client);
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as {
      error: string;
      code?: string;
    };
    expect(body.code).not.toBe("INVALID_TOOL_INPUT");
    expect(body.error).toContain("schema validation");
  });

  it("does not label companion postCommand ZodError as INVALID_TOOL_INPUT", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(),
      postCommand: vi.fn(async () => {
        throw new CompanionHttpError(
          "Companion response failed schema validation: Invalid companion success body",
          { status: 200 },
        );
      }),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "s1", url: "https://example.com" },
      client,
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as {
      error: string;
      code?: string;
    };
    expect(body.code).not.toBe("INVALID_TOOL_INPUT");
    expect(body.error).toContain("schema validation");
  });

  it("treats unexpected ZodError from companion client as generic MCP error", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(async () => {
        throw new z.ZodError([
          {
            code: "custom",
            path: ["sessionId"],
            message: "Required",
          },
        ]);
      }),
      postCommand: vi.fn(),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall("create_session", {}, client);
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as {
      error: string;
      code?: string;
    };
    expect(body.code).not.toBe("INVALID_TOOL_INPUT");
    expect(body.error).toContain("Unexpected schema error");
  });

  it("snapshots, clicks, types, and closes sessions", async () => {
    const client = mockClient();
    vi.clearAllMocks();

    const snap = await executeMcpToolCall(
      "snapshot",
      { sessionId: "s1" },
      client,
    );
    expect(snap.isError).toBeUndefined();

    const click = await executeMcpToolCall(
      "click",
      { sessionId: "s1", selector: "#btn" },
      client,
    );
    expect(click.isError).toBeUndefined();

    const type = await executeMcpToolCall(
      "type",
      { sessionId: "s1", selector: "#q", text: "hello" },
      client,
    );
    expect(type.isError).toBeUndefined();

    const closed = await executeMcpToolCall(
      "close_session",
      { sessionId: "s1" },
      client,
    );
    expect(closed.isError).toBeUndefined();

    expect(client.postCommand).toHaveBeenNthCalledWith(1, {
      action: "snapshot",
      sessionId: "s1",
    });
    expect(client.postCommand).toHaveBeenNthCalledWith(2, {
      action: "click",
      sessionId: "s1",
      selector: "#btn",
    });
    expect(client.postCommand).toHaveBeenNthCalledWith(3, {
      action: "type",
      sessionId: "s1",
      selector: "#q",
      text: "hello",
    });
    expect(client.postCommand).toHaveBeenNthCalledWith(4, {
      action: "closeSession",
      sessionId: "s1",
    });
  });

  it("rejects invalid click args (empty selector)", async () => {
    const out = await executeMcpToolCall(
      "click",
      { sessionId: "s1", selector: "" },
      mockClient(),
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as { code?: string };
    expect(body.code).toBe("INVALID_TOOL_INPUT");
  });

  it("rejects invalid type args (missing text)", async () => {
    const out = await executeMcpToolCall(
      "type",
      { sessionId: "s1", selector: "#a" },
      mockClient(),
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as { code?: string };
    expect(body.code).toBe("INVALID_TOOL_INPUT");
  });

  it("serializes CompanionHttpError with code and trace", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(),
      postCommand: vi.fn(async () => {
        throw new CompanionHttpError("not found", {
          status: 404,
          code: "SESSION_NOT_FOUND",
          trace,
        });
      }),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "s1", url: "https://example.com" },
      client,
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as {
      error: string;
      code?: string;
      trace?: unknown;
    };
    expect(body.code).toBe("SESSION_NOT_FOUND");
    expect(body.trace).toEqual(trace);
  });

  it("serializes CompanionHttpError with only message and status (no code/trace)", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(),
      postCommand: vi.fn(async () => {
        throw new CompanionHttpError("srv err", { status: 502 });
      }),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "s1", url: "https://example.com" },
      client,
    );
    expect(out.isError).toBe(true);
    const body = JSON.parse(out.content[0]?.text ?? "{}") as {
      error: string;
      code?: string;
      trace?: unknown;
    };
    expect(body.error).toBe("srv err");
    expect(body.code).toBeUndefined();
    expect(body.trace).toBeUndefined();
  });

  it("surfaces generic Error message from postCommand", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(),
      postCommand: vi.fn(async () => {
        throw new Error("generic");
      }),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "s1", url: "https://example.com" },
      client,
    );
    expect(out.isError).toBe(true);
    const envelope = JSON.parse(out.content[0]?.text ?? "{}") as {
      error: string;
    };
    expect(envelope.error).toBe("generic");
  });

  it("uses fallback text when postCommand throws a non-Error", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(),
      postCommand: vi.fn(async () => {
        throw "string";
      }),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "s1", url: "https://example.com" },
      client,
    );
    expect(out.isError).toBe(true);
    expect(
      (JSON.parse(out.content[0]?.text ?? "{}") as { error: string }).error,
    ).toBe("Unknown MCP error.");
  });

  it("returns fallback payload when result is not JSON-serializable", async () => {
    const client = {
      checkHealth: vi.fn(),
      createSession: vi.fn(),
      postCommand: vi.fn(async () => {
        const o: Record<string, unknown> = {};
        o.self = o;
        return { trace, result: o };
      }),
    } as unknown as CompanionHttpClient;

    const out = await executeMcpToolCall(
      "navigate",
      { sessionId: "s1", url: "https://example.com" },
      client,
    );
    expect(out.isError).toBeUndefined();
    const text = out.content[0]?.text ?? "";
    expect(text).toContain("Payload could not be serialized");
    const parsed = JSON.parse(text) as { error?: string };
    expect(parsed.error).toContain("Payload could not be serialized");
  });
});
