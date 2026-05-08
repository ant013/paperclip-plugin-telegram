import { describe, it, expect, vi } from "vitest";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { escapeMarkdownV2, sendDocument, truncateAtWord } from "../src/telegram-api.js";

function mockCtx(response: unknown = { ok: true, result: { message_id: 123 } }) {
  return {
    ctx: {
      http: {
        fetch: vi.fn(async () => ({
          json: async () => response,
        })),
      },
      logger: {
        warn: vi.fn(),
        error: vi.fn(),
      },
      metrics: {
        write: vi.fn(),
      },
    } as unknown as PluginContext,
  };
}

describe("escapeMarkdownV2", () => {
  it("escapes underscores", () => {
    expect(escapeMarkdownV2("hello_world")).toBe("hello\\_world");
  });

  it("escapes asterisks", () => {
    expect(escapeMarkdownV2("*bold*")).toBe("\\*bold\\*");
  });

  it("escapes brackets", () => {
    expect(escapeMarkdownV2("[link](url)")).toBe("\\[link\\]\\(url\\)");
  });

  it("escapes backticks", () => {
    expect(escapeMarkdownV2("`code`")).toBe("\\`code\\`");
  });

  it("escapes tildes", () => {
    expect(escapeMarkdownV2("~strikethrough~")).toBe("\\~strikethrough\\~");
  });

  it("escapes hashes", () => {
    expect(escapeMarkdownV2("#heading")).toBe("\\#heading");
  });

  it("escapes plus signs", () => {
    expect(escapeMarkdownV2("a+b")).toBe("a\\+b");
  });

  it("escapes hyphens", () => {
    expect(escapeMarkdownV2("a-b")).toBe("a\\-b");
  });

  it("escapes equal signs", () => {
    expect(escapeMarkdownV2("a=b")).toBe("a\\=b");
  });

  it("escapes pipes", () => {
    expect(escapeMarkdownV2("a|b")).toBe("a\\|b");
  });

  it("escapes curly braces", () => {
    expect(escapeMarkdownV2("{a}")).toBe("\\{a\\}");
  });

  it("escapes dots", () => {
    expect(escapeMarkdownV2("a.b")).toBe("a\\.b");
  });

  it("escapes exclamation marks", () => {
    expect(escapeMarkdownV2("hello!")).toBe("hello\\!");
  });

  it("escapes backslashes", () => {
    expect(escapeMarkdownV2("a\\b")).toBe("a\\\\b");
  });

  it("escapes greater than", () => {
    expect(escapeMarkdownV2("a>b")).toBe("a\\>b");
  });

  it("handles multiple special chars in one string", () => {
    expect(escapeMarkdownV2("PROJ-42: Fix [bug] #1"))
      .toBe("PROJ\\-42: Fix \\[bug\\] \\#1");
  });

  it("leaves plain text unchanged", () => {
    expect(escapeMarkdownV2("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeMarkdownV2("")).toBe("");
  });
});

describe("truncateAtWord", () => {
  it("returns text unchanged if shorter than max", () => {
    expect(truncateAtWord("hello", 10)).toBe("hello");
  });

  it("returns text unchanged if equal to max", () => {
    expect(truncateAtWord("hello", 5)).toBe("hello");
  });

  it("truncates at word boundary and adds ellipsis", () => {
    const result = truncateAtWord("hello world foo bar baz", 15);
    expect(result).toBe("hello world...");
  });

  it("falls back to hard cut when no good word boundary", () => {
    const result = truncateAtWord("abcdefghijklmnopqrstuvwxyz", 10);
    expect(result).toBe("abcdefghij...");
    expect(result.length).toBe(13);
  });

  it("handles single word longer than max", () => {
    const result = truncateAtWord("superlongword", 5);
    expect(result).toBe("super...");
  });

  it("handles text with trailing space at boundary", () => {
    const result = truncateAtWord("aa bb cc dd ee ff", 8);
    expect(result).toBe("aa bb cc...");
  });
});

describe("sendDocument", () => {
  it("sends markdown content as a Telegram document with caption and routing options", async () => {
    const { ctx } = mockCtx();

    const messageId = await sendDocument(ctx, "bot-token", "-1001", "# Report\n\nbody", {
      filename: "report.md",
      caption: "Quarterly report",
      parseMode: "MarkdownV2",
      messageThreadId: 42,
      replyToMessageId: 7,
      disableNotification: true,
    });

    expect(messageId).toBe(123);
    expect(ctx.http.fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendDocument",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const body = (ctx.http.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("chat_id")).toBe("-1001");
    expect(body.get("caption")).toBe("Quarterly report");
    expect(body.get("parse_mode")).toBe("MarkdownV2");
    expect(body.get("message_thread_id")).toBe("42");
    expect(body.get("reply_to_message_id")).toBe("7");
    expect(body.get("disable_notification")).toBe("true");
    expect(ctx.metrics.write).toHaveBeenCalledWith("telegram_notifications_sent", 1);
  });

  it("uploads markdown content using an .md filename", async () => {
    const { ctx } = mockCtx();

    await sendDocument(ctx, "bot-token", "-1001", "# Hello", {
      filename: "notes.md",
      parseMode: "HTML",
    });

    expect(ctx.http.fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot-token/sendDocument",
      expect.anything(),
    );
    const body = (ctx.http.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]!.body as FormData;
    const document = body.get("document") as Blob;
    expect(document).toBeInstanceOf(Blob);
    const text = await document.text();
    expect(text).toBe("# Hello");
  });

  it("retries a MarkdownV2 caption as plain text when Telegram rejects it", async () => {
    const ctx = {
      http: {
        fetch: vi
          .fn()
      .mockResolvedValueOnce({
        json: async () => ({ ok: false, description: "can't parse entities" }),
      })
      .mockResolvedValueOnce({
        json: async () => ({ ok: true, result: { message_id: 124 } }),
      }),
      },
      logger: { warn: vi.fn(), error: vi.fn() },
      metrics: { write: vi.fn() },
    } as unknown as PluginContext;

    const messageId = await sendDocument(ctx, "bot-token", "-1001", "# Report", {
      filename: "report.md",
      caption: "\\*Report\\*",
      parseMode: "MarkdownV2",
    });

    expect(messageId).toBe(124);
    expect(ctx.http.fetch).toHaveBeenCalledTimes(2);
    const secondBody = (ctx.http.fetch as ReturnType<typeof vi.fn>).mock.calls[1]![1]!.body as FormData;
    expect(secondBody.get("caption")).toBe("Report");
    expect(secondBody.get("parse_mode")).toBeNull();
  });
});
