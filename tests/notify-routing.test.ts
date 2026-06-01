import { describe, it, expect, vi } from "vitest";
import { resolveNotificationDestination } from "../src/worker.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";

const GIMLE_COMPANY_ID = "9d8f432c-ff7d-4e3a-bbe3-3cd355f73b64";
const TEL_COMPANY_ID = "8810f36f-c9f1-4920-b9a1-d5f7a1db9484";
const UNS_COMPANY_ID = "8f55e80b-0264-4ab6-9d56-8b2652f18005";

const FILE_ROUTES = [
  { name: "Gimle files", projectKey: "GIM", chatId: "-1003995931017", topicId: "", enabled: true },
  { name: "TG files",    projectKey: "TEL", chatId: "-1003839195906", topicId: "", enabled: true },
  { name: "UAudit",      projectKey: "UNS", chatId: "-1003937871684", topicId: "", enabled: true },
];

const OPS_ROUTES = [
  { name: "Gimle Ops", companyId: GIMLE_COMPANY_ID, companyName: "Gimle", chatId: "-1003521772993", enabled: true },
  { name: "TG Ops",    companyId: TEL_COMPANY_ID,   companyName: "TelegramUpdate", chatId: "-1003978140493", enabled: true },
];

const DEFAULT_CHAT = "-1009999999999";

type ConfigOpts = {
  fileRoutes?: unknown;
  opsRoutes?: unknown;
  defaultChatId?: string;
};

function mockConfig(opts: ConfigOpts = {}): Record<string, unknown> {
  return {
    fileRoutes: opts.fileRoutes ?? FILE_ROUTES,
    opsRoutes: opts.opsRoutes ?? OPS_ROUTES,
    defaultChatId: opts.defaultChatId ?? DEFAULT_CHAT,
  };
}

function mockCtx(opts: {
  perCompanyChat?: string | null;
  companyName?: string | null;
  issueIdentifierFromId?: string | null;
} = {}): PluginContext {
  return {
    state: {
      get: vi.fn().mockResolvedValue(opts.perCompanyChat ?? null),
    },
    companies: {
      get: vi.fn().mockResolvedValue(opts.companyName ? { name: opts.companyName } : null),
    },
    issues: {
      get: vi.fn().mockResolvedValue(
        opts.issueIdentifierFromId ? { identifier: opts.issueIdentifierFromId } : null,
      ),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext;
}

function makeEvent(opts: {
  companyId?: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
} = {}): PluginEvent {
  return {
    companyId: opts.companyId ?? GIMLE_COMPANY_ID,
    eventType: opts.eventType ?? "issue.created",
    entityType: opts.entityType ?? "issue",
    entityId: opts.entityId ?? "issue-uuid-1",
    payload: opts.payload ?? { identifier: "GIM-272" },
  } as PluginEvent;
}

describe("resolveNotificationDestination", () => {
  describe("explicit override (top priority)", () => {
    it("uses overrideChatId regardless of classification", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent(),
        "important",
        "-1001111",
      );
      expect(dest).toEqual({ chatId: "-1001111", topicId: undefined, routeSource: "explicit" });
    });

    it("parses overrideTopicId when explicit chat is given", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent(),
        "important",
        "-1001111",
        "42",
      );
      expect(dest).toEqual({ chatId: "-1001111", topicId: 42, routeSource: "explicit" });
    });

    it("blank overrideChatId falls through", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent(),
        "important",
        "  ",
      );
      expect(dest?.routeSource).toBe("file_route");
    });
  });

  describe("important classification -> file_route", () => {
    it("routes GIM-* to Gimle files chat", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ payload: { identifier: "GIM-272" } }),
        "important",
      );
      expect(dest).toMatchObject({
        chatId: "-1003995931017",
        routeSource: "file_route",
        routeName: "Gimle files",
        projectKey: "GIM",
      });
    });

    it("routes TEL-* to TG files chat (different company)", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ companyId: TEL_COMPANY_ID, payload: { identifier: "TEL-26" } }),
        "important",
      );
      expect(dest?.chatId).toBe("-1003839195906");
      expect(dest?.routeSource).toBe("file_route");
      expect(dest?.projectKey).toBe("TEL");
    });

    it("reads identifier from payload.issueIdentifier when payload.identifier is absent", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ payload: { issueIdentifier: "UNS-99" }, companyId: UNS_COMPANY_ID }),
        "important",
      );
      expect(dest?.chatId).toBe("-1003937871684");
      expect(dest?.routeSource).toBe("file_route");
    });

    it("falls back to issues.get(entityId) when payload has no identifier", async () => {
      const ctx = mockCtx({ issueIdentifierFromId: "GIM-272" });
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ entityType: "issue", entityId: "uuid-of-issue", payload: {} }),
        "important",
      );
      expect(dest?.chatId).toBe("-1003995931017");
      expect(dest?.routeSource).toBe("file_route");
    });

    it("falls through to ops_route when no fileRoutes match the prefix", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ payload: { identifier: "ZZZ-1" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("ops_route");
      expect(dest?.chatId).toBe("-1003521772993");
    });

    it("falls through to ops_route when no identifier resolvable", async () => {
      const ctx = mockCtx({ issueIdentifierFromId: null });
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ payload: {} }),
        "important",
      );
      expect(dest?.routeSource).toBe("ops_route");
    });
  });

  describe("ops classification -> ops_route", () => {
    it("routes ops events by companyId UUID match", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ eventType: "agent.run.started" }),
        "ops",
      );
      expect(dest).toMatchObject({
        chatId: "-1003521772993",
        routeSource: "ops_route",
        routeName: "Gimle Ops",
      });
    });

    it("falls back to companyName match when direct companyId lookup fails", async () => {
      const ctx = mockCtx({ companyName: "TelegramUpdate" });
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          opsRoutes: [
            { name: "TG Ops", companyId: "", companyName: "TelegramUpdate", chatId: "-1003978140493", enabled: true },
          ],
        }) as never,
        makeEvent({ companyId: TEL_COMPANY_ID, eventType: "agent.run.finished" }),
        "ops",
      );
      expect(dest?.chatId).toBe("-1003978140493");
      expect(dest?.routeSource).toBe("ops_route");
    });

    it("falls through to legacy_fallback when no ops route matches", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({ opsRoutes: [] }) as never,
        makeEvent({ eventType: "agent.run.started" }),
        "ops",
      );
      expect(dest).toMatchObject({
        chatId: DEFAULT_CHAT,
        routeSource: "legacy_fallback",
      });
    });

    it("does not try fileRoutes for ops classification even with valid identifier", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig() as never,
        makeEvent({ eventType: "agent.run.started", payload: { identifier: "GIM-272" } }),
        "ops",
      );
      expect(dest?.routeSource).toBe("ops_route");
      expect(dest?.chatId).not.toBe("-1003995931017");
    });
  });

  describe("legacy_fallback", () => {
    it("uses per-company state override when no routes match", async () => {
      const ctx = mockCtx({ perCompanyChat: "-1007777777" });
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({ fileRoutes: [], opsRoutes: [] }) as never,
        makeEvent({ payload: { identifier: "GIM-272" } }),
        "important",
      );
      expect(dest).toMatchObject({ chatId: "-1007777777", routeSource: "legacy_fallback" });
    });

    it("uses defaultChatId when no per-company override either", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({ fileRoutes: [], opsRoutes: [] }) as never,
        makeEvent({ payload: { identifier: "GIM-272" } }),
        "important",
      );
      expect(dest).toMatchObject({ chatId: DEFAULT_CHAT, routeSource: "legacy_fallback" });
    });

    it("returns null when no defaultChatId and no routes match", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({ fileRoutes: [], opsRoutes: [], defaultChatId: "" }) as never,
        makeEvent({ payload: { identifier: "GIM-272" } }),
        "important",
      );
      expect(dest).toBeNull();
    });
  });

  describe("malformed config", () => {
    it("falls through to ops/legacy when fileRoutes is not an array", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({ fileRoutes: "garbage" as unknown }) as never,
        makeEvent({ payload: { identifier: "GIM-272" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("ops_route");
    });

    it("falls through when fileRoutes has invalid entries (validation fails)", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          fileRoutes: [
            { name: "Bad", projectKey: "GIM", chatId: "not-numeric", enabled: true },
          ],
        }) as never,
        makeEvent({ payload: { identifier: "GIM-272" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("ops_route");
    });
  });

  describe("sendImportant flag (per file-route)", () => {
    const UNS_OPS = {
      name: "UAudit Ops",
      companyId: UNS_COMPANY_ID,
      companyName: "UAudit",
      chatId: "-1003534905521",
      enabled: true,
    };

    it("diverts important events to ops_route when the matched file route has sendImportant=false", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          fileRoutes: [
            { name: "UAudit", projectKey: "UNS", chatId: "-1003937871684", enabled: true, sendImportant: false },
          ],
          opsRoutes: [UNS_OPS],
        }) as never,
        makeEvent({ companyId: UNS_COMPANY_ID, payload: { identifier: "UNS-99" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("ops_route");
      expect(dest?.chatId).toBe("-1003534905521");
    });

    it("falls through to legacy_fallback when sendImportant=false and no ops route matches", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          fileRoutes: [
            { name: "UAudit", projectKey: "UNS", chatId: "-1003937871684", enabled: true, sendImportant: false },
          ],
          opsRoutes: [],
        }) as never,
        makeEvent({ companyId: UNS_COMPANY_ID, payload: { identifier: "UNS-99" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("legacy_fallback");
      expect(dest?.chatId).toBe(DEFAULT_CHAT);
    });

    it("keeps important events on file_route when sendImportant=true (explicit)", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          fileRoutes: [
            { name: "UAudit", projectKey: "UNS", chatId: "-1003937871684", enabled: true, sendImportant: true },
          ],
          opsRoutes: [UNS_OPS],
        }) as never,
        makeEvent({ companyId: UNS_COMPANY_ID, payload: { identifier: "UNS-99" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("file_route");
      expect(dest?.chatId).toBe("-1003937871684");
    });

    it("defaults to file_route (sendImportant true) when the field is omitted", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          fileRoutes: [
            { name: "UAudit", projectKey: "UNS", chatId: "-1003937871684", enabled: true },
          ],
          opsRoutes: [UNS_OPS],
        }) as never,
        makeEvent({ companyId: UNS_COMPANY_ID, payload: { identifier: "UNS-99" } }),
        "important",
      );
      expect(dest?.routeSource).toBe("file_route");
      expect(dest?.chatId).toBe("-1003937871684");
    });

    it("does not affect ops classification (ops events never consult fileRoutes)", async () => {
      const ctx = mockCtx();
      const dest = await resolveNotificationDestination(
        ctx,
        mockConfig({
          fileRoutes: [
            { name: "UAudit", projectKey: "UNS", chatId: "-1003937871684", enabled: true, sendImportant: false },
          ],
          opsRoutes: [UNS_OPS],
        }) as never,
        makeEvent({ companyId: UNS_COMPANY_ID, eventType: "agent.run.started" }),
        "ops",
      );
      expect(dest?.routeSource).toBe("ops_route");
      expect(dest?.chatId).toBe("-1003534905521");
    });
  });
});
