# TEL-8 Plan: Agent-Initiated Telegram Text and Markdown Delivery

Status: draft for TEL-8 review
Progress: implemented core outbound path in branch (`send_to_telegram` with text/markdown modes), kept `send_file_to_telegram` as compatibility alias, and aligned `src/telegram-api.ts` around multipart markdown document upload (`sendDocument`) with helper tests.
Branch: `cx/tel-8-agent-file-send`
Spec: `docs/tel-8-agent-file-send-spec.md`

## Discovery Summary

- Existing outbound Telegram helper: `src/telegram-api.ts` has `sendMessage`.
- Existing agent tool registration: `src/worker.ts` registers escalation, handoff, discuss, and watch tools.
- Existing destination controls: config has `defaultChatId`, company chat mapping state, and `allowedTelegramChatIds`.
- Existing reply routing: agent session replies can route through `agent_msg_${chatId}_${messageId}` state keys.
- Current plugin SDK note: `ctx.assets` is not supported, so this plan avoids asset APIs.

## Review Gate

Stop implementation changes until TEL-8 spec and plan are reviewed in TEL-8 comments by TGCodeReviewer.

Important current-state note: a previous heartbeat already added a broad prototype for Telegram file sending. Treat that code as unreviewed prototype work. After spec review, implementation should be reconciled to the approved contract rather than expanded as-is.

## Current Blocker

Status: blocked for implementation.

Unblock owner: TGCodeReviewer.

Required unblock action: review `docs/tel-8-agent-file-send-spec.md` and this plan in TEL-8 comments, then explicitly approve or request changes for:

- final tool name,
- Markdown size cap,
- destination allowlist behavior,
- content-based `.md` upload versus any path or URL-based source.

No additional implementation should proceed until that review response is posted.

## Key Design Decisions

- Use one explicit agent tool for intentional outbound delivery, not event hooks.
- Prefer tool name `send_to_telegram` because the accepted scope includes text-only and Markdown document modes.
- Use `sendMessage` only for text-only delivery.
- Use `sendDocument` multipart upload for generated `.md` content.
- Do not accept arbitrary file paths, URLs, Telegram `file_id`s, or binary payloads.
- Use content-based Markdown upload to avoid path traversal, dotfile, secret path, and arbitrary file exfiltration risks.
- Require explicit `chatId` to be allowlisted. With an empty allowlist, only configured company/default destinations are allowed.
- Return structured `{ ok, code, message }` errors instead of plain strings.

## Implementation Steps After Review

1. Align Telegram API helpers.
   - Keep existing `sendMessage` behavior stable.
   - Add `sendDocument` helper for UTF-8 Markdown content using multipart upload.
   - Preserve rate-limit retry and Markdown caption fallback behavior where applicable.

2. Add validation helpers.
   - Validate destination resolution and explicit-chat allowlist behavior.
   - Validate Markdown filename basename, `.md` extension, no traversal/path separators, no dotfile, no secret-looking names.
   - Reject unsupported file source fields such as `filePath`, `path`, `fileUrl`, and `telegramFileId`.
   - Enforce `MAX_OUTBOUND_MARKDOWN_BYTES`.

3. Register the approved agent tool.
   - Tool schema supports `text`, `markdownContent`, `markdownFileName`, `chatId`, `threadId`, `parseMode`, `replyToMessageId`, `silent`, and `sessionId`.
   - Handler selects `sendMessage` or `sendDocument`.
   - Handler logs activity and stores `agent_msg_*` state when `sessionId` is present.

4. Update manifest and README.
   - Manifest declares the approved tool name and schema summary.
   - README documents the tool contract, config/allowlist behavior, safety limits, and unsupported file sources.

5. Add tests.
   - Unit tests for Telegram API helper payloads.
   - Tool handler tests for success modes and validation failures.
   - Regression run for the full existing suite.

## Verification Plan

Minimum checks after implementation:

- `npm test -- --run tests/telegram-api.test.ts`
- focused worker/tool tests added for TEL-8
- `npm run typecheck`
- `npm run build`
- `npm test`

## Review Assignment

TGCodeReviewer should review:

- Spec: `docs/tel-8-agent-file-send-spec.md`
- Plan: `docs/tel-8-agent-file-send-plan.md`

Review questions:

- Approve `send_to_telegram` as the final tool name, or require retaining `send_file_to_telegram`?
- Approve `256 KiB` as `MAX_OUTBOUND_MARKDOWN_BYTES`, or set a different cap?
- Confirm that content-based Markdown upload is preferred over any local path or URL-based file source.

## Next Action

Wait for TGCodeReviewer review in TEL-8 comments. After approval or requested changes, reconcile the current prototype implementation to the reviewed spec and run the verification plan.
