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

export async function executeMcpToolCall(
  name: string,
  rawArgs: unknown,
  client: CompanionHttpClient,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    switch (name) {
      case "create_session": {
        createSessionInputSchema.parse(rawArgs ?? {});
        const created = await client.createSession();
        return mcpSuccessContent(created);
      }
      case "navigate": {
        const args = NavigateArgsSchema.parse(rawArgs ?? {});
        const envelope = await client.postCommand({
          action: "navigate",
          ...args,
        });
        return mcpSuccessContent(envelope);
      }
      case "snapshot": {
        const args = SessionIdArgsSchema.parse(rawArgs ?? {});
        const envelope = await client.postCommand({
          action: "snapshot",
          ...args,
        });
        return mcpSuccessContent(envelope);
      }
      case "click": {
        const args = ClickArgsSchema.parse(rawArgs ?? {});
        const envelope = await client.postCommand({
          action: "click",
          ...args,
        });
        return mcpSuccessContent(envelope);
      }
      case "type": {
        const args = TypeArgsSchema.parse(rawArgs ?? {});
        const envelope = await client.postCommand({
          action: "type",
          ...args,
        });
        return mcpSuccessContent(envelope);
      }
      case "close_session": {
        const args = SessionIdArgsSchema.parse(rawArgs ?? {});
        const envelope = await client.postCommand({
          action: "closeSession",
          sessionId: args.sessionId,
        });
        return mcpSuccessContent(envelope);
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
    if (error instanceof z.ZodError) {
      const trace = createTraceContext();
      return mcpErrorContent({
        error: "Invalid MCP tool arguments.",
        code: "INVALID_TOOL_INPUT",
        trace,
        validation: error.flatten(),
        lifecycle: commandErrorLifecycle(trace.traceId, "INVALID_TOOL_INPUT"),
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
