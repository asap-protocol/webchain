import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { createCompanionApp } from "@webchain/companion/server";
import { BrowserRuntime } from "@webchain/runtime";

type CompanionApp = Awaited<ReturnType<typeof createCompanionApp>>["app"];

const mcpPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export type McpIntegrationStack = {
  client: Client;
  app: CompanionApp;
  runtime: BrowserRuntime;
  shutdown: () => Promise<void>;
};

export async function bootstrapMcpStack(
  options: { token?: string; clientName?: string } = {},
): Promise<McpIntegrationStack> {
  const token = options.token ?? "webchain-integration-token";
  const clientName = options.clientName ?? "webchain-mcp-integration";
  const runtime = new BrowserRuntime({ headless: true });
  const { app } = await createCompanionApp({
    runtime,
    localToken: token,
    logger: false,
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const companionPort =
    typeof addr === "object" && addr && "port" in addr ? addr.port : 8787;

  const stdioTransport = new StdioClientTransport({
    command: "pnpm",
    args: ["exec", "tsx", "src/index.ts"],
    cwd: mcpPackageRoot,
    env: {
      ...getDefaultEnvironment(),
      WEBCHAIN_COMPANION_ORIGIN: `http://127.0.0.1:${companionPort}`,
      WEBCHAIN_LOCAL_TOKEN: token,
    },
    stderr: "pipe",
  });

  const client = new Client({ name: clientName, version: "0.0.1" });
  await client.connect(stdioTransport);

  return {
    client,
    app,
    runtime,
    shutdown: async () => {
      await stdioTransport.close();
      await runtime.shutdown();
      await app.close();
    },
  };
}
