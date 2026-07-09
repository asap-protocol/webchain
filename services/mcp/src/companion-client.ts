import {
  CompanionApiErrorBodySchema,
  CompanionCommandSuccessSchema,
  type RuntimeCommand,
  type RuntimeErrorCode,
  SessionCreatedResponseSchema,
  type SessionLifecycleEvent,
  type TraceContext,
} from "@webchain/protocol";

export type CompanionHttpClientOptions = {
  /** Base URL without trailing slash, e.g. `http://127.0.0.1:8787` */
  baseUrl: string;
  /** Must match companion `WEBCHAIN_LOCAL_TOKEN`. */
  token: string;
};

export class CompanionHttpError extends Error {
  readonly status: number;
  readonly trace?: TraceContext;
  readonly code?: RuntimeErrorCode;
  readonly lifecycle?: SessionLifecycleEvent;

  constructor(
    message: string,
    options: {
      status: number;
      trace?: TraceContext;
      code?: RuntimeErrorCode;
      lifecycle?: SessionLifecycleEvent;
    },
  ) {
    super(message);
    this.name = "CompanionHttpError";
    this.status = options.status;
    this.trace = options.trace;
    this.code = options.code;
    this.lifecycle = options.lifecycle;
  }
}

export class CompanionHttpClient {
  constructor(private readonly options: CompanionHttpClientOptions) {}

  private base(): string {
    return this.options.baseUrl.replace(/\/$/, "");
  }

  async checkHealth(): Promise<void> {
    const response = await fetch(`${this.base()}/health`);
    if (!response.ok) {
      throw new CompanionHttpError(
        `Companion /health returned ${response.status}`,
        {
          status: response.status,
        },
      );
    }
  }

  async createSession() {
    const response = await fetch(`${this.base()}/sessions`, {
      method: "POST",
      headers: {
        "x-webchain-token": this.options.token,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw parseCompanionFailure(response.status, text);
    }
    return SessionCreatedResponseSchema.parse(JSON.parse(text));
  }

  async postCommand(command: RuntimeCommand) {
    const response = await fetch(`${this.base()}/commands`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webchain-token": this.options.token,
      },
      body: JSON.stringify(command),
    });
    const text = await response.text();
    if (!response.ok) {
      throw parseCompanionFailure(response.status, text);
    }
    return CompanionCommandSuccessSchema.parse(JSON.parse(text));
  }
}

function parseCompanionFailure(
  status: number,
  text: string,
): CompanionHttpError {
  try {
    const json: unknown = JSON.parse(text);
    const parsed = CompanionApiErrorBodySchema.safeParse(json);
    if (parsed.success) {
      return new CompanionHttpError(parsed.data.error, {
        status,
        trace: parsed.data.trace,
        code: parsed.data.code,
        lifecycle: parsed.data.lifecycle,
      });
    }
  } catch {
    // fall through
  }
  return new CompanionHttpError(
    `Companion request failed (${status}): ${text.slice(0, 500)}`,
    { status },
  );
}
