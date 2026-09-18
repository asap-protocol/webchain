import { BrowserRuntime } from "@webchain/runtime";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanionApp } from "./server.js";

const token = "integration-test-token";

describe("local browser loop (integration)", () => {
  let app: FastifyInstance;
  let runtime: BrowserRuntime;

  beforeAll(async () => {
    runtime = new BrowserRuntime({ headless: true });
    const { app: companion } = await createCompanionApp({
      runtime,
      localToken: token,
      logger: false,
    });
    app = companion;
  });

  afterAll(async () => {
    await runtime.shutdown();
    await app.close();
  });

  it("GET /health → POST /sessions → navigate → snapshot → closeSession", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { "x-webchain-token": token },
    });
    expect(sessionRes.statusCode).toBe(200);
    const sessionBody = JSON.parse(sessionRes.body) as {
      sessionId: string;
      trace: { traceId: string };
    };
    const { sessionId } = sessionBody;
    expect(sessionBody.trace.traceId.length).toBeGreaterThan(0);

    const nav = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": token },
      payload: {
        action: "navigate",
        sessionId,
        url: "https://example.com",
      },
    });
    expect(nav.statusCode).toBe(200);

    const snap = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": token },
      payload: { action: "snapshot", sessionId },
    });
    expect(snap.statusCode).toBe(200);
    const snapBody = JSON.parse(snap.body) as {
      result: {
        htmlSnippet: string;
        title: string;
        accessibilityTree?: unknown;
        domSummary?: string;
      };
      trace: { traceId: string };
    };
    expect(snapBody.result.htmlSnippet.length).toBeGreaterThan(0);
    expect(snapBody.result.title.length).toBeGreaterThan(0);
    expect(snapBody.result.accessibilityTree).toBeDefined();
    expect(snapBody.trace.traceId.length).toBeGreaterThan(0);

    const close = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": token },
      payload: { action: "closeSession", sessionId },
    });
    expect(close.statusCode).toBe(200);

    const closeAgain = await app.inject({
      method: "POST",
      url: "/commands",
      headers: { "x-webchain-token": token },
      payload: { action: "closeSession", sessionId },
    });
    expect(closeAgain.statusCode).toBe(404);
    const errBody = JSON.parse(closeAgain.body) as {
      code: string;
      trace: { traceId: string };
    };
    expect(errBody.code).toBe("SESSION_NOT_FOUND");
    expect(errBody.trace.traceId.length).toBeGreaterThan(0);
  });

  it("fails snapshot quickly after renderer crash instead of hanging", async () => {
    const crashRuntime = new BrowserRuntime({
      headless: true,
      pageCommandTimeoutMs: 3_000,
    });
    const { app: crashApp } = await createCompanionApp({
      runtime: crashRuntime,
      localToken: token,
      logger: false,
    });
    try {
      const sessionRes = await crashApp.inject({
        method: "POST",
        url: "/sessions",
        headers: { "x-webchain-token": token },
      });
      expect(sessionRes.statusCode).toBe(200);
      const { sessionId } = JSON.parse(sessionRes.body) as {
        sessionId: string;
      };

      const nav = await crashApp.inject({
        method: "POST",
        url: "/commands",
        headers: { "x-webchain-token": token },
        payload: {
          action: "navigate",
          sessionId,
          url: "chrome://crash",
        },
      });
      expect(nav.statusCode).toBe(502);

      const started = Date.now();
      const snap = await crashApp.inject({
        method: "POST",
        url: "/commands",
        headers: { "x-webchain-token": token },
        payload: { action: "snapshot", sessionId },
      });
      const elapsed = Date.now() - started;
      expect(snap.statusCode).toBe(502);
      const body = JSON.parse(snap.body) as { code?: string; error?: string };
      expect(body.code).toBe("COMMAND_FAILED");
      expect(body.error ?? "").toMatch(/timed out|crashed/i);
      // Must not hang for minutes; host timer is 3s plus small overhead.
      expect(elapsed).toBeLessThan(8_000);

      const close = await crashApp.inject({
        method: "POST",
        url: "/commands",
        headers: { "x-webchain-token": token },
        payload: { action: "closeSession", sessionId },
      });
      expect(close.statusCode).toBe(200);
    } finally {
      await crashRuntime.shutdown();
      await crashApp.close();
    }
  });
});
