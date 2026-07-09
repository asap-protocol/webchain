import type { BrowserRuntime } from "@webchain/runtime";
import { WebchainRuntimeError } from "@webchain/runtime";
import { describe, expect, it, vi } from "vitest";
import { createCompanionApp } from "./server.js";

function parseApiError(res: { body: string }) {
  return JSON.parse(res.body) as {
    error: string;
    trace: { traceId: string; runId: string; createdAt: string };
    code?: string;
    details?: unknown;
    lifecycle?: { kind: string };
  };
}

function mockRuntime(overrides: Partial<BrowserRuntime> = {}): BrowserRuntime {
  return {
    createSession: vi.fn(async () => ({
      sessionId: "sid-1",
      pageId: "pid-1",
      createdAt: new Date().toISOString(),
    })),
    navigate: vi.fn(async (cmd) => ({
      sessionId: cmd.sessionId,
      url: "https://example.com",
      title: "T",
    })),
    snapshot: vi.fn(async (cmd) => ({
      sessionId: cmd.sessionId,
      url: "https://example.com",
      title: "T",
      htmlSnippet: "<html/>",
    })),
    click: vi.fn(async (cmd) => ({
      sessionId: cmd.sessionId,
      url: "https://example.com",
      title: "T",
    })),
    type: vi.fn(async (cmd) => ({
      sessionId: cmd.sessionId,
      url: "https://example.com",
      title: "T",
    })),
    closeSession: vi.fn(async (cmd) => ({
      sessionId: cmd.sessionId,
      closed: true as const,
    })),
    shutdown: vi.fn(async () => {}),
    ...overrides,
  } as unknown as BrowserRuntime;
}

describe("createCompanionApp", () => {
  it("returns health without auth token", async () => {
    const { app } = await createCompanionApp({
      runtime: mockRuntime(),
      logger: false,
      localToken: "secret",
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      capabilities: string[];
    };
    expect(body.status).toBe("ok");
    expect(body.capabilities).toContain("navigate");
    await app.close();
  });

  it("rejects protected routes without token", async () => {
    const { app } = await createCompanionApp({
      runtime: mockRuntime(),
      logger: false,
      localToken: "secret",
    });

    const res = await app.inject({ method: "POST", url: "/sessions" });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("creates a session with valid token", async () => {
    const runtime = mockRuntime();
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { "x-webchain-token": "tok" },
    });

    expect(res.statusCode).toBe(200);
    expect(runtime.createSession).toHaveBeenCalledOnce();
    const body = JSON.parse(res.body) as {
      lifecycle?: { kind: string; sessionId?: string };
    };
    expect(body.lifecycle?.kind).toBe("session_created");
    await app.close();
  });

  it("runs navigate command", async () => {
    const runtime = mockRuntime();
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: {
        action: "navigate",
        sessionId: "s1",
        url: "https://example.com",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(runtime.navigate).toHaveBeenCalled();
    await app.close();
  });

  it("runs snapshot command", async () => {
    const runtime = mockRuntime();
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: {
        action: "snapshot",
        sessionId: "s1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(runtime.snapshot).toHaveBeenCalled();
    await app.close();
  });

  it("runs click, type, and closeSession commands", async () => {
    const runtime = mockRuntime();
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const headers = { "x-webchain-token": "tok" } as const;

    const clickRes = await app.inject({
      method: "POST",
      url: "/commands",
      headers,
      payload: {
        action: "click",
        sessionId: "s1",
        selector: "#a",
      },
    });
    expect(clickRes.statusCode).toBe(200);
    expect(runtime.click).toHaveBeenCalled();

    const typeRes = await app.inject({
      method: "POST",
      url: "/commands",
      headers,
      payload: {
        action: "type",
        sessionId: "s1",
        selector: "#a",
        text: "x",
      },
    });
    expect(typeRes.statusCode).toBe(200);
    expect(runtime.type).toHaveBeenCalled();

    const closeRes = await app.inject({
      method: "POST",
      url: "/commands",
      headers,
      payload: {
        action: "closeSession",
        sessionId: "s1",
      },
    });
    expect(closeRes.statusCode).toBe(200);
    expect(runtime.closeSession).toHaveBeenCalled();

    const closeBody = JSON.parse(closeRes.body) as {
      lifecycle?: { kind: string };
    };
    expect(closeBody.lifecycle?.kind).toBe("session_closed");

    await app.close();
  });

  it("rejects disallowed CORS origins", async () => {
    const { app } = await createCompanionApp({
      runtime: mockRuntime(),
      logger: false,
    });

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" },
    });

    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it("returns 400 on invalid command body", async () => {
    const { app } = await createCompanionApp({
      runtime: mockRuntime(),
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: { action: "navigate" },
    });

    expect(res.statusCode).toBe(400);
    const body = parseApiError(res);
    expect(body.trace.traceId).toBeTruthy();
    expect(body.details).toBeDefined();
    expect(body.code).toBe("INVALID_COMMAND_BODY");
    expect(body.lifecycle?.kind).toBe("command_error");
    await app.close();
  });

  it("returns 500 when runtime throws", async () => {
    const runtime = mockRuntime({
      navigate: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: {
        action: "navigate",
        sessionId: "s1",
        url: "https://example.com",
      },
    });

    expect(res.statusCode).toBe(500);
    const body = parseApiError(res);
    expect(body.error).toContain("boom");
    expect(body.trace.traceId).toBeTruthy();
    expect(body.code).toBeUndefined();
    expect(body.lifecycle?.kind).toBe("command_error");
    await app.close();
  });

  it("returns 404 with code when runtime reports unknown session", async () => {
    const runtime = mockRuntime({
      navigate: vi.fn(async () => {
        throw new WebchainRuntimeError(
          "SESSION_NOT_FOUND",
          "Unknown session: x",
        );
      }),
    });
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: {
        action: "navigate",
        sessionId: "s1",
        url: "https://example.com",
      },
    });

    expect(res.statusCode).toBe(404);
    const body = parseApiError(res);
    expect(body.code).toBe("SESSION_NOT_FOUND");
    expect(body.trace.traceId).toBeTruthy();
    expect(body.lifecycle?.kind).toBe("command_error");
    await app.close();
  });

  it("returns 502 with code when runtime reports command failure", async () => {
    const runtime = mockRuntime({
      navigate: vi.fn(async () => {
        throw new WebchainRuntimeError("COMMAND_FAILED", "selector not found");
      }),
    });
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: {
        action: "navigate",
        sessionId: "s1",
        url: "https://example.com",
      },
    });

    expect(res.statusCode).toBe(502);
    const body = parseApiError(res);
    expect(body.code).toBe("COMMAND_FAILED");
    expect(body.trace.traceId).toBeTruthy();
    expect(body.lifecycle?.kind).toBe("command_error");
    await app.close();
  });

  it("returns 500 when runtime incorrectly emits MCP-only INVALID_TOOL_INPUT", async () => {
    const runtime = mockRuntime({
      navigate: vi.fn(async () => {
        throw new WebchainRuntimeError(
          "INVALID_TOOL_INPUT",
          "must not reach companion HTTP",
        );
      }),
    });
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": "tok" },
      payload: {
        action: "navigate",
        sessionId: "s1",
        url: "https://example.com",
      },
    });

    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it("returns 503 when runtime reports missing browsers", async () => {
    const runtime = mockRuntime({
      createSession: vi.fn(async () => {
        throw new WebchainRuntimeError(
          "BROWSER_NOT_INSTALLED",
          "install chromium",
        );
      }),
    });
    const { app } = await createCompanionApp({
      runtime,
      logger: false,
      localToken: "tok",
    });

    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { "x-webchain-token": "tok" },
    });

    expect(res.statusCode).toBe(503);
    const body = parseApiError(res);
    expect(body.code).toBe("BROWSER_NOT_INSTALLED");
    expect(body.trace.traceId).toBeTruthy();
    expect(body.lifecycle?.kind).toBe("command_error");
    await app.close();
  });
});
