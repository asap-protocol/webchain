import { randomUUID } from "node:crypto";
import {
  type ActionResult,
  type ClickCommand,
  type CloseSessionCommand,
  type CloseSessionResult,
  CloseSessionResultSchema,
  type NavigateCommand,
  type RuntimeSession,
  type SnapshotCommand,
  type SnapshotResult,
  type TypeCommand,
} from "@webchain/protocol";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium, webkit } from "playwright";
import {
  mapCommandFailure,
  mapPlaywrightLaunchError,
  WebchainRuntimeError,
} from "./runtime-error.js";
import { extractLandmarks, extractPageLinks } from "./snapshot-helpers.js";

export interface BrowserRuntimeOptions {
  headless?: boolean;
}

type SessionRecord = {
  context: BrowserContext;
  page: Page;
  pageId: string;
};

export class BrowserRuntime {
  private browserPromise: Promise<Browser> | null = null;
  private sessions = new Map<string, SessionRecord>();
  private shuttingDown = false;

  constructor(private readonly options: BrowserRuntimeOptions = {}) {}

  private assertActive(operation: string) {
    if (this.shuttingDown) {
      throw new WebchainRuntimeError(
        "COMMAND_FAILED",
        `Runtime is shutting down; cannot ${operation}`,
      );
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this.launchBrowser();
    }

    try {
      return await this.browserPromise;
    } catch (error) {
      this.browserPromise = null;
      throw error;
    }
  }

  private async launchBrowser() {
    try {
      return await chromium.launch({
        headless: this.options.headless ?? true,
      });
    } catch (chromiumError) {
      if (!shouldFallbackToWebkit(chromiumError)) {
        throw mapPlaywrightLaunchError(chromiumError);
      }

      try {
        return await webkit.launch({
          headless: this.options.headless ?? true,
        });
      } catch (webkitError) {
        throw mapPlaywrightLaunchError(webkitError);
      }
    }
  }

  async createSession(): Promise<RuntimeSession> {
    this.assertActive("create session");
    const browser = await this.getBrowser();
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const sessionId = randomUUID();
      const pageId = randomUUID();

      this.sessions.set(sessionId, {
        context,
        page,
        pageId,
      });

      return {
        sessionId,
        pageId,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      await context.close().catch(() => {});
      throw mapPlaywrightLaunchError(error);
    }
  }

  async navigate(command: NavigateCommand): Promise<ActionResult> {
    this.assertActive("navigate");
    const session = this.getSession(command.sessionId);
    try {
      await session.page.goto(command.url, { waitUntil: "domcontentloaded" });
    } catch (error) {
      throw mapCommandFailure(error);
    }

    return {
      sessionId: command.sessionId,
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async snapshot(command: SnapshotCommand): Promise<SnapshotResult> {
    this.assertActive("snapshot");
    const session = this.getSession(command.sessionId);
    try {
      const page = session.page;
      const html = await page.content();
      /** Covers sync throws (some Playwright APIs throw before returning a Promise). */
      const safe = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await run();
        } catch {
          return undefined;
        }
      };
      const [accessibilityTree, domSummary, links, landmarks] =
        await Promise.all([
          /** Playwright 1.58+ removed `page.accessibility`; use ARIA snapshot on `body`. */
          safe(() => page.locator("body").ariaSnapshot()),
          safe(() =>
            page.evaluate(() => {
              const t = document.body?.innerText ?? "";
              return t.replace(/\s+/g, " ").trim().slice(0, 2000);
            }),
          ),
          safe(() => extractPageLinks(page, 80)),
          safe(() => extractLandmarks(page)),
        ]);
      let accessibilityJson: unknown = accessibilityTree ?? undefined;
      if (accessibilityJson !== undefined) {
        try {
          accessibilityJson = JSON.parse(
            JSON.stringify(accessibilityJson, (_k, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ),
          );
        } catch {
          accessibilityJson = undefined;
        }
      }
      return {
        sessionId: command.sessionId,
        url: page.url(),
        title: await page.title(),
        htmlSnippet: summarizeHtml(html),
        domSummary,
        accessibilityTree: accessibilityJson,
        links,
        landmarks,
      };
    } catch (error) {
      throw mapCommandFailure(error);
    }
  }

  async click(command: ClickCommand): Promise<ActionResult> {
    this.assertActive("click");
    const session = this.getSession(command.sessionId);
    try {
      await session.page.locator(command.selector).first().click();
    } catch (error) {
      throw mapCommandFailure(error);
    }

    return {
      sessionId: command.sessionId,
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async type(command: TypeCommand): Promise<ActionResult> {
    this.assertActive("type");
    const session = this.getSession(command.sessionId);
    try {
      await session.page.locator(command.selector).first().fill(command.text);
    } catch (error) {
      throw mapCommandFailure(error);
    }

    return {
      sessionId: command.sessionId,
      url: session.page.url(),
      title: await session.page.title(),
    };
  }

  async closeSession(
    command: CloseSessionCommand,
  ): Promise<CloseSessionResult> {
    this.assertActive("close session");
    const session = this.getSession(command.sessionId);
    try {
      await session.context.close();
    } catch (error) {
      throw mapCommandFailure(error);
    }
    this.sessions.delete(command.sessionId);

    return CloseSessionResultSchema.parse({
      sessionId: command.sessionId,
      closed: true,
    });
  }

  async shutdown() {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;

    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        await session.context.close();
      }),
    );
    this.sessions.clear();

    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
      this.browserPromise = null;
    }
  }

  private getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new WebchainRuntimeError(
        "SESSION_NOT_FOUND",
        `Unknown session: ${sessionId}`,
      );
    }

    return session;
  }
}

export {
  isExecutableMissingMessage,
  isWebchainRuntimeError,
  mapCommandFailure,
  mapPlaywrightLaunchError,
  WebchainRuntimeError,
} from "./runtime-error.js";

export function summarizeHtml(html: string, limit = 1600) {
  return html.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function shouldFallbackToWebkit(error: unknown) {
  return (
    error instanceof Error && error.message.includes("Executable doesn't exist")
  );
}
