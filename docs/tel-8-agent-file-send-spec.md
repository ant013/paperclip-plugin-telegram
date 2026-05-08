# TEL-8 Spec: Agent-Initiated Telegram Text and Markdown Delivery

Status: draft for TEL-8 review
Branch: `cx/tel-8-agent-file-send`

## Goal

Add an explicit agent/workflow tool path that lets an authorized Paperclip agent publish intentional outbound content to Telegram:

- Text-only Telegram message.
- Markdown document upload as `.md`.
- Markdown document upload with caption/text.

This is not an automatic Paperclip event hook. Existing automatic run lifecycle notifications stay unchanged.

## Non-Goals

- No arbitrary binary file sending.
- No arbitrary URL passthrough to Telegram.
- No posting to arbitrary chats.
- No automatic forwarding of all agent outputs or issue comments.
- No dependency on `ctx.assets`; the current plugin runtime does not provide a supported asset API.

## Proposed Tool Contract

Recommended tool name: `send_to_telegram`.

The tool accepts either text, Markdown document content, or both:

```json
{
  "chatId": "-100123",
  "threadId": 42,
  "text": "Short message or caption",
  "markdownContent": "# Report\n\nDetails...",
  "markdownFileName": "report.md",
  "parseMode": "MarkdownV2",
  "replyToMessageId": 123,
  "silent": false,
  "sessionId": "optional-session-id"
}
```

Rules:

- At least one of `text` or `markdownContent` is required.
- `markdownContent` must be sent as a Telegram document with a `.md` filename.
- `markdownFileName` is optional and defaults to `paperclip-message.md`.
- `markdownFileName` must be a basename only, with no path separators.
- `parseMode` only affects Telegram text/caption fields. Markdown document bytes are uploaded as plain UTF-8 content.
- `sessionId`, when present, stores the sent Telegram message as a reply-routing anchor for the existing agent session routing logic.

## Destination Control

Agents must not be able to choose arbitrary Telegram destinations.

Destination resolution:

1. If `chatId` is omitted, use the existing company chat mapping override, falling back to `defaultChatId`.
2. If `chatId` is provided, it must match `allowedTelegramChatIds`.
3. If `allowedTelegramChatIds` is empty, explicit `chatId` input is rejected. The tool may still use the configured company/default chat.
4. `threadId` is allowed only as a numeric Telegram forum topic ID and is passed as `message_thread_id`.

This keeps configured plugin destinations usable while preventing agents from supplying arbitrary chat IDs.

## Content Safety

Markdown document input is content-based, not path-based.

The tool rejects:

- Non-`.md` filenames.
- Filenames containing `/`, `\`, `..`, drive prefixes, null bytes, or control characters.
- Dotfiles such as `.env.md` or `.secret.md`.
- Secret-looking names including `secret`, `token`, `credential`, `password`, or `private-key`.
- Any `filePath`, `path`, `fileUrl`, `telegramFileId`, or binary/file upload parameter.
- Markdown content over `MAX_OUTBOUND_MARKDOWN_BYTES`.

Recommended size cap: `256 KiB` UTF-8 bytes. This is intentionally smaller than Telegram's document limit to keep agent-generated output auditable and avoid accidental large exfiltration.

## Telegram API Design

### Text-only: `sendMessage`

Use Telegram `sendMessage` when `markdownContent` is absent.

Payload:

- `chat_id`
- `text`
- optional `parse_mode`
- optional `message_thread_id`
- optional `reply_to_message_id`
- optional `disable_notification`

### Markdown document: `sendDocument`

Use Telegram `sendDocument` multipart upload when `markdownContent` is present.

Multipart fields:

- `chat_id`
- `document`: UTF-8 `Blob`/buffer of `markdownContent`, filename `markdownFileName`
- optional `caption`: `text`
- optional `parse_mode` for caption only
- optional `message_thread_id`
- optional `reply_to_message_id`
- optional `disable_notification`

If both `text` and `markdownContent` are provided, `text` is used as the document caption. Do not send a second text message unless the caption exceeds Telegram's caption limit; in that case reject with `caption_too_large`.

## Structured Results

Success:

```json
{
  "ok": true,
  "mode": "message",
  "chatId": "-100123",
  "threadId": 42,
  "messageId": 777
}
```

Failure:

```json
{
  "ok": false,
  "code": "disallowed_chat",
  "message": "Telegram chat is not allowed for agent outbound delivery"
}
```

Required error codes:

- `missing_content`
- `disallowed_chat`
- `invalid_thread`
- `invalid_markdown_filename`
- `non_markdown_file`
- `unsafe_filename`
- `unsupported_file_source`
- `markdown_too_large`
- `caption_too_large`
- `telegram_send_failed`

Telegram API failures must be logged, returned as structured tool errors, and counted in `METRIC_NAMES.failed`.

## Test Requirements

Add focused tests for:

- Text-only success uses `sendMessage`.
- Markdown document success uses `sendDocument`.
- Markdown document plus caption.
- Explicit disallowed chat rejected before `ctx.http.fetch`.
- Empty allowlist rejects explicit `chatId` but allows configured default chat.
- Non-`.md` filename rejected.
- Path traversal and path separator filenames rejected.
- Dotfile and secret-looking filenames rejected.
- Unsupported file source fields rejected.
- Oversized Markdown rejected before Telegram API.
- Telegram failure returns structured error and writes failure metric.
- Existing notifications, commands, media intake, ACP, escalation, and approval tests still pass.

## Open Questions

- Tool name: use `send_to_telegram` for text plus Markdown delivery, or keep `send_file_to_telegram` for continuity with the prototype? Recommendation: `send_to_telegram`.
- Size cap: approve `256 KiB`, or use a larger cap such as `1 MiB`?
