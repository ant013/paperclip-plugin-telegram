# Paperclip Integration: Sending Telegram Messages and Files from Any Project

This document is for **operators and agent role authors** of any Paperclip company
that wants to push messages or markdown files to a Telegram chat from agent runs,
workflows, or operator scripts. It covers the routing model the plugin uses, the
exact HTTP shape for invoking the send actions, and the limitations that are not
obvious from the README.

It supplements the main `README.md` (which focuses on bidirectional bot UX —
inbound commands, approvals, digests). This file focuses on **outbound sending**.

---

## TL;DR — Minimum to send a message

Once a Paperclip company is connected to a Telegram chat (one-time setup, see
[Setup](#setup)), any caller with a Paperclip Board API token can post a message:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "companyId": "9d8f432c-ff7d-4e3a-bbe3-3cd355f73b64",
      "agentId":   "7fb0fdbb-e17f-4487-a4da-16993a907bec",
      "text":      "Hello from CI"
    }
  }' \
  "$PAPERCLIP_API_URL/api/plugins/$PLUGIN_ID/actions/send_to_telegram"
```

Success returns `{ ok: true, mode: "message", chatId, messageId }`. The chat is
resolved automatically from `companyId` — no chat ID in the body required.

**Two gotchas that bite first-time users:**
1. The body **must** be wrapped in `{"params": {...}}`. A flat body
   `{companyId, agentId, text}` is accepted by the route (returns HTTP 200) but
   the handler sees `params = undefined`, so you get
   `{ok: false, code: "missing_content"}` even though `text` is right there.
2. The caller token must have **Board access** (`pcp_board_*`). Agent-scoped
   tokens currently get `Board access required` from the plugin route.

To send a Markdown file instead of inline text:

```bash
curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "companyId": "9d8f432c-ff7d-4e3a-bbe3-3cd355f73b64",
      "agentId":   "7fb0fdbb-e17f-4487-a4da-16993a907bec",
      "issueIdentifier":  "GIM-272",
      "markdownFileName": "report.md",
      "markdownContent":  "# Report\n\nBody …"
    }
  }' \
  "$PAPERCLIP_API_URL/api/plugins/$PLUGIN_ID/actions/send_to_telegram"
```

Success returns `{ ok: true, mode: "document", chatId, messageId }`. Telegram
shows the upload as an attached `.md` file.

The plugin does not host its own raw-token endpoint — every call goes through
Paperclip's authenticated REST layer.

---

## Architecture

Routing flows through four concepts; understanding the difference is the whole
point of this document.

### 1. Paperclip **company** → Telegram **chat**

This is the only routing level that's strictly required.

| Source of chat ID | Set how | Stored where |
|---|---|---|
| Per-company override (preferred) | `/connect <CompanyName>` in the target Telegram chat, OR `actions/set-chat` REST call | `ctx.state` key `telegram-chat` scoped to company |
| Global fallback | Plugin config `defaultChatId` | `/api/plugins/{id}/config` |

`resolveChat(companyId)` returns the per-company override if present, else the
global default. Internally the bot's `/connect` command writes both the
`chat_<chatId>` → company mapping *and* the per-company `telegram-chat` override
when the operator runs it. Without `/connect`, all events from that company fall
through to `defaultChatId`.

Caller-supplied `chatId` in the action body is **ignored unless** the explicit
ID is also listed in `allowedTelegramChatIds`. The plugin will return
`code: "disallowed_chat"` otherwise. This is intentional — it prevents an
agent compromise from posting into arbitrary chats.

### 2. Paperclip **project** → Telegram **forum topic** (optional)

If the bound chat is a Telegram forum supergroup, project work can be split into
per-project topics within the same chat.

- Map a project to a topic: in the target topic, run
  `/connect_topic <project-name> [topic-id]` (omit `topic-id` to use the topic
  the command was sent from).
- View mappings: `/topics list`.
- Remove: `/topics remove <project-name>` or `/topics clear`.

Mapping is stored under instance state key `topic-map-<chatId>`. The plugin's
notification dispatch will route project-scoped events to the matching topic.

For an outbound `send_to_telegram` call you can also set `threadId: <forum
topic id>` in `params` to target a specific topic explicitly.

### 3. Issue identifier prefix (`GIM`, `TEL`, `UNS`, …) — `fileRoutes`

The Gimle fork (TEL-23) wires `issueIdentifier` prefix to a configurable
per-project chat through `config.fileRoutes`. This lets every Paperclip project
write into its own chat without any caller having to know the chat ID.

Behaviour:

- Caller passes `issueIdentifier: "GIM-272"` in `params`. The plugin extracts
  the prefix with `parseProjectKeyFromIssueIdentifier` (regex
  `^([A-Z][A-Z0-9]*)-\d+$`), giving `"GIM"`.
- The plugin looks up `config.fileRoutes` for an enabled entry with matching
  `projectKey` and uses its `chatId` (optionally `topicId`).
- The response includes `routeSource: "file_route"` and the matched
  `routeName` / `projectKey` so the caller can verify routing happened.

Resolution precedence (first match wins):

1. **`explicit`** — caller passed `chatId` and it's in `allowedTelegramChatIds`.
2. **`file_route`** — `issueIdentifier` prefix matches an enabled `fileRoutes`
   entry.
3. **`legacy_fallback`** — falls through to per-company `telegram-chat` state
   override, then `defaultChatId`.

Error codes specific to file-route resolution:

| Code | Meaning |
|---|---|
| `missing_destination` | No explicit chatId, no `issueIdentifier`, no per-company override, no `defaultChatId`. |
| `missing_route_context` | `fileRoutes` configured but caller gave no `issueIdentifier` (or `issueId` that resolves to one) to match against. |
| `unknown_project_route` | Prefix parsed, but no enabled `fileRoutes` entry has matching `projectKey`. |
| `ambiguous_route` | More than one enabled entry matches the same `projectKey` (config error — fix by removing duplicates). |
| `invalid_route_config` | `fileRoutes` array contains malformed entries (bad chatId/topicId/projectKey). |
| `conflicting_destination` | Caller supplied both `explicit chatId` and `issueIdentifier` whose resolved route disagrees. |

Example `fileRoutes` config:

```json
"fileRoutes": [
  { "name": "Gimle files",          "projectKey": "GIM", "chatId": "-1003995931017", "topicId": "", "enabled": true },
  { "name": "TelegramUpdate files", "projectKey": "TEL", "chatId": "-1003839195906", "topicId": "", "enabled": true },
  { "name": "UAudit",               "projectKey": "UNS", "chatId": "-1003937871684", "topicId": "", "enabled": true }
]
```

Edit via the plugin Settings UI (it has a File Routes section) or via
`POST /api/plugins/<id>/config` with the full `configJson` body.

| Project | Prefix | Company UUID |
|---|---|---|
| Gimle Palace | `GIM` | `9d8f432c-ff7d-4e3a-bbe3-3cd355f73b64` |
| TelegramUpdate | `TEL` | `8810f36f-c9f1-4920-b9a1-d5f7a1db9484` |
| UnstoppableAudit | `UNS` | `8f55e80b-0264-4ab6-9d56-8b2652f18005` |
| Medic | `MED` | `7c094d21-a02d-4554-8f35-730bf25ea492` |

Pass `issueIdentifier: "GIM-272"` in the action body to both route the file AND
display a clean header (`GIM-272 …`). The plugin enriches further with issue
title/run link when resolvable from `issueId`.

### 3a. Ops events per company — `opsRoutes`

Event-driven notifications (agent run start/finish, errors, escalations) carry
a `companyId` but no `issueIdentifier`, so they cannot use `fileRoutes`.
Instead, `config.opsRoutes` maps **company → chat** for the lifecycle path:

```json
"opsRoutes": [
  { "name": "Gimle Ops",          "companyId": "9d8f432c-...", "companyName": "Gimle",          "chatId": "-1003521772993", "enabled": true },
  { "name": "TelegramUpdate Ops", "companyId": "8810f36f-...", "companyName": "TelegramUpdate", "chatId": "-1003978140493", "enabled": true }
]
```

`resolveTelegramOpsDestination` matches on `companyId` first, then falls back
to `companyName` (so an entry without `companyId` but matching name still
works). If no `opsRoutes` entry matches, the lifecycle event falls through to
the same legacy chain as files (per-company `telegram-chat` state override →
`defaultChatId`). `errorsChatId` / `approvalsChatId` etc. still apply on top
as category-specific overrides.

### 4. Bot token and secret refs

The Telegram bot token is stored as a Paperclip Secret. The plugin holds only
the **secret ref** (UUID) under `telegramBotTokenRef`; it resolves to the raw
token at runtime via host capability `secrets.read-ref`. Rotation procedure is
in the README under "Configuration".

---

## Setup

For a new Paperclip company that wants its own Telegram channel:

1. **Create the bot** (one-time, optional — can share an existing bot across
   companies). Talk to `@BotFather` → `/newbot` → save the token.

2. **Provision the bot token as a Paperclip Secret**:
   ```bash
   curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"name": "telegram-bot-token", "value": "<bot-token>", "description": "TG bot for Company X"}' \
     "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/secrets"
   ```
   Save the returned `id` — this is your `secret_uuid`.

3. **Configure the plugin** (only needs to happen once globally — the plugin
   is a singleton across all companies):
   ```bash
   curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "configJson": {
         "telegramBotTokenRef": "<secret_uuid>",
         "defaultChatId":       "<fallback chat ID>",
         "enableInbound":       true,
         "enableCommands":      true
       }
     }' \
     "$PAPERCLIP_API_URL/api/plugins/$PLUGIN_ID/config"
   ```
   After the first config save, `paperclipai plugin disable …` followed by
   `enable …` is required to make the worker pick it up — see README gotcha
   on first-activation.

4. **Add the bot to your Telegram chat**, then run `/connect <CompanyName>` in
   that chat (case-insensitive match against company names in Paperclip). This
   binds the chat to the company so future `send_to_telegram` calls with that
   `companyId` route here.

5. (Optional) Map projects to forum topics with `/connect_topic <project-name>`
   inside each topic.

6. Smoke-test with the curl from [TL;DR](#tldr--minimum-to-send-a-message). You
   should see `mode: "message"` and a real message in the chat.

---

## Action reference

The plugin registers actions through Paperclip's `ctx.actions` API. Each is
invocable at `POST /api/plugins/{pluginId}/actions/{name}` with body
`{"params": {…fields…}}`.

### `send_to_telegram` and `send_file_to_telegram`

Both names route to the same handler. Use `send_to_telegram` — the `_file_`
alias exists only for backward compatibility with the TEL-8 prototype.

**Required params:** at least one of `text` or `markdownContent`.

| Field | Type | Notes |
|---|---|---|
| `companyId` | string (UUID) | Required for chat resolution. Defaults to `"system"` if omitted, which usually fails. |
| `agentId` | string (UUID) | Required for activity log attribution. Defaults to `"system"`. |
| `text` | string | Plain-text or MarkdownV2 message body. Required if `markdownContent` is absent. |
| `markdownContent` | string | UTF-8 markdown content; sent as a Telegram `.md` attachment via `sendDocument`. Required if `text` is absent. |
| `markdownFileName` | string | Filename for the attachment. Defaults to `paperclip-message.md`. Must end `.md`, no path separators, no traversal, no leading dot, no obvious secret tokens. |
| `chatId` | string | Explicit chat override. **Only accepted if also in `allowedTelegramChatIds`.** Otherwise the plugin rejects with `disallowed_chat`. |
| `threadId` | positive integer | Forum topic ID within the chat. |
| `replyToMessageId` | positive integer | Reply to a specific message. |
| `parseMode` | `"MarkdownV2"` or `"HTML"` | Defaults to plain text. |
| `issueIdentifier` | string | Cosmetic header (`"GIM-272"`, etc.). |
| `sessionId` | string | Forwarded to plugin state for ACP session correlation. |

**Result envelope:**
```json
{
  "data": {
    "content": "<stringified inner data>",
    "data": {
      "ok": true,
      "mode": "message" | "document",
      "chatId": "-1003...",
      "threadId": 42,
      "messageId": 147
    }
  }
}
```

The Paperclip REST layer wraps every action result in `{data: {…}}`; the
plugin returns `{content, data}` inside that. Parse `.data.data` (or the
stringified `.data.content`) to read the actual plugin response.

**Error codes** (all return `ok: false` inside the inner envelope, HTTP 200
from the route):

| Code | Meaning |
|---|---|
| `missing_content` | Neither `text` nor `markdownContent` supplied. *Most often caused by missing `params` wrapper.* |
| `unsupported_file_source` | Caller passed `filePath`, `url`, `telegramFileId`, etc. Only inline `markdownContent` is supported as the file source — no fs paths, no URLs. |
| `disallowed_chat` | Explicit `chatId` not in `allowedTelegramChatIds`, or no chat resolvable. |
| `invalid_thread` | `threadId` or `replyToMessageId` is not a positive integer. |
| `non_markdown_file` | `markdownFileName` does not end `.md`. |
| `invalid_markdown_filename` | Filename contains `/`, `\`, `..`, drive letter, or other path-y characters. |
| `unsafe_filename` | Filename matches `secret|token|credential|password|private-key` token, or starts with `.`, or contains control chars. |
| `markdown_too_large` | `markdownContent` exceeds 256 KiB. |
| `caption_too_large` | When `text` is used as caption alongside `markdownContent`, caption is capped at 1024 bytes. |

### `set-chat`

```json
{ "params": { "companyId": "<uuid>", "chatId": "-1003..." } }
```

Stores a per-company chat override. Equivalent to running `/connect` in the
chat itself, but does not require a Telegram round-trip.

### `board-access.update`

```json
{ "params": { "paperclipBoardApiTokenRef": "<secret-uuid>", "identity": "<who>", "companyId": "<uuid>" } }
```

Persists the Board API token reference the plugin will use to read issue/run
context when enriching notifications. Set this once per instance.

---

## Permissions and Board access

The plugin's action routes go through Paperclip's standard auth. Empirically,
the route currently rejects agent-scoped tokens with **`Board access
required`**. There is no documented capability flag the operator can set on an
agent to grant action-invoke; in the current deployment only the
`pcp_board_*` token works.

This shapes the design of agent integrations (see next section).

---

## How agents can use this

There is **no MCP wiring** today: paperclipai does *not* register
`paperclip-plugin-telegram` as an MCP server in `~/.claude/settings.json` or
`~/.codex/config.toml`. As a result, neither Claude Code (`claude_local`
adapter) nor Codex CLI (`codex_local` adapter) sees the 6 plugin tools in its
native tool list, regardless of what `manifestJson.tools` declares.

The plugin tools that paperclip's `plugin-tool-registry` lists (visible in the
server log line `registered 6 tool(s) for plugin paperclip-plugin-telegram`)
are an *internal* registry. They are not auto-forwarded to spawned agent CLIs.

To have an agent send a message:

1. **Recipe A — agent issues an `exec_command` curl** (used today by the TEL
   company agents):

   In the role's `AGENTS.md`, document the action curl invocation and the
   board token location (e.g. `~/.paperclip-token` or `auth.json`). The agent
   uses its native shell tool to run the curl from the recipe above. This is
   the only path that works end-to-end on the current paperclipai release.

   Sample snippet to drop into a role file:
   ```bash
   TOKEN=$(jq -r '.credentials["http://localhost:3100"].token' ~/.paperclip/auth.json)
   curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "$(jq -n --arg co "$COMPANY_ID" --arg ag "$AGENT_ID" --arg t "$MSG" \
            '{params: {companyId: $co, agentId: $ag, text: $t}}')" \
     "http://localhost:3100/api/plugins/$PLUGIN_ID/actions/send_to_telegram"
   ```

2. **Recipe B — paperclip event-driven notifications**: agent run lifecycle
   events (start, finish, error, escalation) trigger plugin event handlers
   that call the same `sendToTelegramTool` internally with proper context.
   The agent does not call the action; it just runs and the plugin reacts.
   Use this for "notify the chat when run completes" — it works on all
   adapters today.

3. **Recipe C — future MCP bridge**: when paperclipai gains an MCP-server
   manifest writer that exposes plugin tools to spawned CLIs, agents will be
   able to call `send_to_telegram` natively. This is a paperclipai feature
   request, not a plugin feature.

---

## Where the live wiring lives (for debugging)

| Concern | Source of truth |
|---|---|
| Per-company chat override | `ctx.state` key `telegram-chat` scoped to company. Read via `data` endpoint `chat-mapping` or `actions/set-chat` write. |
| Topic mapping per chat | `ctx.state` key `topic-map-<chatId>` (instance scope). Inspect via `/topics list` bot command. |
| Plugin config (`defaultChatId`, secret refs, etc.) | `GET /api/plugins/{id}/config` — returns full `configJson`. |
| Registered actions / tools | `GET /api/plugins/{id}` → `.manifestJson.tools`. |
| Active worker logs | Paperclip server log; lines tagged `service: "plugin-worker", pluginId: "<uuid>"`. |
| Per-call response | Paperclip REST log line for the `POST /actions/…` request includes `reqBody`. Use it to verify your `params` wrapper. |

---

## Known limitations

1. **No native MCP exposure** to spawned agent CLIs (see above).
2. **No `filePath` or URL fetch** for markdown — content must be inlined as
   `markdownContent`. The plugin rejects every file-source-like field to
   block path-traversal and SSRF risk.
3. **No raw binary attachments** — only `.md` documents. The plugin currently
   uploads `markdownContent` as a UTF-8 buffer named `*.md`. Other attachment
   types are not yet implemented.
4. **256 KiB content cap** for `markdownContent` and 1024 B for caption text.
5. **Single bot token per plugin instance** — every company shares the same
   bot. Per-company bots would need separate plugin instances (not currently
   supported by paperclipai).
6. **`allowedTelegramChatIds` is empty by default** — meaning *no* explicit
   `chatId` override is permitted; the action falls back to the per-company
   route. Set it intentionally if you want callers to choose targets.

---

## Quick reference

```
$PAPERCLIP_API_URL = http://localhost:3100  (iMac local) or https://paperclip.ant013.work  (tunnel)
$PLUGIN_ID         = 60023916-4b6c-40f5-829f-bc8b98abc4ed   (Gimle deployment; check yours)
$PAPERCLIP_API_KEY = pcp_board_*   (Board-scope token; agent tokens get 401)

Endpoints
  GET  /api/plugins/{PLUGIN_ID}                 # full plugin record + manifest
  GET  /api/plugins/{PLUGIN_ID}/config          # current configJson
  POST /api/plugins/{PLUGIN_ID}/config          # set config
  POST /api/plugins/{PLUGIN_ID}/actions/send_to_telegram          # outbound send
  POST /api/plugins/{PLUGIN_ID}/actions/send_file_to_telegram     # alias
  POST /api/plugins/{PLUGIN_ID}/actions/set-chat                  # set per-company chat
  POST /api/plugins/{PLUGIN_ID}/enable / disable                  # lifecycle

Body shape (always)
  { "params": { …action-specific fields… } }

Bot commands (in Telegram)
  /connect <CompanyName>           # bind chat to company
  /connect_topic <project> [topic] # map project to forum topic
  /topics list|remove|clear        # manage topic mappings
  /status, /issues, /agents, /approve, /create, /acp, /commands, /help
```
