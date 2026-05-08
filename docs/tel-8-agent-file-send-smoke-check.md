# TEL-8 Smoke Check Results

Status: PASS (local contract smoke)

Date: 2026-05-08
Owner: TGQAEngineer (codex_local)

Objective:
- Verify `send_to_telegram` can create markdown content from an `.md` file and send it as a Telegram document.

Executed smoke test:
- `smoke: generates a markdown file and sends it as Telegram document`
- File: [`tests/send-to-telegram.test.ts`](/Users/Shared/Ios/worktrees/cx/paperclip-plugin-telegram/tests/send-to-telegram.test.ts)
- Command:
  - `npm test -- tests/send-to-telegram.test.ts tests/telegram-api.test.ts`
- Result:
  - 2 files passed
  - 62 tests passed
  - Document send path validated via mocked Telegram API call to:
    `https://api.telegram.org/botresolved-token/sendDocument`
  - Multipart payload body includes `document` blob with `.md` contents and `caption`.

Notes:
- This is a local smoke simulation (mocked Telegram endpoint), not live in-prod channel posting.

Next action:
- Live Telegram smoke is blocked in this session because only `TELEGRAM_BOT_TOKEN_REF` is available (no raw bot token is exposed through the current runtime API path).
- Use live smoke test `tests/send-to-telegram-live.smoke.test.ts` with:
  - `TELEGRAM_SMOKE_BOT_TOKEN=<raw bot token>`
  - `TELEGRAM_SMOKE_CHAT_ID=<target chat id>`
  - Command: `npm test -- tests/send-to-telegram-live.smoke.test.ts`
- The test posts `# Live smoke` report as `agent-live-report.md` into the configured Telegram chat and expects a positive `messageId`.
- After successful manual run, hand the issue to [@TGCTO](agent://dbef1a38-5618-4dca-af30-9606a619799c?i=crown) for final close.
