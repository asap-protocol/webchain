import { BrowserRuntime } from "@webchain/runtime";
import { createCompanionApp } from "./server.js";

const port = Number(process.env.WEBCHAIN_COMPANION_PORT ?? 8787);

const runtime = new BrowserRuntime({
  headless: process.env.WEBCHAIN_HEADLESS !== "false",
});

const { app } = await createCompanionApp({ runtime });

let closing = false;

const closeGracefully = async () => {
  if (closing) {
    return;
  }
  closing = true;

  await app.close();
  await runtime.shutdown();
  process.exit(0);
};

process.on("SIGINT", closeGracefully);
process.on("SIGTERM", closeGracefully);

try {
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
