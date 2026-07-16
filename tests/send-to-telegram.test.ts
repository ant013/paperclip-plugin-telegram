import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import * as telegramApi from "../src/telegram-api.js";
import { resolveNotificationChatId, resolveTelegramOpsDestination, sendToTelegramTool } from "../src/worker.js";

function stateKey(key: { scopeKind: string; scopeId?: string; stateKey: string }): string {
  return `${key.scopeKind}:${key.scopeId ?? ""}:${key.stateKey}`;
}

let stateStore: Record<string, unknown> = {};
let metricWrites: Array<{ name: string; value: number }> = [];

function createContext(
  fetchImpl: (
    input: string,
    options?: { method?: string; headers?: Record<string, string>; body?: unknown },
  ) => Promise<{ json: () => Promise<{ ok: boolean; description?: string; result?: { message_id: number } }> }>,
): PluginContext {
  return {
    state: {
      get: vi.fn(async (key: { scopeKind: string; scopeId?: string; stateKey: string }) =>
        stateStore[stateKey(key)] ?? null
      ),
      set: vi.fn(async (key: { scopeKind: string; scopeId?: string; stateKey: string }, value: unknown) => {
        stateStore[stateKey(key)] = value;
      }),
    },
    metrics: {
      write: vi.fn(async (name: string, value: number) => {
        metricWrites.push({ name, value });
      }),
    },
    activity: {
      log: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    http: {
      fetch: fetchImpl,
    },
  } as unknown as PluginContext;
}

type Config = Parameters<typeof sendToTelegramTool>[2];

type RunContext = Parameters<typeof sendToTelegramTool>[4];

const runCtx: RunContext = { companyId: "company-1", agentId: "agent-1" };

const defaultConfig: Config = {
  defaultChatId: "-1001",
  allowedTelegramChatIds: [],
};

const telRouteConfig: Config = {
  ...defaultConfig,
  fileRoutes: [
    { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002", topicId: "44" },
  ],
};

const wrongTypeRouteCases = ["projectKey", "issueIdentifier", "issueId"].flatMap((field) => [
  { field, kind: "number", value: 123 },
  { field, kind: "boolean", value: true },
  { field, kind: "array", value: ["TEL"] },
  { field, kind: "object", value: { value: "TEL" } },
]);

function expectNoTelegramCalls(): void {
  expect(telegramApi.sendMessage).not.toHaveBeenCalled();
  expect(telegramApi.sendDocument).not.toHaveBeenCalled();
}

function mockCalls(fn: unknown): unknown[][] {
  return (fn as { mock?: { calls?: unknown[][] } }).mock?.calls ?? [];
}

function serializedAuditOutput(ctx: PluginContext): string {
  return JSON.stringify([
    mockCalls(ctx.logger.info),
    mockCalls(ctx.logger.warn),
    mockCalls(ctx.logger.error),
    mockCalls(ctx.activity.log),
  ]);
}

async function runSendToTelegram(
  params: Record<string, unknown>,
  config: Config,
  ctx: PluginContext,
): Promise<Awaited<ReturnType<typeof sendToTelegramTool>>> {
  return sendToTelegramTool(ctx, "resolved-token", config, params, runCtx);
}

describe("sendToTelegramTool", () => {
  beforeEach(() => {
    stateStore = {};
    metricWrites = [];
    vi.spyOn(telegramApi, "sendMessage").mockResolvedValue(101);
    vi.spyOn(telegramApi, "sendDocument").mockResolvedValue(202);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends text-only messages with sendMessage", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram({ text: "hello world" }, defaultConfig, ctx);

    expect(result.data).toMatchObject({
      ok: true,
      mode: "message",
      chatId: "-1001",
      messageId: 101,
      routeSource: "legacy_fallback",
    });
    expect(result.data).toHaveProperty("mode", "message");
    expect(telegramApi.sendMessage).toHaveBeenCalledWith(
      ctx,
      "resolved-token",
      "-1001",
      "hello world",
      {
        parseMode: undefined,
        messageThreadId: undefined,
        replyToMessageId: undefined,
        disableNotification: false,
      },
    );
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("sends markdown content as a document", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram({ markdownContent: "# Report" }, defaultConfig, ctx);

    expect(result.data).toMatchObject({ ok: true, mode: "document", chatId: "-1001", messageId: 202 });
    expect(telegramApi.sendDocument).toHaveBeenCalledWith(
      ctx,
      "resolved-token",
      "-1001",
      "# Report",
      expect.objectContaining({
        filename: "paperclip-message.md",
        caption: undefined,
      }),
    );
  });

  it("sends markdown content with caption text", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        text: "Quarterly report",
        markdownContent: "# Quarterly\n\nPayload",
        markdownFileName: "q1-report.md",
      },
      defaultConfig,
      ctx,
    );

    expect(result.data).toMatchObject({ ok: true, mode: "document", chatId: "-1001", messageId: 202 });
    expect(telegramApi.sendDocument).toHaveBeenCalledWith(
      ctx,
      "resolved-token",
      "-1001",
      "# Quarterly\n\nPayload",
      expect.objectContaining({
        filename: "q1-report.md",
        caption: "Quarterly report",
      }),
    );
  });

  it("routes markdown documents by explicit projectKey without requiring the explicit-chat allowlist", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# TEL Report",
        projectKey: "TEL",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002", topicId: "44" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode: "document",
      chatId: "-2002",
      threadId: 44,
      routeSource: "file_route",
      routeName: "TEL files",
      projectKey: "TEL",
      messageId: 202,
    });
    expect(telegramApi.sendDocument).toHaveBeenCalledWith(
      ctx,
      "resolved-token",
      "-2002",
      "# TEL Report",
      expect.objectContaining({
        messageThreadId: 44,
      }),
    );
  });

  it("routes markdown documents by issueIdentifier project prefix", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# TEST Report",
        issueIdentifier: "TEST-12",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" },
          { name: "TEST files", enabled: true, projectKey: "TEST", chatId: "-3003", topicId: "9" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode: "document",
      chatId: "-3003",
      threadId: 9,
      routeSource: "file_route",
      routeName: "TEST files",
      projectKey: "TEST",
      issueIdentifier: "TEST-12",
    });
  });

  it("resolves issueId within the current company before routing markdown documents", async () => {
    const ctx = {
      ...createContext(async () => ({ ok: true }) as Response),
      issues: {
        get: vi.fn(async (issueId: string, companyId: string) => ({
          id: issueId,
          companyId,
          identifier: "TEL-23",
          title: "Route files",
        })),
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      {
        markdownContent: "# Issue Report",
        issueId: "issue-23",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" },
        ],
      },
      ctx,
    );

    expect(ctx.issues.get).toHaveBeenCalledWith("issue-23", "company-1");
    expect(result.data).toMatchObject({
      ok: true,
      chatId: "-2002",
      routeSource: "file_route",
      projectKey: "TEL",
      issueIdentifier: "TEL-23",
    });
  });

  it("rejects route-aware markdown when issueId cannot be resolved even with projectKey", async () => {
    const ctx = {
      ...createContext(async () => ({ ok: true }) as Response),
      issues: {
        get: vi.fn(async () => null),
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      {
        markdownContent: "# Issue Report",
        issueId: "foreign-issue",
        projectKey: "TEL",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" },
        ],
      },
      ctx,
    );

    expect(ctx.issues.get).toHaveBeenCalledWith("foreign-issue", "company-1");
    expect(result.data).toMatchObject({
      ok: false,
      code: "unresolved_issue",
    });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("fails closed when route-aware markdown has no matching project route", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# OPS Report",
        issueIdentifier: "OPS-1",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: false,
      code: "unknown_project_route",
      projectKey: "OPS",
      issueIdentifier: "OPS-1",
    });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
    expect(telegramApi.sendMessage).not.toHaveBeenCalled();
  });

  it("fails closed when duplicate enabled routes match the same project key", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# TEL Report",
        issueIdentifier: "TEL-23",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files A", enabled: true, projectKey: "TEL", chatId: "-2002" },
          { name: "TEL files B", enabled: true, projectKey: "TEL", chatId: "-3003" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: false,
      code: "ambiguous_route",
      projectKey: "TEL",
    });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("fails closed when an enabled file route has invalid config", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# TEL Report",
        projectKey: "TEL",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "not-a-chat" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: false,
      code: "invalid_route_config",
      projectKey: "TEL",
    });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("ignores disabled invalid routes and uses the enabled matching route", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# TEL Report",
        projectKey: "TEL",
      },
      {
        ...defaultConfig,
        fileRoutes: [
          { name: "", enabled: false, projectKey: "", chatId: "not-a-chat", topicId: "bad" },
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({ ok: true, chatId: "-2002", routeSource: "file_route" });
    expect(telegramApi.sendDocument).toHaveBeenCalledTimes(1);
  });

  it("rejects route-aware markdown mixed with explicit destination fields", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const withChatId = await runSendToTelegram(
      {
        markdownContent: "# TEL Report",
        projectKey: "TEL",
        chatId: "-1001",
      },
      {
        ...defaultConfig,
        allowedTelegramChatIds: ["-1001"],
        fileRoutes: [{ name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" }],
      },
      ctx,
    );
    const withThreadId = await runSendToTelegram(
      {
        markdownContent: "# TEL Report",
        projectKey: "TEL",
        threadId: 5,
      },
      {
        ...defaultConfig,
        fileRoutes: [{ name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-2002" }],
      },
      ctx,
    );

    expect(withChatId.data).toMatchObject({ ok: false, code: "conflicting_destination" });
    expect(withThreadId.data).toMatchObject({ ok: false, code: "conflicting_destination" });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("keeps explicit chatId and threadId compatibility for markdown documents", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# Explicit Report",
        chatId: "-2002",
        threadId: 77,
      },
      {
        ...defaultConfig,
        allowedTelegramChatIds: ["-2002"],
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "-3003", topicId: "9" },
        ],
      },
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode: "document",
      chatId: "-2002",
      threadId: 77,
      routeSource: "explicit",
    });
  });

  it("routes text-only sends by projectKey and returns route metadata", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        text: "hello TEL",
        projectKey: "tel",
      },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode: "message",
      chatId: "-2002",
      threadId: 44,
      routeSource: "file_route",
      routeName: "TEL files",
      projectKey: "TEL",
      messageId: 101,
    });
    expect(telegramApi.sendMessage).toHaveBeenCalledWith(
      ctx,
      "resolved-token",
      "-2002",
      "hello TEL",
      expect.objectContaining({ messageThreadId: 44 }),
    );
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("routes text-only sends by issueIdentifier", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      { text: "hello TEL issue", issueIdentifier: "tel-23" },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode: "message",
      chatId: "-2002",
      threadId: 44,
      routeSource: "file_route",
      routeName: "TEL files",
      projectKey: "TEL",
      issueIdentifier: "TEL-23",
      messageId: 101,
    });
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("resolves issueId within the current company before routing text-only sends", async () => {
    const ctx = {
      ...createContext(async () => ({ ok: true }) as Response),
      issues: {
        get: vi.fn(async (issueId: string, companyId: string) => ({
          id: issueId,
          companyId,
          identifier: "TEL-23",
          title: "Route text",
        })),
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      { text: "hello resolved issue", issueId: "issue-23" },
      telRouteConfig,
      ctx,
    );

    expect(ctx.issues.get).toHaveBeenCalledWith("issue-23", "company-1");
    expect(result.data).toMatchObject({
      ok: true,
      mode: "message",
      chatId: "-2002",
      routeSource: "file_route",
      routeName: "TEL files",
      projectKey: "TEL",
      issueIdentifier: "TEL-23",
    });
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it.each([
    { label: "text", content: { text: "agreeing text route" }, mode: "message" },
    { label: "document", content: { markdownContent: "# Agreeing route" }, mode: "document" },
  ])("accepts agreeing multi-field route context for $label", async ({ content, mode }) => {
    const ctx = {
      ...createContext(async () => ({ ok: true }) as Response),
      issues: {
        get: vi.fn(async (issueId: string, companyId: string) => ({
          id: issueId,
          companyId,
          identifier: "TEL-23",
          title: "Agreeing route",
        })),
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      {
        ...content,
        projectKey: "tel",
        issueIdentifier: "tel-23",
        issueId: "issue-23",
      },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode,
      chatId: "-2002",
      routeSource: "file_route",
      routeName: "TEL files",
      projectKey: "TEL",
      issueIdentifier: "TEL-23",
    });
    expect(ctx.issues.get).toHaveBeenCalledWith("issue-23", "company-1");
    if (mode === "message") {
      expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(telegramApi.sendDocument).not.toHaveBeenCalled();
    } else {
      expect(telegramApi.sendDocument).toHaveBeenCalledTimes(1);
      expect(telegramApi.sendMessage).not.toHaveBeenCalled();
    }
  });

  it.each([
    { label: "text", content: { text: "conflicting text route" } },
    { label: "document", content: { markdownContent: "# Conflicting route" } },
  ])("rejects conflicting projectKey and issueIdentifier for $label", async ({ content }) => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      { ...content, projectKey: "TEL", issueIdentifier: "OPS-1" },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({ ok: false, code: "conflicting_route_context" });
    expectNoTelegramCalls();
  });

  it("rejects an explicit issueIdentifier that disagrees with resolved issueId", async () => {
    const ctx = {
      ...createContext(async () => ({ ok: true }) as Response),
      issues: {
        get: vi.fn(async (issueId: string, companyId: string) => ({
          id: issueId,
          companyId,
          identifier: "TEL-23",
          title: "Conflicting route",
        })),
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      {
        text: "conflicting issue ids",
        issueId: "issue-23",
        issueIdentifier: "TEL-24",
      },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({ ok: false, code: "conflicting_route_context" });
    expect(ctx.issues.get).toHaveBeenCalledWith("issue-23", "company-1");
    expectNoTelegramCalls();
  });

  it.each(wrongTypeRouteCases)(
    "rejects wrong-type route context: $field ($kind)",
    async ({ field, value }) => {
      const ctx = createContext(async () => ({ ok: true }) as Response);
      const result = await runSendToTelegram(
        { text: "wrong type route", [field]: value },
        telRouteConfig,
        ctx,
      );

      expect(result.data).toMatchObject({
        ok: false,
        code: "invalid_route_context",
        invalidField: field,
      });
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "Telegram agent send routing decision",
        expect.objectContaining({
          contentMode: "message",
          errorCode: "invalid_route_context",
          invalidField: field,
        }),
      );
      expectNoTelegramCalls();
    },
  );

  it.each(["projectKey", "issueIdentifier", "issueId"])(
    "rejects and redacts oversized %s",
    async (field) => {
      const marker = `SECRET_OVERSIZED_${field}`;
      const ctx = createContext(async () => ({ ok: true }) as Response);
      const result = await runSendToTelegram(
        { text: "oversized route", [field]: `${marker}${"X".repeat(256)}` },
        telRouteConfig,
        ctx,
      );

      expect(result.data).toMatchObject({
        ok: false,
        code: "invalid_route_context",
        invalidField: field,
      });
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "Telegram agent send routing decision",
        expect.objectContaining({
          contentMode: "message",
          errorCode: "invalid_route_context",
          invalidField: field,
        }),
      );
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(serializedAuditOutput(ctx)).not.toContain(marker);
      expectNoTelegramCalls();
    },
  );

  it.each(["projectKey", "issueIdentifier", "issueId"])(
    "rejects and redacts control characters in %s",
    async (field) => {
      const marker = `SECRET_CONTROL_${field}`;
      const ctx = createContext(async () => ({ ok: true }) as Response);
      const result = await runSendToTelegram(
        { text: "control route", [field]: `TEL\n${marker}` },
        telRouteConfig,
        ctx,
      );

      expect(result.data).toMatchObject({
        ok: false,
        code: "invalid_route_context",
        invalidField: field,
      });
      expect(ctx.logger.info).toHaveBeenCalledWith(
        "Telegram agent send routing decision",
        expect.objectContaining({
          contentMode: "message",
          errorCode: "invalid_route_context",
          invalidField: field,
        }),
      );
      expect(JSON.stringify(result)).not.toContain(marker);
      expect(serializedAuditOutput(ctx)).not.toContain(marker);
      expectNoTelegramCalls();
    },
  );

  it.each([
    { field: "chatId", value: { raw: "chat" } },
    { field: "chatId", value: 123 },
    { field: "threadId", value: "not-a-thread" },
    { field: "threadId", value: { raw: "thread" } },
  ])("rejects valid route context mixed with raw explicit $field intent", async ({ field, value }) => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      { text: "mixed destination", projectKey: "TEL", [field]: value },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({ ok: false, code: "conflicting_destination" });
    expectNoTelegramCalls();
  });

  it("checks mixed-destination conflict before resolving issueId", async () => {
    const ctx = {
      ...createContext(async () => ({ ok: true }) as Response),
      issues: {
        get: vi.fn(async () => null),
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      { text: "mixed unresolved issue", issueId: "missing-issue", chatId: "-1001" },
      { ...telRouteConfig, allowedTelegramChatIds: ["-1001"] },
      ctx,
    );

    expect(result.data).toMatchObject({ ok: false, code: "conflicting_destination" });
    expect(ctx.issues.get).not.toHaveBeenCalled();
    expectNoTelegramCalls();
  });

  it("reports malformed route context before mixed-destination conflict", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      { text: "invalid route first", projectKey: "TEL!", threadId: 44 },
      telRouteConfig,
      ctx,
    );

    expect(result.data).toMatchObject({ ok: false, code: "invalid_route_context" });
    expectNoTelegramCalls();
  });

  it.each([
    {
      label: "unknown route",
      params: { text: "unknown route", issueIdentifier: "OPS-1" },
      config: telRouteConfig,
      code: "unknown_project_route",
    },
    {
      label: "ambiguous route",
      params: { text: "ambiguous route", projectKey: "TEL" },
      config: {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL A", enabled: true, projectKey: "TEL", chatId: "-2002" },
          { name: "TEL B", enabled: true, projectKey: "TEL", chatId: "-3003" },
        ],
      },
      code: "ambiguous_route",
    },
    {
      label: "invalid route config",
      params: { text: "invalid config", projectKey: "TEL" },
      config: {
        ...defaultConfig,
        fileRoutes: [
          { name: "TEL files", enabled: true, projectKey: "TEL", chatId: "not-a-chat" },
        ],
      },
      code: "invalid_route_config",
    },
  ])("fails closed for text-only $label", async ({ params, config, code }) => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(params, config, ctx);

    expect(result.data).toMatchObject({ ok: false, code });
    expectNoTelegramCalls();
  });

  it("rejects explicit disallowed chat ids before Telegram API calls", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        text: "hello",
        chatId: "-2002",
      },
      {
        ...defaultConfig,
        allowedTelegramChatIds: ["-1001"],
      },
      ctx,
    );

    expect(result.data).toEqual({
      ok: false,
      code: "disallowed_chat",
      message: "Telegram chat is not allowed for agent outbound delivery.",
    });
    expect(telegramApi.sendMessage).not.toHaveBeenCalled();
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects explicit chatId when allowlist is empty but allows default chat when omitted", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);

    const rejected = await runSendToTelegram(
      {
        text: "hello",
        chatId: "-2002",
      },
      defaultConfig,
      ctx,
    );
    expect(rejected.data).toEqual({
      ok: false,
      code: "disallowed_chat",
      message: "Explicit Telegram chat IDs are not allowed.",
    });

    const allowed = await runSendToTelegram(
      {
        text: "hello",
      },
      defaultConfig,
      ctx,
    );
    expect(allowed.data).toMatchObject({ ok: true, mode: "message", chatId: "-1001", messageId: 101 });
    expect(telegramApi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects non-md markdown filenames", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# Report",
        markdownFileName: "report.txt",
      },
      defaultConfig,
      ctx,
    );

    expect(result.data).toEqual({
      ok: false,
      code: "non_markdown_file",
      message: "Markdown file uploads must use a .md extension.",
    });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it.each([
    "../report.md",
    "..\\report.md",
    "a/report.md",
    "a\\report.md",
    "C:report.md",
  ])("rejects unsafe markdown filenames: %s", async (name) => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# Report",
        markdownFileName: name,
      },
      defaultConfig,
      ctx,
    );

    expect(result.data).toMatchObject({ ok: false });
    expect(result.data.code).toBe("invalid_markdown_filename");
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it.each([".env.md", "secret-report.md", "my_token.md", "private-key.md"]) (
    "rejects unsafe/bad markdown filename: %s",
    async (name) => {
      const ctx = createContext(async () => ({ ok: true }) as Response);
      const result = await runSendToTelegram(
        {
          markdownContent: "# Report",
          markdownFileName: name,
        },
        defaultConfig,
        ctx,
      );

      expect(result.data).toMatchObject({ ok: false, code: "unsafe_filename" });
      expect(telegramApi.sendDocument).not.toHaveBeenCalled();
    },
  );

  it.each([
    "path",
    "filePath",
    "url",
    "fileUrl",
    "fileURL",
    "uri",
    "fileUri",
    "telegramFileId",
    "telegram_file_id",
    "file_id",
    "file",
    "files",
    "binary",
    "binaryContent",
    "fileContent",
    "content",
  ])("rejects unsupported markdown source fields: %s", async (field) => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const result = await runSendToTelegram(
      {
        markdownContent: "# Report",
        [field]: "/tmp/report.md",
      },
      defaultConfig,
      ctx,
    );

    expect(result.data).toEqual({
      ok: false,
      code: "unsupported_file_source",
      message: "Only text and markdownContent are supported.",
    });
    expect(telegramApi.sendMessage).not.toHaveBeenCalled();
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("rejects oversized markdown before Telegram API send", async () => {
    const ctx = createContext(async () => ({ ok: true }) as Response);
    const markdown = "x".repeat(256 * 1024 + 1);

    const result = await runSendToTelegram({ markdownContent: markdown }, defaultConfig, ctx);

    expect(result.data).toEqual({
      ok: false,
      code: "markdown_too_large",
      message: "Markdown content exceeds size limits.",
    });
    expect(telegramApi.sendDocument).not.toHaveBeenCalled();
  });

  it("surfaces Telegram failure as structured error and counts failure metric", async () => {
    vi.restoreAllMocks();

    const ctx = createContext(async () => ({
      json: async () => ({ ok: false, description: "Telegram API down" }),
    }) as unknown as Response);

    const result = await runSendToTelegram({ markdownContent: "# Report" }, defaultConfig, ctx);

    expect(result.data).toEqual({
      ok: false,
      code: "telegram_send_failed",
      message: "Telegram send failed.",
    });
    expect(metricWrites.some((metric) => metric.name === "telegram_notification_failures" && metric.value === 1)).toBe(true);
  });

  it("surfaces Telegram text failure as structured error and counts failure metric", async () => {
    vi.restoreAllMocks();

    const ctx = createContext(async () => ({
      json: async () => ({ ok: false, description: "Telegram API down" }),
    }) as unknown as Response);

    const result = await runSendToTelegram({ text: "hello" }, defaultConfig, ctx);

    expect(result.data).toEqual({
      ok: false,
      code: "telegram_send_failed",
      message: "Telegram send failed.",
    });
    expect(metricWrites.some((metric) => metric.name === "telegram_notification_failures" && metric.value === 1)).toBe(true);
  });

  it("smoke: generates a markdown file and sends it as Telegram document", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "paperclip-telegram-smoke-"));
    const filePath = join(tmpDir, "agent-report.md");
    const markdownContent = "# Smoke Report\n\nGenerated by QA automation.";
    writeFileSync(filePath, markdownContent, "utf8");

    vi.restoreAllMocks();
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ ok: true, result: { message_id: 303 } }),
    }));
    const ctx = {
      state: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
      },
      metrics: {
        write: vi.fn(async () => {}),
      },
      activity: {
        log: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      http: {
        fetch: fetchMock,
      },
    } as unknown as PluginContext;

    const result = await runSendToTelegram(
      {
        text: "Smoke test output",
        markdownContent: readFileSync(filePath, "utf8"),
        markdownFileName: "agent-report.md",
      },
      defaultConfig,
      ctx,
    );

    expect(result.data).toMatchObject({
      ok: true,
      mode: "document",
      chatId: "-1001",
      messageId: 303,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botresolved-token/sendDocument",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = fetchMock.mock.calls[0]![1]!.body as FormData;
    const document = requestBody.get("document") as Blob;
    const sentText = await document.text();
    expect(sentText).toBe(markdownContent);
    expect(requestBody.get("chat_id")).toBe("-1001");
    expect(requestBody.get("caption")).toBe("Smoke test output");
  });
});

describe("resolveNotificationChatId", () => {
  beforeEach(() => {
    stateStore = {};
  });

  it("honors explicit notification chat routes before company mappings", async () => {
    stateStore[stateKey({ scopeKind: "company", scopeId: "company-1", stateKey: "telegram-chat" })] = "-main";
    const ctx = createContext(async () => ({ ok: true }) as Response);

    const chatId = await resolveNotificationChatId(ctx, "company-1", "-default", "-ops");

    expect(chatId).toBe("-ops");
  });

  it("falls back to company mapping when no explicit route is configured", async () => {
    stateStore[stateKey({ scopeKind: "company", scopeId: "company-1", stateKey: "telegram-chat" })] = "-main";
    const ctx = createContext(async () => ({ ok: true }) as Response);

    const chatId = await resolveNotificationChatId(ctx, "company-1", "-default");

    expect(chatId).toBe("-main");
  });
});

describe("resolveTelegramOpsDestination", () => {
  it("routes operational notifications by company id", () => {
    const destination = resolveTelegramOpsDestination(
      [
        { name: "Gimle Ops", enabled: true, companyId: "gimle-company", chatId: "-1001", topicId: "10" },
        { name: "TG Ops", enabled: true, companyId: "tg-company", chatId: "-1002" },
      ],
      "tg-company",
    );

    expect(destination).toEqual({
      chatId: "-1002",
      routeName: "TG Ops",
      topicId: undefined,
    });
  });

  it("routes operational notifications by company name when company id is absent", () => {
    const destination = resolveTelegramOpsDestination(
      [
        { name: "Gimle Ops", enabled: true, companyName: "Gimle", chatId: "-1001" },
      ],
      "unknown-company-id",
      "gimle",
    );

    expect(destination).toMatchObject({ chatId: "-1001", routeName: "Gimle Ops" });
  });

  it("ignores disabled or incomplete operational routes", () => {
    const destination = resolveTelegramOpsDestination(
      [
        { name: "Disabled", enabled: false, companyId: "company-1", chatId: "-1001" },
        { name: "Missing chat", enabled: true, companyId: "company-1" },
      ],
      "company-1",
    );

    expect(destination).toBeNull();
  });
});
