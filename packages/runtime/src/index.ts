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
  private browserDisconnectHandler: (() => void) | null = null;

  constructor(private readonly options: BrowserRuntimeOptions = {}) {}

  private invalidateBrowserState(): void {
    this.browserPromise = null;
    this.browserDisconnectHandler = null;
    this.sessions.clear();
  }

  private attachBrowserDisconnectHandler(browser: Browser): void {
    if (this.browserDisconnectHandler) {
      return;
    }
    this.browserDisconnectHandler = () => {
      this.invalidateBrowserState();
    };
    browser.on("disconnected", this.browserDisconnectHandler);
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = this.launchBrowser().then((browser) => {
        this.attachBrowserDisconnectHandler(browser);
        return browser;
      });
    }

    try {
      return await this.browserPromise;
    } catch (error) {
      this.browserPromise = null;
      throw error;
    }
  }

  private isBrowserClosedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("has been closed");
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
    return this.createSessionWithRetry(false);
  }

  private async createSessionWithRetry(
    isRetry: boolean,
  ): Promise<RuntimeSession> {
    const browser = await this.getBrowser();
    let context: BrowserContext;
    try {
      context = await browser.newContext();
    } catch (error) {
      if (!isRetry && this.isBrowserClosedError(error)) {
        this.invalidateBrowserState();
        return this.createSessionWithRetry(true);
      }
      this.invalidateBrowserState();
      throw mapPlaywrightLaunchError(error);
    }

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
      if (!isRetry && this.isBrowserClosedError(error)) {
        this.invalidateBrowserState();
        return this.createSessionWithRetry(true);
      }
      this.invalidateBrowserState();
      throw mapPlaywrightLaunchError(error);
    }
  }

  async navigate(command: NavigateCommand): Promise<ActionResult> {
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
