# TEL-7 Spec: Human-Readable Bot and Agent Names

## Objective

Telegram notifications should identify Paperclip agents and bot/persona targets with stable human-readable names whenever the plugin has enough Paperclip context. Opaque agent IDs, run IDs, and session IDs should remain available only as secondary context where they are needed for routing, debugging, or deep links.

This spec is docs-only. Runtime implementation should wait for explicit spec and plan approval on [TEL-7](/TEL/issues/TEL-7).

## Current State

- `src/worker.ts` subscribes to Paperclip events and enriches some payloads before passing them to `src/formatters.ts`.
- `src/formatters.ts` already prefers `payload.agentName` for approval, agent error, run started, and run finished messages, but falls back directly to `agentId`.
- `src/worker.ts` already best-effort fetches `ctx.agents.get(agentId, companyId)` for approval and agent run events.
- `src/commands.ts` lists agents by `agent.name` in `/agents` and status-style command output.
- `src/acp-bridge.ts` stores `agentName` and `agentDisplayName` for interactive Telegram agent sessions, but session IDs still appear in some user-facing messages.
- `src/media-pipeline.ts` routes media to `briefAgentId` and currently confirms with the literal "Brief Agent" label plus the raw `runId`.
- `src/escalation.ts` renders `event.agentId` in escalation notifications, even when a display name could be resolved from `ctx.agents`.
- Links and callback payloads still require stable IDs, especially `agentId`, `runId`, approval IDs, session IDs, and Telegram callback data.

## Assumptions

- Paperclip agent records expose a stable `name` field through `ctx.agents.get(id, companyId)` and `ctx.agents.list({ companyId })`.
- Some events may include `agentName`, `name`, `assigneeName`, `linkedIssues`, or other denormalized display fields. These should be trusted when present because they preserve event-time context.
- The plugin cannot assume a human-readable name is always available. It must degrade cleanly to the current ID-based behavior.
- "Bot/persona" means Paperclip agent-like targets shown to Telegram users, including configured special agents such as `briefAgentId`, agent sessions spawned via `/acp`, handoff/discuss targets, and escalation source agents. The Telegram BotFather bot username is not currently used as a Paperclip actor identity.
- Public URLs still use IDs because Paperclip routes are ID-based in existing formatter helpers.
- Existing notification routing, callback behavior, state keys, and settings compatibility are out of scope for behavioral changes.

## Scope

In scope:

- Agent run notifications: `agent.run.started`, `agent.run.finished`, and `agent.run.failed`.
- Approval notifications that contain or can resolve `agentId`.
- Escalation notifications created by `escalate_to_human`.
- Media intake confirmation for configured `briefAgentId`.
- Interactive agent session messages in `/acp`, handoff, discuss, labeled agent output, and session status where labels are shown to Telegram users.
- Issue assignment notifications only where the plugin can enrich a missing `assigneeName` from Paperclip issue context.
- Tests that prove formatters and worker enrichment prefer names and keep ID fallback.
- README updates that describe name display and fallback behavior.

Out of scope:

- Renaming agents in Paperclip.
- Changing Telegram bot profile names or BotFather configuration.
- Changing Paperclip deep-link URL structure.
- Changing callback data formats, state key formats, dedupe keys, or routing identifiers.
- Adding new required plugin settings.
- Exposing private agent prompts, chain-of-command internals, or run payload internals in Telegram.

## Affected Files

- `src/worker.ts`
  - Centralize best-effort agent display-name enrichment for event payloads.
  - Reuse enrichment for approvals, agent errors, and agent run lifecycle notifications.
  - Optionally cache agent display names per company during a worker lifetime to avoid repeated lookups for high-frequency run events.
- `src/formatters.ts`
  - Render display names as primary text.
  - Render short secondary IDs only where useful and not noisy.
  - Keep deep-link buttons working with full IDs.
- `src/media-pipeline.ts`
  - Resolve `briefAgentId` to a display name before confirming media routing when possible.
  - Keep `runId` as secondary/debug context and in the "View Run" URL.
- `src/escalation.ts`
  - Accept or resolve an `agentName`/`agentDisplayName` for escalation source agents.
  - Fall back to `agentId` when resolution fails.
- `src/acp-bridge.ts`
  - Prefer resolved Paperclip agent `name` for native sessions instead of title-casing user input.
  - Keep session IDs visible only where they are operationally useful, such as `/acp status`, cancel confirmation, and debug-style metadata.
- `src/commands.ts`
  - Confirm `/agents` already uses `agent.name`; add tests only if behavior changes.
- `tests/formatters.test.ts`, `tests/media-pipeline.test.ts`, `tests/escalation.test.ts`, `tests/acp-bridge.test.ts`, and worker-adjacent tests
  - Add focused coverage for display-name preference and fallback behavior.
- `README.md`
  - Document that notifications use Paperclip display names when available and retain IDs for links/debug context.

## Naming Source of Truth

Primary precedence for a display label:

1. Event payload display fields already present at event time: `agentName`, then `displayName`, then `name`.
2. Paperclip agent lookup by `agentId` in the event company: `ctx.agents.get(agentId, companyId).name`.
3. Paperclip agent list lookup where only a configured agent ID or user-entered agent key is available.
4. Existing session display name from `ChatSession.agentDisplayName`.
5. Fallback to a stable identifier: `agentId`, configured `briefAgentId`, or a short session/run label depending on the surface.

Formatting rules:

- Primary label: human-readable name, escaped for the Telegram parse mode in use.
- Secondary context: only include IDs when the message would otherwise lose useful debugging context.
- Full IDs remain in link URLs, callback payloads, state keys, logs, and dedupe keys.
- If a label was derived from user input before an agent was resolved, prefer the resolved Paperclip `name` once available.

## Fallback Behavior

- If `ctx.agents.get` or `ctx.agents.list` fails, log at debug/warn level where useful and keep existing message delivery behavior.
- If a name is missing or blank, fall back to the current ID-based text.
- If `runId` is missing, run buttons should continue linking to the agent page where current behavior does that.
- Telegram messages must still send if enrichment fails. Name lookup failure is non-fatal.
- High-frequency run notifications should not introduce unbounded API fan-out. A simple in-memory cache scoped by `companyId:agentId` is acceptable, with direct payload fields bypassing lookup.

## Privacy and Redaction

- Do not expose raw agent IDs as primary user-facing labels when a display name exists.
- Do not add prompt text, private chain-of-command details, credentials, secret refs, or internal adapter metadata to Telegram messages.
- Run IDs and session IDs may be shown as secondary operational context only in places where users already need to debug or manage sessions.
- Public buttons may continue embedding full IDs in URLs because that is existing behavior and required for navigation.
- Avoid persisting extra personal data in plugin state. If a display name is stored in `ChatSession`, it should be the same user-visible agent name already shown in Telegram.

## Acceptance Criteria

- Agent run started/finished/error Telegram messages show the agent display name when Paperclip context provides or resolves one.
- Approval notifications show the requesting agent display name when the approval payload has `agentId` or `agentName`.
- Escalation notifications show the source agent display name when resolvable, not just `agentId`.
- Media intake confirmations name the configured brief agent when resolvable; otherwise they keep the existing "Brief Agent" or ID fallback.
- Multi-agent session output and handoff/discuss messages consistently use resolved agent names for native Paperclip agents.
- Existing routing, callback approval/rejection, issue thread anchoring, dedupe behavior, and Telegram parse modes continue to work.
- Existing users do not need to change plugin settings.
- Tests cover both name-present and lookup-failure/ID-fallback paths.

## Verification Plan

- Unit tests:
  - `tests/formatters.test.ts`: name-first rendering and ID fallback for run/error/approval formatters.
  - `tests/escalation.test.ts`: escalation message includes source display name when provided/resolved and falls back to ID.
  - `tests/media-pipeline.test.ts`: brief agent confirmation uses resolved name and keeps run link intact.
  - `tests/acp-bridge.test.ts`: native session display names use resolved Paperclip agent names and keep session routing intact.
- Focused command:
  - `npm test -- --run tests/formatters.test.ts tests/escalation.test.ts tests/media-pipeline.test.ts tests/acp-bridge.test.ts`
- Type safety:
  - `npm run typecheck`
- Production-safe smoke checks after implementation approval:
  - In a non-production or explicitly approved Telegram chat, trigger one agent run lifecycle event and confirm the visible label is a name while links still open the run.
  - Trigger a media intake route to the configured brief agent and confirm the visible label is human-readable.
  - Trigger one escalation and confirm the source agent is named without exposing extra private context.

## Open Questions

- Should secondary IDs be shown inline in normal notifications, or only kept in buttons/logs? Recommendation: keep normal messages name-first and avoid inline IDs except session management and explicit debug contexts.
- Should the plugin introduce a configurable label override for `briefAgentId`, or is Paperclip agent lookup sufficient? Recommendation: avoid a new setting unless lookup cannot reliably cover the configured agent.
- Should agent display-name lookups be cached with TTL or worker-lifetime only? Recommendation: worker-lifetime cache is enough for the first implementation and avoids stale persisted state.
- Should Telegram bot `getMe` username appear anywhere in notifications? Recommendation: no, because the issue is about Paperclip bot/agent/persona names, and Telegram already shows the sending bot in chat UI.

## Review Gate

After this spec is reviewed and approved, the next step is a separate implementation plan document for [TEL-7](/TEL/issues/TEL-7) covering phases, file-level changes, tests, smoke checks, rollback notes, and review gates. No runtime code should be implemented for this issue until both this spec and that plan are approved.
