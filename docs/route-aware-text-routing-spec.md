# Route-aware routing for text-only Telegram sends

Status: proposed; spec-only until explicit approval

Date: 2026-07-16

Branch: `cx/route-aware-text-routing`

Base: `c0423e458d13e2d4f96c5c9c771275b0f3229373` (`origin/main`)

## 1. Goal

Apply the existing operator-managed `fileRoutes` destination contract to
route-aware text-only `send_to_telegram` calls as well as Markdown document
calls.

A caller that supplies `projectKey`, `issueIdentifier`, or `issueId` is making
an explicit routing request. The plugin must either resolve that request to one
unambiguous enabled route or fail before calling Telegram. It must not silently
discard route context and send text to the company/default chat.

Text-only calls without route context keep their current company/default
fallback behavior. Automatic notifications and other plugin routing systems are
unchanged.

## 2. Background and observed behavior

At the base commit:

- `sendToTelegramTool` calls `resolveTelegramFileDestination` only when
  `markdownContent` is present;
- a text-only call with `projectKey` therefore uses `legacy_fallback`;
- the current unit test explicitly preserves that behavior;
- a successful document route returns `routeName`, `projectKey`, and resolved
  `issueIdentifier`, while a successful text message currently omits them;
- `resolveRouteContext` accepts an explicit `projectKey` without checking that
  it agrees with a supplied/resolved issue identifier.

The downstream delivery design requires a zero-finding audit summary to be a
text-only message while retaining the same configured project route used by a
document report. This plugin change remains generic: it introduces no
consumer-specific route, key, chat ID, topic, or message template.

This document supersedes only the earlier
`docs/project-key-telegram-routing-spec.md` decision that route fields on
text-only sends are ignored. The existing configuration and route-selection
contract remains authoritative otherwise.

## 3. Assumptions and decisions

- `fileRoutes` remains the configuration field name. Renaming it is unnecessary
  migration churn even though it will serve both text and document payloads.
- Route context is destination intent, independent of payload mode.
- Configured route destinations remain operator-managed and do not use the
  explicit `allowedTelegramChatIds` gate.
- Explicit `chatId` behavior and its allowlist do not change.
- Existing text-only calls with no route context must remain backward
  compatible.
- Existing text-only calls that supplied route fields but relied on those fields
  being ignored intentionally change behavior. They will route or fail closed.
- The plugin does not add an idempotency key or exactly-once delivery semantics.
- No route is inferred from text, caption, filename, or Markdown content.

## 4. Scope

### Included

- resolve `fileRoutes` for text-only action calls with route context;
- return route metadata for successful routed text messages;
- validate agreement among multiple supplied route-context fields;
- preserve no-context text fallback and existing document routing;
- update unit tests, action descriptions, README, and integration docs;
- document the compatibility change for route-aware text callers.

### Excluded

- new configuration fields or settings UI changes;
- changes to automatic issue/run/error/approval/digest/escalation routing;
- changes to `opsRoutes`, `/connect`, or `/connect_topic`;
- hard-coded routes or defaults for any downstream project;
- changes to Telegram chat/topic configuration;
- arbitrary files, binary uploads, local paths, or URL ingestion;
- message deduplication or an idempotency protocol;
- live Telegram sends without explicit operator authorization;
- unrelated worker or routing refactors.

## 5. Behavior matrix

| Payload | Destination input | Required behavior |
|---|---|---|
| text only | no route context, no explicit chat | existing company/default fallback |
| text only | explicit `chatId`, no route context | existing explicit-chat behavior |
| text only | valid route context | matching `fileRoutes` destination |
| text only | invalid, unknown, ambiguous, or conflicting route context | fail before Telegram |
| document with optional caption | no route context | existing explicit/fallback behavior |
| document with optional caption | valid route context | existing route behavior |
| document with optional caption | invalid, unknown, ambiguous, or conflicting route context | fail before Telegram |
| any | route context mixed with `chatId` or `threadId` | `conflicting_destination` |

The aliases `send_to_telegram` and `send_file_to_telegram` share the same
handler and therefore the same matrix.

## 6. Route-aware definition

A call is route-aware when at least one raw route field represents destination
intent:

- `projectKey`;
- `issueIdentifier`;
- `issueId`.

For each route field, missing property, `undefined`, `null`, empty string, and
whitespace-only string are absent. A non-empty string is present. Any other JSON
type (`number`, `boolean`, array, or object) is present but invalid and returns
`invalid_route_context`; it must never downgrade to legacy fallback.

Raw route strings are bounded before normalization:

- `projectKey`: at most 32 Unicode code points;
- `issueIdentifier`: at most 64 Unicode code points;
- `issueId`: at most 128 Unicode code points.

Oversized strings, control characters, and malformed non-empty strings return
`invalid_route_context` without echoing their value.

Payload mode does not participate in this decision. In particular,
`markdownContent` is not a prerequisite for route resolution.

### 6.1. Destination-input presence

When a valid route field is present, any raw explicit `chatId` or `threadId`
intent conflicts with route mode. Non-empty strings/numbers and malformed
non-null values count as intent; they cannot be discarded by string coercion.
This rule is specific to mixed route/explicit input. No-route validation keeps
the existing explicit/legacy contract.

### 6.2. Validation and error precedence

After existing content/source/filename safety checks, destination validation is
ordered:

1. Validate raw route-field types, lengths, and characters. Failure returns
   `invalid_route_context`.
2. If at least one syntactically valid route field and any explicit chat/thread
   intent are present, return `conflicting_destination` without issue lookup.
3. Validate/resolve issue context. An unresolvable valid `issueId` returns
   `unresolved_issue`.
4. Compare normalized project keys and identifiers. Disagreement returns
   `conflicting_route_context`.
5. Validate route configuration and select an exact route.
6. Only no-route calls proceed to existing explicit/legacy destination logic.

Therefore:

- unresolved `issueId` + `chatId` → `conflicting_destination`;
- malformed `projectKey` + `threadId` → `invalid_route_context`;
- valid route context + invalid/non-null `threadId` →
  `conflicting_destination`;
- wrong JSON type in any route field → `invalid_route_context`.

All these failures occur before Telegram API calls.

## 7. Route-context normalization and consistency

After raw-field and mixed-destination validation from section 6, the resolver
derives candidates without using precedence to hide conflicts:

1. If `issueId` is supplied, resolve it through the current company-scoped issue
   lookup. Missing, foreign-company, or unresolved issues return
   `unresolved_issue`, even if another context field is present.
2. Normalize non-empty `projectKey` using the existing uppercase project-key
   rule. A malformed value returns `invalid_route_context`.
3. Normalize non-empty `issueIdentifier` to uppercase and parse its exact
   project prefix. A malformed identifier returns `invalid_route_context`.
4. Parse the project prefix from the issue identifier resolved from `issueId`.
   A resolved but unroutable identifier returns `invalid_route_context`.
5. Compare every derived project key. More than one distinct key returns
   `conflicting_route_context`.
6. When both explicit and resolved issue identifiers exist, they must be equal
   after normalization. A mismatch returns `conflicting_route_context`, even if
   their project prefixes happen to match.

Accepted examples:

- `projectKey="tel"` normalizes to `TEL`;
- `issueIdentifier="tel-23"` normalizes to `TEL-23` and derives `TEL`;
- `projectKey="TEL"` plus `issueIdentifier="TEL-23"` agrees;
- `issueId` resolving to `TEL-23` plus explicit `issueIdentifier="TEL-23"`
  agrees.

Rejected examples:

- `projectKey="TEL"` plus `issueIdentifier="OPS-1"`;
- `issueId` resolving to `TEL-23` plus `issueIdentifier="TEL-24"`;
- malformed non-empty `projectKey` or `issueIdentifier`;
- route context mixed with explicit `chatId` or `threadId`.

The consistency rules apply to both text and document sends. Document calls
with multiple agreeing fields continue to work; document calls whose explicit
project/issue fields disagree intentionally become fail closed.

## 8. Destination resolution

`sendToTelegramTool` invokes the shared destination resolver for both message
and document modes.

The resolver keeps its three result sources:

- `explicit` — explicit allowed `chatId` without route context;
- `file_route` — exactly one enabled route matches the normalized project key;
- `legacy_fallback` — no explicit chat and no route context.

For a route-aware call:

1. validate context consistency;
2. validate enabled `fileRoutes`;
3. select routes with exact normalized `projectKey`;
4. fail with `unknown_project_route` when none match;
5. fail with `ambiguous_route` when more than one matches;
6. otherwise use the configured `chatId` and optional `topicId`.

No-context fallback returns before route-config validation, so an unrelated bad
route cannot regress legacy text delivery. Route-aware calls remain fail closed
for invalid enabled route configuration.

The existing function name `resolveTelegramFileDestination` may remain for
backward compatibility and minimal diff. A broad rename is not required by this
feature.

## 9. Result and error contract

A successful routed text-only result contains:

```json
{
  "ok": true,
  "mode": "message",
  "chatId": "configured-route-chat",
  "threadId": 44,
  "messageId": 101,
  "routeSource": "file_route",
  "routeName": "route label",
  "projectKey": "TEL",
  "issueIdentifier": "TEL-23"
}
```

`threadId` and `issueIdentifier` remain optional when the matched route or
request does not provide them. Project-key-only routed calls still return
`projectKey` and `routeName`.

Document result behavior is unchanged. Explicit and legacy message results do
not invent route metadata.

New context-validation error codes:

- `invalid_route_context` — a supplied non-empty route field cannot be
  normalized or parsed;
- `conflicting_route_context` — supplied/resolved route fields disagree.

Existing destination/config errors remain unchanged:

- `unresolved_issue`;
- `conflicting_destination`;
- `unknown_project_route`;
- `ambiguous_route`;
- `invalid_route_config`;
- `disallowed_chat`.

Every failure above occurs before `sendMessage` or `sendDocument`.
Error responses may include the invalid field name and error code, but never its
raw rejected value.

## 10. Audit logging and privacy

Routed text attempts use the existing structured outbound audit log and include:

- content mode `message`;
- route source/name;
- normalized project key;
- explicit/resolved issue identifier when available;
- destination chat/topic metadata;
- message ID on success or error code on failure.

Only validated, bounded route metadata may be logged. On
`invalid_route_context`, logging is limited to field name, content mode, and
error code. The current fallback that copies raw request route strings into log
metadata must not run for rejected context.

The plugin must not log:

- message or caption body;
- Markdown content;
- bot token or secret references;
- arbitrary issue content.

Tests use control characters, oversized text, and a secret-like marker in each
rejected route field and assert that the original value appears in neither the
structured log nor the action response.

No new log sink or credential access is introduced.

## 11. Backward compatibility

Unchanged:

- text-only send without route context;
- explicit allowed/disallowed `chatId` behavior;
- optional explicit `threadId` in non-route mode;
- no-context document fallback;
- routed document upload/caption behavior for no-context, single-context, and
  mutually agreeing multi-context calls;
- route-config validation rules;
- configured route chat/topic authorization model;
- automatic notification destinations;
- tool aliases and content/file safety limits.

Intentional compatibility changes:

- text-only calls that provide route context no longer discard it. They resolve
  through `fileRoutes` or fail closed;
- text and document calls with mutually inconsistent `projectKey`,
  `issueIdentifier`, or resolved `issueId` now fail instead of allowing explicit
  `projectKey` precedence to hide the conflict.

This change is host-global for consumers of the installed plugin. Release notes
and rollout checks must call it out explicitly.

## 12. Affected areas

Expected implementation files:

- `src/worker.ts` — invoke the resolver for both payload modes, return message
  route metadata, and update action parameter descriptions;
- `src/file-routing.ts` — validate all route-context candidates and conflicts;
- `tests/send-to-telegram.test.ts` — behavior and regression matrix;
- `README.md` — route-aware text contract and parameter descriptions;
- `docs/paperclip-integration.md` — integration/error/response documentation.

No UI, manifest configuration shape, automatic notification formatter, or
Telegram API transport change is expected.

## 13. Acceptance criteria

1. Text-only `projectKey` call sends through the matching enabled route and uses
   its topic when configured.
2. Text-only `issueIdentifier` call derives the project and routes correctly.
3. Text-only `issueId` resolves within the current company and routes correctly.
4. Routed text success returns `mode=message`, `file_route`, route name, project
   key, resolved identifier when available, and Telegram message ID.
5. Unknown, ambiguous, or invalid route configuration prevents text delivery.
6. Malformed non-empty route fields fail with `invalid_route_context`.
7. Wrong-type, oversized, or control-character route fields fail with
   `invalid_route_context` and never fall back.
8. Disagreeing project key/identifier/resolved issue fields fail with
   `conflicting_route_context`.
9. Route context mixed with explicit chat/thread, including malformed explicit
   values, fails with
   `conflicting_destination`.
10. The documented error precedence is stable for inputs with multiple faults.
11. Unresolved or foreign-company `issueId` fails even when `projectKey` is also
   supplied.
12. No-context text-only calls retain the existing `legacy_fallback` destination.
13. Explicit text chat behavior and allowlist checks remain unchanged.
14. Existing document routing, caption, filename, and content safety tests pass;
    agreeing multi-field documents succeed and conflicting ones fail closed.
15. Automatic notification routing tests pass unchanged.
16. No failure case calls the Telegram API.
17. Logs contain only validated routing metadata and never rejected raw values,
    message/document bodies, or secrets.
18. Public README, integration docs, and action descriptions no longer describe
    route fields as document-only.

## 14. Verification plan

Targeted tests cover:

- text route by `projectKey`, `issueIdentifier`, and `issueId`;
- route topic propagation and structured success metadata;
- unknown/duplicate/invalid route config;
- malformed and mutually conflicting route contexts;
- number, boolean, array, and object fixtures for every route field;
- oversized/control-character/secret-like rejected values with log and response
  redaction assertions;
- route context mixed with explicit chat/thread;
- table-driven multi-fault error-precedence cases;
- unresolved company-scoped issue lookup;
- no-context text fallback and explicit-chat regression;
- existing routed/no-context document behavior;
- agreeing and conflicting multi-field document route contexts;
- outbound audit log body redaction.

Commands:

```bash
npm ci
npm run typecheck
npx vitest run tests/send-to-telegram.test.ts
npm test
npm run build
```

A real Telegram smoke is outside automated verification and requires explicit
operator authorization. Before a downstream consumer enables route-aware
text-only production delivery, deployment must prove the worker is running the
new full commit SHA and successfully send one canary to a non-production route.

## 15. Rollback

Rollback restores the previous plugin commit and reloads the worker. Consumers
must disable route-aware text-only delivery before rollback because the old
worker silently returns such calls to legacy fallback.

No configuration rollback is required: `fileRoutes` shape is unchanged.

## 16. Open questions and stop conditions

There are no open product questions.

Stop and request review if implementation requires:

- a new config field or settings migration;
- changes to automatic notification routing;
- a change to explicit-chat authorization;
- consumer-specific routing logic;
- an idempotency or message-deduplication protocol;
- broader file-routing refactoring beyond this contract.
