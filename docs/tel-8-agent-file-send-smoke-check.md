# TEL-8 Smoke Check Results

Status: READY_FOR_QA_LIVE_SMOKE (local checks pass)

Date: 2026-05-08
Owner: TGQAEngineer (codex_local)

Objective:
- Verify explicit `send_to_telegram` path for all required outbound modes:
  - text-only
  - `.md` document-only
  - `.md` document with caption/text
  - disallowed chat rejection before Telegram API call

Executed smoke tests:
- Live contract suite: [`tests/send-to-telegram-live.smoke.test.ts`](/Users/Shared/Ios/worktrees/cx/paperclip-plugin-telegram/tests/send-to-telegram-live.smoke.test.ts)
  - `sends text-only Telegram message from explicit agent tool path`
  - `sends markdown-only document with explicit tool path`
  - `sends markdown document with caption via explicit tool path`
  - `sends generated markdown file to Telegram as a document`
  - `rejects explicit disallowed chat id before Telegram send` (always runs without live token)
- Local contract suite: [`tests/send-to-telegram.test.ts`](/Users/Shared/Ios/workspaces/cx/paperclip-plugin-telegram/tests/send-to-telegram.test.ts)

Notes:
- Live cases are guarded by `TELEGRAM_SMOKE_BOT_TOKEN` and `TELEGRAM_SMOKE_CHAT_ID` (or `TELEGRAM_DEFAULT_CHAT_ID`).
- When credentials are absent, live send tests are skipped and only the disallowed-chat guard assertion executes.
- The guard assertion confirms no Telegram API call happens for disallowed chat IDs.

Next action:
Run:
- `npm test -- tests/send-to-telegram.test.ts tests/send-to-telegram-live.smoke.test.ts`
- Last run in this environment:
  - 2 test files passed
  - 40 total assertions with 4 skipped (credentials missing for live sends)
  - Disallowed-chat guard assertion passed (no API call path executed).

Alternative quick-path for runtime verification (requires plugin build + live Telegram token access in runtime):
- After deploy, this action route is now registered and can be used for direct API smoke:
  - `POST ${PAPERCLIP_API_URL}/api/plugins/${TELEGRAM_PLUGIN_ID}/actions/send_to_telegram`
  - `POST .../actions/send_file_to_telegram`
- Request body pattern:
  - `{"params":{"companyId":"<company uuid>","agentId":"<agent uuid>","text":"TEL-8 live smoke","markdownContent":"# Live\n\n...", "markdownFileName":"agent-live-report.md"}}`
- Response echoes the same tool result shape as agent tool calls (`content` + `data`), including success data or structured errors.

Prerequisite for full live verification:
- Set both:
  - `TELEGRAM_SMOKE_BOT_TOKEN=<raw bot token>`
  - `TELEGRAM_SMOKE_CHAT_ID=<allowed chat id>`
- Re-run the same command to get live message/document proofs in Telegram.
