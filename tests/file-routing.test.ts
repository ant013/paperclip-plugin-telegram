import { describe, it, expect } from "vitest";
import {
  resolveTelegramFileDestination,
  validateTelegramFileRoutes,
} from "../src/file-routing.js";

const UNS_ROUTE_BASE = { name: "UAudit", projectKey: "UNS", chatId: "-1003937871684", enabled: true };

describe("file route sendImportant normalization", () => {
  it("defaults sendImportant to true when the field is omitted", () => {
    const { routes } = validateTelegramFileRoutes([UNS_ROUTE_BASE]);
    expect(routes).toHaveLength(1);
    expect(routes[0]!.sendImportant).toBe(true);
  });

  it("preserves sendImportant=false when set explicitly", () => {
    const { routes } = validateTelegramFileRoutes([{ ...UNS_ROUTE_BASE, sendImportant: false }]);
    expect(routes[0]!.sendImportant).toBe(false);
  });

  it("treats sendImportant=true the same as default", () => {
    const { routes } = validateTelegramFileRoutes([{ ...UNS_ROUTE_BASE, sendImportant: true }]);
    expect(routes[0]!.sendImportant).toBe(true);
  });
});

describe("resolveTelegramFileDestination exposes sendImportant on file_route", () => {
  it("returns sendImportant=false for a route opted out of important routing", async () => {
    const dest = await resolveTelegramFileDestination(
      [{ ...UNS_ROUTE_BASE, sendImportant: false }],
      { issueIdentifier: "UNS-99" },
    );
    expect(dest.ok).toBe(true);
    if (dest.ok) {
      expect(dest.source).toBe("file_route");
      expect(dest.sendImportant).toBe(false);
      expect(dest.chatId).toBe("-1003937871684");
    }
  });

  it("returns sendImportant=true by default", async () => {
    const dest = await resolveTelegramFileDestination([UNS_ROUTE_BASE], { issueIdentifier: "UNS-99" });
    expect(dest.ok).toBe(true);
    if (dest.ok) {
      expect(dest.source).toBe("file_route");
      expect(dest.sendImportant).toBe(true);
    }
  });
});
