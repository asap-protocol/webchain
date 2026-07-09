import { z } from "zod";

export const RUNTIME_ACTIONS = [
  "navigate",
  "snapshot",
  "click",
  "type",
  "closeSession",
] as const;

export type RuntimeAction = (typeof RUNTIME_ACTIONS)[number];

export const NavigateCommandSchema = z.object({
  action: z.literal("navigate"),
  sessionId: z.string().min(1),
  url: z.string().url(),
});

export const SnapshotCommandSchema = z.object({
  action: z.literal("snapshot"),
  sessionId: z.string().min(1),
});

export const ClickCommandSchema = z.object({
  action: z.literal("click"),
  sessionId: z.string().min(1),
  selector: z.string().min(1),
});

export const TypeCommandSchema = z.object({
  action: z.literal("type"),
  sessionId: z.string().min(1),
  selector: z.string().min(1),
  text: z.string(),
});

export const CloseSessionCommandSchema = z.object({
  action: z.literal("closeSession"),
  sessionId: z.string().min(1),
});

export const RuntimeCommandSchema = z.discriminatedUnion("action", [
  NavigateCommandSchema,
  SnapshotCommandSchema,
  ClickCommandSchema,
  TypeCommandSchema,
  CloseSessionCommandSchema,
]);

export type NavigateCommand = z.infer<typeof NavigateCommandSchema>;
export type SnapshotCommand = z.infer<typeof SnapshotCommandSchema>;
export type ClickCommand = z.infer<typeof ClickCommandSchema>;
export type TypeCommand = z.infer<typeof TypeCommandSchema>;
export type CloseSessionCommand = z.infer<typeof CloseSessionCommandSchema>;
export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>;

/** MCP / HTTP args aligned with navigate when the `action` discriminant is implicit. */
export const NavigateArgsSchema = NavigateCommandSchema.omit({ action: true });

/** MCP / HTTP args for tools that only need `sessionId` (e.g. snapshot, close_session). */
export const SessionIdArgsSchema = SnapshotCommandSchema.omit({ action: true });

/** MCP args for `click` / `type` tools (no `action` discriminant). */
export const ClickArgsSchema = ClickCommandSchema.omit({ action: true });
export const TypeArgsSchema = TypeCommandSchema.omit({ action: true });

export type NavigateArgs = z.infer<typeof NavigateArgsSchema>;
export type SessionIdArgs = z.infer<typeof SessionIdArgsSchema>;
export type ClickArgs = z.infer<typeof ClickArgsSchema>;
export type TypeArgs = z.infer<typeof TypeArgsSchema>;

export const SessionCreatedSchema = z.object({
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type RuntimeSession = z.infer<typeof SessionCreatedSchema>;

/** Optional layered fields (ADR-0002); `htmlSnippet` remains for Phase 1 compatibility. */
export const SnapshotResultSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  htmlSnippet: z.string(),
  domSummary: z.string().optional(),
  /** Playwright accessibility tree (JSON-serializable). */
  accessibilityTree: z.unknown().optional(),
  links: z
    .array(
      z.object({
        href: z.string(),
        text: z.string(),
      }),
    )
    .max(80)
    .optional(),
  landmarks: z
    .array(
      z.object({
        role: z.string(),
        name: z.string().optional(),
      }),
    )
    .max(32)
    .optional(),
  traceId: z.string().uuid().optional(),
});

export const ActionResultSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  traceId: z.string().uuid().optional(),
});

export const CloseSessionResultSchema = z.object({
  sessionId: z.string().min(1),
  closed: z.literal(true),
  traceId: z.string().uuid().optional(),
});

export const CompanionHealthSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("webchain-companion"),
  version: z.string(),
  capabilities: z.array(z.enum(RUNTIME_ACTIONS)),
});

export type SnapshotResult = z.infer<typeof SnapshotResultSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type CloseSessionResult = z.infer<typeof CloseSessionResultSchema>;
export type CompanionHealth = z.infer<typeof CompanionHealthSchema>;

/** Stable codes for runtime failures surfaced to companion/MCP (FR6). */
export const RuntimeErrorCodeSchema = z.enum([
  "BROWSER_NOT_INSTALLED",
  "BROWSER_LAUNCH_FAILED",
  "SESSION_NOT_FOUND",
  "COMMAND_FAILED",
  /** Companion HTTP body validation on `/commands`. */
  "INVALID_COMMAND_BODY",
  /** MCP tool argument validation only. */
  "INVALID_TOOL_INPUT",
]);

export type RuntimeErrorCode = z.infer<typeof RuntimeErrorCodeSchema>;

/** HTTP JSON body for companion command/session errors when a code is available. */
export const CompanionRuntimeErrorBodySchema = z
  .object({
    error: z.string(),
    code: RuntimeErrorCodeSchema,
  })
  .strict();

export type CompanionRuntimeErrorBody = z.infer<
  typeof CompanionRuntimeErrorBodySchema
>;

/** Correlates logs and HTTP error responses for `/sessions` and `/commands` (FR6). */
export const TraceContextSchema = z.object({
  traceId: z.string().uuid(),
  runId: z.string().uuid(),
  createdAt: z.string(),
});

export type TraceContext = z.infer<typeof TraceContextSchema>;

/** Structured lifecycle signal for operators (companion / MCP); optional in Phase 2. */
export const SessionLifecycleEventSchema = z
  .object({
    kind: z.enum(["session_created", "session_closed", "command_error"]),
    traceId: z.string().uuid(),
    sessionId: z.string().optional(),
    code: RuntimeErrorCodeSchema.optional(),
  })
  .strict();

export type SessionLifecycleEvent = z.infer<typeof SessionLifecycleEventSchema>;

export function commandErrorLifecycle(
  traceId: string,
  code?: RuntimeErrorCode,
): SessionLifecycleEvent {
  return SessionLifecycleEventSchema.parse({
    kind: "command_error",
    traceId,
    ...(code !== undefined ? { code } : {}),
  });
}

export function sessionCreatedLifecycle(
  traceId: string,
  sessionId: string,
): SessionLifecycleEvent {
  return SessionLifecycleEventSchema.parse({
    kind: "session_created",
    traceId,
    sessionId,
  });
}

export function sessionClosedLifecycle(
  traceId: string,
  sessionId: string,
): SessionLifecycleEvent {
  return SessionLifecycleEventSchema.parse({
    kind: "session_closed",
    traceId,
    sessionId,
  });
}

/** `POST /sessions` success body: session plus correlation trace (Phase 2). */
export const SessionCreatedResponseSchema = SessionCreatedSchema.extend({
  trace: TraceContextSchema,
  lifecycle: SessionLifecycleEventSchema.optional(),
});

export type SessionCreatedResponse = z.infer<
  typeof SessionCreatedResponseSchema
>;

/**
 * JSON body for companion API errors on `/sessions` and `/commands`.
 * `code` is set when the runtime classified the failure; generic failures omit it.
 */
export const CompanionApiErrorBodySchema = z
  .object({
    error: z.string(),
    trace: TraceContextSchema,
    code: RuntimeErrorCodeSchema.optional(),
    details: z.unknown().optional(),
    lifecycle: SessionLifecycleEventSchema.optional(),
  })
  .strict();

export type CompanionApiErrorBody = z.infer<typeof CompanionApiErrorBodySchema>;

/** MCP `tools/call` error envelope when `isError` is set. */
export const McpToolErrorEnvelopeSchema = z
  .object({
    error: z.string(),
    code: RuntimeErrorCodeSchema.optional(),
    trace: TraceContextSchema.optional(),
    validation: z.unknown().optional(),
    lifecycle: SessionLifecycleEventSchema.optional(),
  })
  .strict();

export type McpToolErrorEnvelope = z.infer<typeof McpToolErrorEnvelopeSchema>;

export function createTraceContext(): TraceContext {
  return TraceContextSchema.parse({
    traceId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
}

export function isMutationCommand(command: RuntimeCommand) {
  return command.action === "click" || command.action === "type";
}

/** Successful `POST /commands` body shape from companion. */
export const CompanionCommandSuccessSchema = z
  .object({
    trace: TraceContextSchema,
    result: z.unknown(),
    lifecycle: SessionLifecycleEventSchema.optional(),
  })
  .strict();

export type CompanionCommandSuccess = z.infer<
  typeof CompanionCommandSuccessSchema
>;
