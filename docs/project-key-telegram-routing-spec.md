# Project-key Telegram routing

Status: Draft for review
Date: 2026-05-08
Scope: spec-only; no implementation until review approval

## Summary

Add configurable Telegram destination routing by Paperclip issue/project key, so events and agent-initiated file sends can route `GIM-*`, `TEL-*`, or other project families to different Telegram chats/topics.

The feature must extend the existing Telegram plugin routing model. It must not replace current defaults, per-type destinations, forum topic routing, or the TEL-8 `send_to_telegram` tool.

Primary goal:

- route outbound Telegram delivery based on issue identifiers such as `GIM-123` or `TEL-8`
- support a dedicated `Files` routing section for agent outbound text/Markdown document sends
- keep approvals/errors/issues/digests behavior predictable and backward-compatible
- prevent accidental cross-chat leakage, especially for documents

## Background

Current plugin routing already supports:

- `defaultChatId`
- `approvalsChatId` / `approvalsTopicId`
- `errorsChatId` / `errorsTopicId`
- `digestChatId` / `digestTopicId`
- `escalationChatId`
- company chat mapping through `/connect`
- project-to-topic mapping through `/connect_topic`
- `send_to_telegram` explicit agent/tool delivery for text and `.md` documents

Current limitations:

- destination selection does not use issue identifier prefixes like `GIM` or `TEL`
- `send_to_telegram` routes by explicit `chatId` or configured company/default chat only
- automatic notifications and agent file sends do not share a route policy beyond the fallback chat behavior
- a single default chat cannot cleanly separate projects into multiple Telegram groups

## Non-goals

- Do not change Paperclip core event emission.
- Do not infer destinations from message body text or Markdown file content.
- Do not send arbitrary local files; TEL-8 remains content-only for Markdown documents.
- Do not add a broad scripting/rules engine.
- Do not remove existing `approvalsChatId`, `errorsChatId`, `digestChatId`, `escalationChatId`, `/connect`, or `/connect_topic` behavior.
- Do not implement code in this spec commit.

## Proposed config model

Add route rules to plugin config:

```json
{
  "notificationRoutes": [
    {
      "id": "gim-files",
      "enabled": true,
      "issueIdentifierPattern": "^GIM-\\d+$",
      "chatId": "-1001111111111",
      "topicId": "1",
      "appliesTo": ["files"]
    },
    {
      "id": "tel-all",
      "enabled": true,
      "issueIdentifierPattern": "^TEL-\\d+$",
      "chatId": "-1002222222222",
      "appliesTo": ["files", "issues", "runs", "errors", "approvals"]
    }
  ]
}
```

Rule fields:

- `id`: stable operator-readable rule id; required; unique.
- `enabled`: boolean; defaults to true.
- `issueIdentifierPattern`: anchored JavaScript regex string; required for first release.
- `chatId`: Telegram destination chat id; required.
- `topicId`: optional Telegram forum topic id string.
- `appliesTo`: one or more route categories.

Initial `appliesTo` values:

- `files`: `send_to_telegram` text/Markdown document sends
- `issues`: issue created/done/assigned notifications
- `runs`: agent run started/finished notifications
- `errors`: agent run failed notifications
- `approvals`: approval created notifications

Future-compatible fields, not required for first implementation:

- `projectId`
- `projectKey`
- `projectNamePattern`
- `companyId`

## UI requirements

Add a `Files` routing section in the existing plugin settings routing page.

Recommended UI:

- a table/list of route rules
- columns:
  - enabled
  - rule id
  - issue pattern
  - applies to
  - chat id
  - topic id
- add/remove row controls
- validation summary before save

The UI should not require operators to edit raw JSON.

The existing `Approvals`, `Errors`, `Issues`, `Digests`, and default sections remain visible. The route table should make it clear that project-key rules can override those sections when a rule matches.

## Destination resolver

Implement a shared destination resolver in plugin worker code:

```ts
resolveTelegramDestination(ctx, config, request): Promise<{
  ok: true;
  chatId: string;
  topicId?: number;
  source: "explicit" | "route" | "per_type" | "company" | "default";
  routeId?: string;
} | {
  ok: false;
  code: "missing_destination" | "ambiguous_route" | "invalid_route_config" | "disallowed_chat";
  message: string;
}>
```

The resolver should be used by:

- automatic `notify(...)` event path
- TEL-8 `send_to_telegram`
- legacy `send_file_to_telegram` alias through the same path

Do not duplicate routing logic in individual event handlers.

## Route context

Resolver input should include:

- `category`: one of `files`, `issues`, `runs`, `errors`, `approvals`, `digests`, `escalations`
- `companyId`
- `eventType`, when available
- `entityId`, when available
- `issueId`, when available
- `issueIdentifier`, when available
- `issueTitle`, when available
- explicit `chatId` / `threadId`, when supplied by a tool/action
- per-type fallback chat/topic, when the caller has one

For automatic notifications:

- issue events already have `identifier` in payload or can use `event.entityId` fallback only for display, not routing unless it is a canonical issue identifier
- run events should call the existing issue enrichment path to populate `issueIdentifier`
- approval events may link multiple issues and require special handling

For `send_to_telegram`:

- add optional params:
  - `issueId`
  - `issueIdentifier`
  - `projectKey`
- if `issueId` is provided and `issueIdentifier` is missing, the plugin may fetch the issue to resolve its identifier
- do not parse `issueIdentifier` out of `text` or `markdownContent`

## Precedence

For explicit agent file/text sends:

1. explicit `chatId` if provided and allowed
2. matching `notificationRoutes` rule for category `files`
3. fail closed with structured error

Rationale: files/documents carry higher leakage risk than short lifecycle notifications. If no route is clear, the plugin must not guess by falling back to default.

For automatic notifications:

1. matching `notificationRoutes` rule for the notification category
2. existing per-type destination, for example `approvalsChatId` or `errorsChatId`
3. company `/connect` chat mapping
4. `defaultChatId`
5. drop if no destination exists

For topics:

1. explicit `threadId`/`topicId`
2. route rule `topicId`
3. per-type topic id
4. existing project-to-topic mapping, if enabled and compatible with the selected chat
5. no topic id

## Matching behavior

Rules are evaluated in config order.

For first release:

- first matching enabled rule wins
- all specified criteria must match
- `issueIdentifierPattern` must use `RegExp.test(issueIdentifier)` after validation
- only one route should match in normal operation

Ambiguity:

- for `files`, multiple matching rules must fail closed with `ambiguous_route`
- for automatic notifications, multiple matching rules should not send to either matching chat; fall back to per-type/default route and log a warning

No issue context:

- `files`: fail closed unless explicit `chatId` is allowed
- `runs`: use route only if issue context exists; otherwise existing errors/run/default behavior
- `approvals`: use route only if linked issue context is unambiguous
- `issues`: should normally have identifier; if missing, existing fallback behavior applies

## Regex safety

General regex is powerful and risky. Add validation before any rule becomes active.

Validation requirements:

- max pattern length: 80 characters
- must compile with JavaScript `RegExp`
- must be anchored with `^` and `$`
- reject empty patterns
- reject flags in first release
- reject patterns containing:
  - lookahead/lookbehind: `(?`
  - backreferences: `\1`, `\2`, etc.
  - nested quantifier-like constructs that are known ReDoS risks
- recommended common pattern: `^GIM-\\d+$`

If validation fails:

- UI must show the invalid rule and prevent save when practical
- worker must ignore invalid rules and log `invalid_route_config`
- files must not fall back to default because of invalid route config

## Chat allowlist and safety

Route rule `chatId` values must be treated as outbound destinations.

Required behavior:

- if `allowedTelegramChatIds` is non-empty, every route `chatId` must be in it
- explicit `chatId` behavior remains unchanged from TEL-8
- route rules must never introduce a way to send to arbitrary chats outside configured destinations
- logs must not include bot tokens, secret refs, file content, or document body

## Audit logging

Every outbound send attempt should emit structured log context:

- `category`
- `eventType`, if any
- `issueIdentifier`, if any
- `routeSource`
- `routeId`, if any
- `chatId`
- `topicId`, if any
- `contentMode`: `message` or `document`
- Telegram `messageId`, when successful
- `dropReason` or `errorCode`, when failed

Do not log Markdown content or captions.

## Backward compatibility

Existing installs without `notificationRoutes` must behave exactly as today:

- existing issue notifications keep using current fallback resolution
- approvals still use `approvalsChatId` if configured
- errors still use `errorsChatId` if configured
- digests still use `digestChatId` if configured
- `/connect` and `/connect_topic` keep working
- explicit `send_to_telegram(chatId=...)` keeps working under the existing allowlist rules

## Acceptance criteria

- Operator can configure at least two route rules, for example `^GIM-\\d+$` and `^TEL-\\d+$`, with distinct Telegram chats.
- `send_to_telegram` with `issueIdentifier: "GIM-123"` sends a Markdown document to the GIM route chat.
- `send_to_telegram` with `issueIdentifier: "TEL-8"` sends a Markdown document to the TEL route chat.
- `send_to_telegram` without explicit chat and without route context fails closed for documents.
- Explicit allowed `chatId` still works for `send_to_telegram`.
- Explicit disallowed `chatId` is rejected before calling Telegram.
- `issue.created` for `GIM-*` routes to the GIM chat when the rule applies to `issues`.
- `agent.run.failed` for a `TEL-*` issue routes to the TEL chat when the rule applies to `errors`.
- `agent.run.failed` without issue context keeps existing `errorsChatId`/default behavior.
- `approval.created` with all linked issues matching one route uses that route when it applies to `approvals`.
- `approval.created` with linked issues matching different routes does not guess; it falls back to approval/default route and logs ambiguity.
- Invalid regex rules are rejected or ignored safely.
- Multiple matching file routes fail closed.
- Route chat ids obey `allowedTelegramChatIds` when configured.
- Existing tests for notifications, commands, media, ACP, escalation, approvals, and TEL-8 file send still pass.

## Test plan

Required local checks:

```bash
npm test
npm run build
```

New focused tests:

- destination resolver:
  - first-match-wins or ambiguity behavior as specified
  - invalid regex rejection
  - category filtering
  - allowlist rejection
  - topic precedence
  - no-route file fail-closed
- worker notification path:
  - issue event route match
  - run event with issue context route match
  - run error without issue context fallback
  - approval single-route match
  - approval multi-route ambiguity fallback
- `send_to_telegram`:
  - `issueIdentifier` route to document
  - `issueId` enrichment to identifier
  - explicit `chatId` override
  - missing route context document failure
  - multiple route match document failure

Production-safe smoke after implementation approval:

- configure two real route rules:
  - `^GIM-\\d+$` to one test Telegram chat/topic
  - `^TEL-\\d+$` to another test Telegram chat/topic
- send a small TEL-8-style Markdown document with `issueIdentifier: "GIM-1"`
- confirm document appears only in the GIM destination
- send a small Markdown document with `issueIdentifier: "TEL-1"`
- confirm document appears only in the TEL destination
- verify plugin logs show route id and message id without content leakage

## Open questions

1. Should automatic issue lifecycle notifications route by project key by default, or should first release apply only to `files`?
2. Should approvals/errors remain globally centralized unless a route explicitly includes `approvals`/`errors`?
3. Should route matching support plain `projectKey: "GIM"` in addition to regex for the first release?
4. Should route rules be fail-closed for all categories, or only for `files`?
5. Should route config changes require plugin restart, or should the worker re-read config dynamically if Paperclip supports it?

## Recommended implementation sequence after approval

1. Add config types/defaults and UI route table.
2. Implement and test `resolveTelegramDestination`.
3. Wire automatic `notify(...)` path to the resolver.
4. Extend `send_to_telegram` params and wire it to the resolver.
5. Add docs and README examples.
6. Run full tests, build, and production-safe smoke.

