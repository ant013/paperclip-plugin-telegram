# TEL project-key routing for agent Telegram file sends

Status: Draft v2 for review
Date: 2026-05-08
Scope: spec-only; no implementation until review approval

## Summary

Add a dedicated `Files` routing section for the TelegramUpdate plugin so agent-initiated `send_to_telegram` Markdown document sends can route by Paperclip issue/project key without requiring every agent call to pass a raw Telegram `chatId`.

First release scope is intentionally narrow:

- applies only to TEL-8 outbound Markdown document sends:
  - `send_to_telegram`
  - legacy alias `send_file_to_telegram`
- routes by explicit `projectKey` or by the prefix parsed from `issueIdentifier`, for example `TEL-8` -> `TEL`
- preserves existing automatic notifications behavior
- preserves existing explicit `chatId` behavior from TEL-8
- fails closed for Markdown document sends when file routing is requested but unresolved or ambiguous
- leaves text-only `send_to_telegram` behavior unchanged in v1

This spec is for the TelegramUpdate/TEL plugin project. It must not introduce Gimle-specific examples, assumptions, or routing defaults.

## Background

Current plugin routing supports:

- `defaultChatId`
- `approvalsChatId` / `approvalsTopicId`
- `errorsChatId` / `errorsTopicId`
- `digestChatId` / `digestTopicId`
- `escalationChatId`
- company chat mapping through `/connect`
- project-to-topic mapping through `/connect_topic`
- TEL-8 `send_to_telegram` for text and `.md` document sends

Current TEL-8 behavior:

- `send_to_telegram(chatId=...)` sends to an explicit Telegram chat if allowed by existing explicit-chat rules.
- `send_to_telegram(...)` without explicit `chatId` falls back to company/default chat.
- Markdown document sends are content-only through `markdownContent`; arbitrary local file paths are rejected.

Current limitation:

- agents cannot say “send this TEL issue file to the TEL files chat” without knowing/passing a Telegram chat id.

## Non-goals

- Do not change Paperclip core event emission.
- Do not change automatic issue/run/error/approval/digest/escalation notifications in v1.
- Do not route text-only sends by project key in v1.
- Do not infer destinations from message body text, Markdown content, filenames, or captions.
- Do not add arbitrary regex routing in v1.
- Do not allow arbitrary local file paths or binary uploads.
- Do not remove or reinterpret existing routing settings.
- Do not merge implementation edits into this spec commit.

## Proposed config model

Add file-specific route rules to plugin config:

```json
{
  "fileRoutes": [
    {
      "name": "TEL files",
      "enabled": true,
      "projectKey": "TEL",
      "chatId": "-1002222222222",
      "topicId": "1"
    },
    {
      "name": "TEST files",
      "enabled": true,
      "projectKey": "TEST",
      "chatId": "-1003333333333"
    }
  ]
}
```

Rule fields:

- `name`: operator-facing route label; required; unique after trim.
- `enabled`: boolean; defaults to true.
- `projectKey`: exact uppercase Paperclip issue prefix such as `TEL`; required.
- `chatId`: Telegram destination chat id; required.
- `topicId`: optional Telegram forum topic id string.

Derived matching:

- `issueIdentifier: "TEL-8"` resolves `projectKey = "TEL"`.
- explicit `projectKey: "TEL"` resolves directly.
- v1 does not expose raw regex in UI or config.
- future versions may add advanced regex only after a separate review.

## UI requirements

Add a `Files` section to the existing plugin settings page.

UI should show a table/list with:

- enabled toggle
- route name
- project key
- chat id
- topic id
- remove action

Operator safety requirements:

- new routes default to disabled until required fields are valid
- project key input accepts uppercase letters/numbers only and is stored uppercase
- UI shows the effective rule: `projectKey TEL -> route "TEL files"` and explains that issue keys like `TEL-8` match by extracting the exact `TEL` prefix.
- UI blocks save when enabled routes have duplicate project keys
- UI blocks save when `chatId` is empty or malformed
- UI blocks save when `topicId` is non-numeric
- UI includes a small “test issue key” preview, for example `TEL-8 -> TEL files`
- UI must not require raw JSON editing

Existing `Approvals`, `Errors`, `Issues`, `Digests`, and default routing sections remain unchanged in v1.

## Destination resolver

Add a shared resolver for TEL-8 file sends:

```ts
resolveTelegramFileDestination(ctx, config, request): Promise<{
  ok: true;
  chatId: string;
  topicId?: number;
  source: "explicit" | "file_route" | "legacy_fallback";
  routeName?: string;
  projectKey?: string;
} | {
  ok: false;
  code:
    | "missing_destination"
    | "missing_route_context"
    | "unknown_project_route"
    | "ambiguous_route"
    | "invalid_route_config"
    | "conflicting_destination"
    | "unresolved_issue"
    | "disallowed_chat";
  message: string;
}>
```

The resolver is used by:

- `send_to_telegram`
- `send_file_to_telegram` alias through the same handler

The resolver is not used by automatic notifications in v1.

## Resolver input

Normalize action/tool parameters before routing:

- `explicitChatId`: from `chatId`
- `explicitThreadId`: from `threadId`
- `companyId`: current run/action company id
- `agentId`: current run/action agent id
- `issueId`: optional param
- `issueIdentifier`: optional param, for example `TEL-8`
- `projectKey`: optional param, for example `TEL`
- `hasMarkdownDocument`: true when `markdownContent` is present
- `hasText`: true when `text` is present

If `issueId` is present and `issueIdentifier` / `projectKey` are missing, the plugin may fetch the issue and derive `issueIdentifier`.

Issue lookup requirements:

- issue lookup must be scoped to the current `companyId`
- foreign-company, missing, or unresolvable `issueId` must fail closed with `unresolved_issue`
- `unresolved_issue` must be returned before any Telegram API call

Do not parse route context out of:

- `text`
- `markdownContent`
- `markdownFileName`
- Telegram caption content

## Precedence

For `send_to_telegram` Markdown document sends:

The resolver has three mutually exclusive destination modes:

1. Explicit mode:
   - caller provides `chatId`
   - caller must not provide `projectKey`, `issueIdentifier`, or `issueId`
   - caller may provide `threadId`
   - existing TEL-8 explicit-chat allowlist behavior applies
2. Route mode:
   - caller provides `projectKey`, `issueIdentifier`, or `issueId`
   - caller must not provide `chatId` or `threadId`
   - exact enabled `fileRoutes` match selects `chatId` and optional `topicId`
3. Legacy fallback mode:
   - caller provides no explicit destination and no route context
   - existing company/default fallback behavior applies

If explicit and route inputs are mixed, return `conflicting_destination` before any Telegram API call.

Topic behavior:

- explicit mode honors caller `threadId`
- route mode uses only `fileRoutes[].topicId`
- route-aware sends with caller `threadId` must return `conflicting_destination`
- legacy fallback keeps current TEL-8 thread behavior

Fail-closed cases:

- `markdownContent` is present and caller supplied `issueIdentifier`, `issueId`, or `projectKey`, but no enabled file route matches.
- `markdownContent` is present and caller supplied route context, but route config is invalid.
- multiple enabled file routes match the same normalized project key.
- route exists but has invalid chat/topic config.
- caller mixes explicit destination fields with route context.
- `issueId` cannot be resolved inside the current company.

Backward compatibility:

- existing `send_to_telegram(chatId=...)` behavior remains unchanged.
- existing text-only sends without route context may continue using company/default fallback.
- text-only sends do not use `fileRoutes` in v1, even if `issueIdentifier`, `issueId`, or `projectKey` are provided.
- existing Markdown sends without route context may continue using company/default fallback for compatibility, but new route-aware calls must fail closed when route resolution fails.

## Matching behavior

The resolver must evaluate all enabled file routes.

Algorithm:

1. Normalize route context:
   - if `projectKey` is provided, trim and uppercase it
   - otherwise parse `issueIdentifier` with `^([A-Z][A-Z0-9]*)-\d+$`
   - otherwise try issue lookup when `issueId` is provided
2. Select enabled routes where `route.projectKey === normalizedProjectKey`.
3. If zero routes match:
   - route-aware document send: return `unknown_project_route`
   - non-route-aware legacy send: continue fallback behavior
4. If one route matches: use it.
5. If more than one route matches: return `ambiguous_route`.

No config-order priority in v1.

## Config validation

Validate `fileRoutes` on save in UI and again at worker startup/action time.

Route object validation:

- `fileRoutes` must be an array when present
- `name` must be non-empty and unique after trim
- `projectKey` must match `^[A-Z][A-Z0-9]*$`
- enabled routes must not duplicate `projectKey`
- `chatId` must match `^-?\d+$` for enabled routes
- `topicId`, if present, must match `^\d+$`
- disabled invalid routes should be shown in UI but ignored by worker

Validation implementation requirements:

- UI save-time validation and worker/action-time validation must use the same validation rules
- UI must block save for invalid enabled routes
- worker/action-time validation must prevent invalid enabled routes from reaching Telegram

If worker sees invalid enabled route config:

- route-aware document sends must fail closed with `invalid_route_config`
- legacy fallback sends without route context may continue existing behavior
- log structured validation details without secrets or document content

## Chat safety

Do not reuse `allowedTelegramChatIds` as a global outbound allowlist for configured routes.

Reason:

- today `allowedTelegramChatIds` protects inbound commands and explicit TEL-8 `chatId` overrides
- configured plugin destinations such as `defaultChatId`, `approvalsChatId`, and `errorsChatId` are admin-managed settings
- `fileRoutes[].chatId` is also an admin-managed setting

Required behavior:

- explicit `chatId` keeps existing `allowedTelegramChatIds` behavior
- configured `fileRoutes[].chatId` is allowed because it is saved by an operator through plugin settings
- if a future global outbound allowlist is needed, add a separate setting such as `allowedOutboundRouteChatIds`

## Audit logging

Every `send_to_telegram` attempt should include structured routing context:

- `companyId`
- `agentId`
- `issueId`, if provided
- `issueIdentifier`, if provided/resolved
- `projectKey`, if provided/resolved
- `routeSource`
- `routeName`, if matched
- `chatId`
- `topicId`, if any
- `contentMode`: `message` or `document`
- Telegram `messageId`, when successful
- `errorCode`, when failed

Do not log:

- bot token
- secret refs
- Markdown document content
- text/caption body
- raw file content

Config-change audit:

- changes to `fileRoutes` should be logged with actor/user context when available
- audit log should include old/new route name, project key, chat id, topic id, enabled state, timestamp, and company/plugin context
- audit log must not include bot token, secret refs, message content, or document content

## Backward compatibility

Existing installs without `fileRoutes` behave exactly as today.

Unchanged in v1:

- automatic issue notifications
- automatic run lifecycle notifications
- agent error notifications
- approval notifications
- digest notifications
- escalation routing
- `/connect`
- `/connect_topic`
- explicit `send_to_telegram(chatId=...)`
- legacy `send_file_to_telegram` alias

## Acceptance criteria

- Operator can configure a `Files` route for `projectKey: "TEL"` with a Telegram chat id and optional topic id.
- Operator can configure a second neutral route such as `projectKey: "TEST"` for smoke isolation.
- `send_to_telegram` with `issueIdentifier: "TEL-8"` and `markdownContent` sends a `.md` document to the TEL file route destination.
- `send_to_telegram` with `projectKey: "TEL"` and `markdownContent` sends a `.md` document to the TEL file route destination.
- `send_to_telegram` with `issueId` can resolve the issue identifier and route to the matching file route when possible.
- Route-aware Markdown send with unmatched `issueIdentifier`, for example `OPS-1` when no `OPS` route exists, fails closed and does not call Telegram.
- Route-aware Markdown send with duplicate enabled `TEL` routes fails closed with `ambiguous_route` and does not call Telegram.
- Invalid enabled route config fails closed for route-aware Markdown sends.
- Existing explicit allowed `chatId` still works.
- Existing explicit disallowed `chatId` is rejected before calling Telegram.
- Route-aware Markdown send with both `chatId` and `issueIdentifier` fails with `conflicting_destination` before calling Telegram.
- Route-aware Markdown send with `threadId` but no explicit `chatId` fails with `conflicting_destination` before calling Telegram.
- Routed Markdown send uses `fileRoutes[].topicId`.
- Explicit `chatId + threadId` behavior remains unchanged.
- Route-aware Markdown send with foreign-company, missing, or unresolvable `issueId` fails with `unresolved_issue` before calling Telegram.
- Existing text-only sends without route context keep existing fallback behavior.
- Text-only sends do not use `fileRoutes` in v1.
- Existing Markdown sends without route context keep existing fallback behavior unless a later approved spec changes this.
- Automatic issue/run/error/approval/digest/escalation notifications remain unchanged.
- With `fileRoutes` configured, automatic notifications resolve to the same destinations as before and do not call the file resolver.
- Logs include route decision metadata but not content or secrets.
- `fileRoutes` config changes are auditable without leaking secrets/content.
- Full existing test suite still passes.

## Test plan

Required local checks:

```bash
npm test
npm run build
```

New focused tests:

- file destination resolver:
  - explicit chat wins
  - explicit `chatId + threadId` wins in explicit mode
  - route context mixed with `chatId` returns `conflicting_destination`
  - route context mixed with `threadId` returns `conflicting_destination`
  - projectKey route match
  - issueIdentifier route match
  - issueId enrichment route match
  - foreign-company or unresolvable issueId returns `unresolved_issue`
  - no route context uses legacy fallback
  - unmatched route-aware document fails closed
  - duplicate enabled projectKey fails closed
  - invalid enabled route config fails closed
  - disabled invalid route is ignored
  - numeric topic id is parsed
  - non-numeric topic id is rejected
  - routed sends use route `topicId`
- `send_to_telegram`:
  - TEL route sends Markdown document to route chat/topic
  - TEST route sends Markdown document to separate test chat/topic
  - unmatched route-aware Markdown does not call Telegram
  - explicit chat path still follows existing allowlist behavior
  - text-only no-context fallback still works
  - text-only sends do not use `fileRoutes`
- regression:
  - shared route validation is used by UI and worker/action-time paths
  - existing notification formatter tests pass
  - automatic notifications ignore `fileRoutes`
  - existing command/media/ACP/escalation/approval tests pass
  - existing TEL-8 file send tests pass or are updated only for explicit new route behavior

Production-safe smoke after implementation approval:

- configure two file routes:
  - `TEL` to one test Telegram chat/topic
  - `TEST` to another test Telegram chat/topic
- send a small Markdown document with `issueIdentifier: "TEL-8"`
- confirm document appears only in the TEL file destination
- send a small Markdown document with `issueIdentifier: "TEST-1"`
- confirm document appears only in the TEST file destination
- send a small Markdown document with `issueIdentifier: "OPS-1"` and no OPS route
- confirm plugin returns structured failure and no Telegram document appears
- prove no Telegram API send was attempted for the unmatched case using at least one negative-path oracle:
  - outbound log/metric showing no send attempt
  - Telegram request count unchanged
  - fallback/default destination checked before and after the call
- verify plugin logs show route name/message id for success and error code for failure without content leakage

## Open questions for review

1. What issue should own this work in Paperclip so all agents keep the cycle inside one issue?
2. Is route-aware text support explicitly deferred to a future spec?
3. Is config-change audit available through current plugin APIs, or should first implementation use structured logs only?

## Future work, separate spec required

- route automatic issue/run/error/approval notifications by project key
- route digests or escalations by project key
- add advanced regex routing
- add global outbound destination allowlist
- fan out multi-issue approvals across project routes
