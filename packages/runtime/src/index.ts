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
  /**
   * Upper bound for CDP calls that can wedge after a renderer crash
   * (Playwright's own timeouts do not always fire when the page process is dead).
   */
  pageCommandTimeoutMs?: number;
}

type SessionRecord = {
  context: BrowserContext;
  page: Page;
  pageId: string;
  /** Set when Playwright emits `page` crash or a wedged CDP call times out. */
  pageCrashed: boolean;
};

/** Default budget for snapshot CDP reads after which we fail instead of hanging. */
export const DEFAULT_PAGE_COMMAND_TIMEOUT_MS = 15_000;

export class BrowserRuntime {
  private browserPromise: Promise<Browser> | null = null;
  private sessions = new Map<string, SessionRecord>();
  private readonly pageCommandTimeoutMs: number;

  constructor(private readonly options: BrowserRuntimeOptions = {}) {
    this.pageCommandTimeoutMs =
      options.pageCommandTimeoutMs ?? DEFAULT_PAGE_COMMAND_TIMEOUT_MS;
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
    const browser = await this.getBrowser();
    const context = await browser.newContext();

    try {
      const page = await context.newPage();
      const sessionId = randomUUID();
      const pageId = randomUUID();

      const record: SessionRecord = {
        context,
        page,
        pageId,
        pageCrashed: false,
      };
      page.on("crash", () => {
        record.pageCrashed = true;
      });
      this.sessions.set(sessionId, record);

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
    const session = this.getSession(command.sessionId);
    this.assertPageUsable(session);
    try {
      await session.page.goto(command.url, { waitUntil: "domcontentloaded" });
    } catch (error) {
      this.noteCrashFromError(session, error);
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
    this.assertPageUsable(session);
    try {
      const page = session.page;
      /**
       * After a renderer crash, Playwright's `page.content({ timeout })` may never
       * settle (CDP wedged). Race with a host timer so companion/MCP callers fail.
       */
      const html = await this.awaitPageCommand(
        session,
        page.content(),
        "page.content",
      );
      /** Covers sync throws (some Playwright APIs throw before returning a Promise). */
      const safe = async <T>(run: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await this.awaitPageCommand(session, run(), "snapshot-aux");
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
        title: await this.awaitPageCommand(session, page.title(), "page.title"),
        htmlSnippet: summarizeHtml(html),
        domSummary,
        accessibilityTree: accessibilityJson,
        links,
        landmarks,
      };
    } catch (error) {
      this.noteCrashFromError(session, error);
      throw mapCommandFailure(error);
    }
  }

  async click(command: ClickCommand): Promise<ActionResult> {
    const session = this.getSession(command.sessionId);
    this.assertPageUsable(session);
    try {
      await session.page.locator(command.selector).first().click();
    } catch (error) {
      this.noteCrashFromError(session, error);
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
    this.assertPageUsable(session);
    try {
      await session.page.locator(command.selector).first().fill(command.text);
    } catch (error) {
      this.noteCrashFromError(session, error);
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

  private assertPageUsable(session: SessionRecord): void {
    if (session.pageCrashed) {
      throw new WebchainRuntimeError(
        "COMMAND_FAILED",
        "Page crashed; close this session and create a new one.",
      );
    }
  }

  private noteCrashFromError(session: SessionRecord, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Page crashed") ||
      message.includes("Target crashed") ||
      message.includes("page command timed out")
    ) {
      session.pageCrashed = true;
    }
  }

  private awaitPageCommand<T>(
    session: SessionRecord,
    operation: Promise<T>,
    label: string,
  ): Promise<T> {
    if (session.pageCrashed) {
      return Promise.reject(
        new WebchainRuntimeError(
          "COMMAND_FAILED",
          "Page crashed; close this session and create a new one.",
        ),
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        session.pageCrashed = true;
        reject(
          new WebchainRuntimeError(
            "COMMAND_FAILED",
            `Page command timed out after ${this.pageCommandTimeoutMs}ms (${label}); the page may have crashed.`,
          ),
        );
      }, this.pageCommandTimeoutMs);
    });

    return Promise.race([operation, timeout]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    });
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
