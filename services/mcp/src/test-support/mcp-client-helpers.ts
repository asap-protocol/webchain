import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function readToolText(result: CallToolResult): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "{}";
}

export function parseToolJson<T>(result: CallToolResult): T {
  return JSON.parse(readToolText(result)) as T;
}
