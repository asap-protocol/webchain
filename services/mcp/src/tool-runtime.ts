import {
  ClickArgsSchema,
  commandErrorLifecycle,
  createTraceContext,
  McpToolErrorEnvelopeSchema,
  NavigateArgsSchema,
  SessionIdArgsSchema,
  TypeArgsSchema,
} from "@webchain/protocol";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CompanionHttpClient } from "./companion-client.js";
import { CompanionHttpError } from "./companion-client.js";

const createSessionInputSchema = z.object({}).strict();

const navigateInputJson = mcpToolInputSchema(NavigateArgsSchema);
const sessionIdInputJson = mcpToolInputSchema(SessionIdArgsSchema);
const createSessionInputJson = mcpToolInputSchema(createSessionInputSchema);
const clickInputJson = mcpToolInputSchema(ClickArgsSchema);
const typeInputJson = mcpToolInputSchema(TypeArgsSchema);

export function getMcpToolDefinitions() {
  return [
    {
      name: "create_session",
      description:
        "Create a new browser session via the Webchain companion (single session authority).",
      inputSchema: createSessionInputJson,
    },
    {
      name: "navigate",
      description: "Navigate an existing session to a URL.",
      inputSchema: navigateInputJson,
    },
    {
      name: "snapshot",
      description:
        "Capture a layered semantic snapshot (HTML excerpt, DOM summary, accessibility tree, links).",
      inputSchema: sessionIdInputJson,
    },
    {
      name: "click",
      description: "Click an element matched by a CSS selector.",
      inputSchema: clickInputJson,
    },
    {
      name: "type",
      description: "Fill text into an element matched by a CSS selector.",
      inputSchema: typeInputJson,
    },
    {
      name: "close_session",
      description: "Close a browser session and release resources.",
      inputSchema: sessionIdInputJson,
    },
  ];
}

function stringifyMcpPayload(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    );
  } catch {
    return JSON.stringify({
      error: "Payload could not be serialized to JSON.",
    });
  }
}

function mcpSuccessContent(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [{ type: "text", text: stringifyMcpPayload(value) }],
  };
}

function mcpErrorContent(partial: z.input<typeof McpToolErrorEnvelopeSchema>): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: stringifyMcpPayload(McpToolErrorEnvelopeSchema.parse(partial)),
      },
    ],
  };
}

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function invalidToolInputContent(error: z.ZodError): McpToolResult {
  const trace = createTraceContext();
  return mcpErrorContent({
    error: "Invalid MCP tool arguments.",
    code: "INVALID_TOOL_INPUT",
    trace,
    validation: error.flatten(),
    lifecycle: commandErrorLifecycle(trace.traceId, "INVALID_TOOL_INPUT"),
  });
}

function parseToolArgs<T>(
  schema: z.ZodType<T>,
  rawArgs: unknown,
): { ok: true; value: T } | { ok: false; result: McpToolResult } {
  try {
    return { ok: true, value: schema.parse(rawArgs ?? {}) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, result: invalidToolInputContent(error) };
    }
    throw error;
  }
}

export async function executeMcpToolCall(
  name: string,
  rawArgs: unknown,
  client: CompanionHttpClient,
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "create_session": {
        const parsed = parseToolArgs(createSessionInputSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }
        return mcpSuccessContent(await client.createSession());
      }
      case "navigate": {
        const parsed = parseToolArgs(NavigateArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }
        return mcpSuccessContent(
          await client.postCommand({ action: "navigate", ...parsed.value }),
        );
      }
      case "snapshot": {
        const parsed = parseToolArgs(SessionIdArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }
        return mcpSuccessContent(
          await client.postCommand({ action: "snapshot", ...parsed.value }),
        );
      }
      case "click": {
        const parsed = parseToolArgs(ClickArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }
        return mcpSuccessContent(
          await client.postCommand({ action: "click", ...parsed.value }),
        );
      }
      case "type": {
        const parsed = parseToolArgs(TypeArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }
        return mcpSuccessContent(
          await client.postCommand({ action: "type", ...parsed.value }),
        );
      }
      case "close_session": {
        const parsed = parseToolArgs(SessionIdArgsSchema, rawArgs);
        if (!parsed.ok) {
          return parsed.result;
        }
        return mcpSuccessContent(
          await client.postCommand({
            action: "closeSession",
            sessionId: parsed.value.sessionId,
          }),
        );
      }
      default:
        return mcpErrorContent({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    if (error instanceof CompanionHttpError) {
      return mcpErrorContent({
        error: error.message,
        code: error.code,
        trace: error.trace,
        lifecycle: error.lifecycle,
      });
    }
    // Defense in depth: response-parse ZodErrors should be CompanionHttpError.
    // Never map a late ZodError to INVALID_TOOL_INPUT.
    if (error instanceof z.ZodError) {
      return mcpErrorContent({
        error: `Unexpected schema error after tool-arg validation: ${error.message}`,
      });
    }
    return mcpErrorContent({
      error: error instanceof Error ? error.message : "Unknown MCP error.",
    });
  }
}

/** zod-to-json-schema is typed against Zod 3; object schemas are compatible at runtime with Zod 4. */
function mcpToolInputSchema(schema: z.ZodTypeAny) {
  const json = zodToJsonSchema(schema as never, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  const { $schema: _schema, definitions: _defs, ...rest } = json;
  /** MCP SDK validates `inputSchema.type === "object"` for tools/list. */
  return { ...rest, type: "object" as const };
}
