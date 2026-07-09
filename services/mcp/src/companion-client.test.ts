import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionHttpClient, CompanionHttpError } from "./companion-client.js";

const trace = {
  traceId: "00000000-0000-4000-8000-000000000001",
  runId: "00000000-0000-4000-8000-000000000002",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function sessionOkBody() {
  return JSON.stringify({
    sessionId: "sess-1",
    pageId: "page-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    trace,
  });
}

function commandOkBody() {
  return JSON.stringify({
    trace,
    result: { sessionId: "sess-1", url: "https://ex.test/", title: "t" },
  });
}

describe("CompanionHttpClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checkHealth resolves when ok", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: "ok",
          service: "webchain-companion",
          version: "0.1.0",
          capabilities: [
            "navigate",
            "snapshot",
            "click",
            "type",
            "closeSession",
          ],
        }),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await c.checkHealth();
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:8787/health");
  });

  it("checkHealth throws when body fails CompanionHealthSchema", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "ok" }),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await expect(c.checkHealth()).rejects.toMatchObject({
      name: "CompanionHttpError",
      status: 200,
      message: expect.stringContaining("schema validation"),
    });
  });

  it("createSession wraps success-body Zod failures as CompanionHttpError", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ sessionId: "only" }),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await expect(c.createSession()).rejects.toMatchObject({
      name: "CompanionHttpError",
      status: 200,
      message: expect.stringContaining("schema validation"),
    });
  });

  it("postCommand wraps success-body Zod failures as CompanionHttpError", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ unexpected: true }),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await expect(
      c.postCommand({
        action: "navigate",
        sessionId: "sess-1",
        url: "https://ex.test/",
      }),
    ).rejects.toMatchObject({
      name: "CompanionHttpError",
      status: 200,
      message: expect.stringContaining("schema validation"),
    });
  });

  it("checkHealth throws CompanionHttpError when not ok", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await expect(c.checkHealth()).rejects.toMatchObject({
      name: "CompanionHttpError",
      status: 503,
    });
  });

  it("strips trailing slash from baseUrl", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => sessionOkBody(),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787/",
      token: "tok",
    });
    await c.createSession();
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8787/sessions",
    );
  });

  it("createSession parses JSON body", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => sessionOkBody(),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    const out = await c.createSession();
    expect(out.sessionId).toBe("sess-1");
    expect(out.trace.traceId).toBe(trace.traceId);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/sessions",
      expect.objectContaining({
        method: "POST",
        headers: { "x-webchain-token": "tok" },
      }),
    );
  });

  it("postCommand sends JSON and parses success", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => commandOkBody(),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    const cmd = {
      action: "navigate" as const,
      sessionId: "sess-1",
      url: "https://ex.test/",
    };
    const out = await c.postCommand(cmd);
    expect(out.result).toEqual(
      expect.objectContaining({ sessionId: "sess-1", title: "t" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/commands",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webchain-token": "tok",
        },
        body: JSON.stringify(cmd),
      }),
    );
  });

  it("throws CompanionHttpError with API body when parse succeeds", async () => {
    const errBody = JSON.stringify({
      error: "boom",
      trace,
      code: "COMMAND_FAILED",
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => errBody,
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    try {
      await c.createSession();
      expect.fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CompanionHttpError);
      const err = e as CompanionHttpError;
      expect(err.message).toBe("boom");
      expect(err.status).toBe(400);
      expect(err.code).toBe("COMMAND_FAILED");
      expect(err.trace?.traceId).toBe(trace.traceId);
    }
  });

  it("throws generic message when body is not JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "not json {{{",
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await expect(
      c.postCommand({ action: "closeSession", sessionId: "s" }),
    ).rejects.toMatchObject({
      name: "CompanionHttpError",
      status: 502,
      message: expect.stringContaining("Companion request failed"),
    });
  });

  it("throws generic message when JSON does not match API schema", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 418,
      text: async () => JSON.stringify({ foo: 1 }),
    } as Response);
    const c = new CompanionHttpClient({
      baseUrl: "http://127.0.0.1:8787",
      token: "tok",
    });
    await expect(c.createSession()).rejects.toMatchObject({
      status: 418,
      message: expect.stringContaining("Companion request failed"),
    });
  });
});
