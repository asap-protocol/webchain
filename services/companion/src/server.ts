import cors from "@fastify/cors";
import {
  CompanionApiErrorBodySchema,
  CompanionCommandSuccessSchema,
  CompanionHealthSchema,
  commandErrorLifecycle,
  createTraceContext,
  RUNTIME_ACTIONS,
  RuntimeCommandSchema,
  type RuntimeErrorCode,
  SessionCreatedResponseSchema,
  SessionCreatedSchema,
  sessionClosedLifecycle,
  sessionCreatedLifecycle,
  type TraceContext,
} from "@webchain/protocol";
import { type BrowserRuntime, isWebchainRuntimeError } from "@webchain/runtime";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { z } from "zod";

function httpStatusForRuntimeCode(code: RuntimeErrorCode): number {
  switch (code) {
    case "SESSION_NOT_FOUND":
      return 404;
    case "BROWSER_NOT_INSTALLED":
    case "BROWSER_LAUNCH_FAILED":
      return 503;
    case "COMMAND_FAILED":
      return 502;
    case "INVALID_COMMAND_BODY":
      return 400;
    case "INVALID_TOOL_INPUT":
      // MCP-only; sendRuntimeFailure must not call this for that code.
      throw new Error(
        "INVALID_TOOL_INPUT is MCP-only and must not be mapped at companion HTTP boundary.",
      );
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

function sessionIdFromBody(body: unknown): string | undefined {
  if (
    body &&
    typeof body === "object" &&
    "sessionId" in body &&
    typeof (body as { sessionId: unknown }).sessionId === "string"
  ) {
    const sessionId = (body as { sessionId: string }).sessionId;
    return sessionId.length > 0 ? sessionId : undefined;
  }
  return undefined;
}

function sendRuntimeFailure(
  reply: FastifyReply,
  error: unknown,
  trace: TraceContext,
  sessionId?: string,
) {
  if (error instanceof z.ZodError) {
    const body = CompanionApiErrorBodySchema.parse({
      error: "Invalid request body.",
      trace,
      code: "INVALID_COMMAND_BODY",
      details: error.flatten(),
      lifecycle: commandErrorLifecycle(
        trace.traceId,
        "INVALID_COMMAND_BODY",
        sessionId,
      ),
    });
    return reply.code(400).send(body);
  }

  if (isWebchainRuntimeError(error)) {
    // Keep MCP-only invariant without escaping CompanionApiErrorBodySchema.
    if (error.code === "INVALID_TOOL_INPUT") {
      const body = CompanionApiErrorBodySchema.parse({
        error:
          "Internal companion error: MCP-only INVALID_TOOL_INPUT reached HTTP boundary.",
        trace,
        lifecycle: commandErrorLifecycle(trace.traceId, undefined, sessionId),
      });
      return reply.code(500).send(body);
    }

    const status = httpStatusForRuntimeCode(error.code);
    const body = CompanionApiErrorBodySchema.parse({
      error: error.message,
      trace,
      code: error.code,
      lifecycle: commandErrorLifecycle(trace.traceId, error.code, sessionId),
    });
    return reply.code(status).send(body);
  }

  const body = CompanionApiErrorBodySchema.parse({
    error: error instanceof Error ? error.message : "Unknown runtime error.",
    trace,
    lifecycle: commandErrorLifecycle(trace.traceId, undefined, sessionId),
  });
  return reply.code(500).send(body);
}

export type CreateCompanionAppOptions = {
  runtime: BrowserRuntime;
  localToken?: string;
  logger?: boolean;
};

export async function createCompanionApp(
  options: CreateCompanionAppOptions,
): Promise<{ app: FastifyInstance; localToken: string }> {
  const localToken =
    options.localToken ??
    process.env.WEBCHAIN_LOCAL_TOKEN ??
    "change-me-in-local-dev";

  const app = Fastify({ logger: options.logger ?? true });

  await app.register(cors, {
    origin(origin, callback) {
      if (
        !origin ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")
      ) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed."), false);
    },
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "GET" && request.url === "/health") {
      return;
    }

    const token = request.headers["x-webchain-token"];

    if (token !== localToken) {
      return reply.code(401).send({
        error: "Missing or invalid local token.",
      });
    }
  });

  app.get("/health", async () => {
    return CompanionHealthSchema.parse({
      status: "ok",
      service: "webchain-companion",
      version: "0.1.0",
      capabilities: [...RUNTIME_ACTIONS],
    });
  });

  app.post("/sessions", async (_request, reply) => {
    const trace = createTraceContext();
    try {
      const session = await options.runtime.createSession();
      const parsedSession = SessionCreatedSchema.parse(session);
      return SessionCreatedResponseSchema.parse({
        ...parsedSession,
        trace,
        lifecycle: sessionCreatedLifecycle(
          trace.traceId,
          parsedSession.sessionId,
        ),
      });
    } catch (error) {
      return sendRuntimeFailure(reply, error, trace);
    }
  });

  app.post("/commands", async (request, reply) => {
    const trace = createTraceContext();
    const sessionId = sessionIdFromBody(request.body);
    try {
      const command = RuntimeCommandSchema.parse(request.body);
      const runtime = options.runtime;

      switch (command.action) {
        case "navigate": {
          const result = await runtime.navigate(command);
          return CompanionCommandSuccessSchema.parse({
            trace,
            result: { ...result, traceId: trace.traceId },
          });
        }
        case "snapshot": {
          const result = await runtime.snapshot(command);
          return CompanionCommandSuccessSchema.parse({
            trace,
            result: { ...result, traceId: trace.traceId },
          });
        }
        case "click": {
          const result = await runtime.click(command);
          return CompanionCommandSuccessSchema.parse({
            trace,
            result: { ...result, traceId: trace.traceId },
          });
        }
        case "type": {
          const result = await runtime.type(command);
          return CompanionCommandSuccessSchema.parse({
            trace,
            result: { ...result, traceId: trace.traceId },
          });
        }
        case "closeSession": {
          const result = await runtime.closeSession(command);
          return CompanionCommandSuccessSchema.parse({
            trace,
            result: { ...result, traceId: trace.traceId },
            lifecycle: sessionClosedLifecycle(trace.traceId, command.sessionId),
          });
        }
      }
    } catch (error) {
      return sendRuntimeFailure(reply, error, trace, sessionId);
    }
  });

  return { app, localToken };
}
