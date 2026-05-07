# TEL-7 Implementation Plan: Human-Readable Bot and Agent Names

## Gate Status

- Spec branch: `cx/tel-7-human-readable-names-spec`
- Spec path: `docs/tel-7-human-readable-names-spec.md`
- Spec commit: `5a3abbc`
- Spec approval: accepted on 2026-05-07
- This plan is the next approval gate for [TEL-7](/TEL/issues/TEL-7). Runtime implementation starts only after this plan is accepted.

## Implementation Phases

### Phase 1: Shared Agent Label Resolution

Goal: make name enrichment consistent and non-fatal.

- Add a small helper in `src/worker.ts` or a focused helper module if the code reads cleaner after implementation.
- Resolve labels by precedence:
  1. existing payload fields: `agentName`, `displayName`, `name`
  2. `ctx.agents.get(agentId, companyId).name`
  3. cached company agent list lookup for configured IDs or user-entered agent keys
  4. existing session label
  5. ID fallback
- Keep lookup failures best-effort: log and continue message delivery.
- Use a worker-lifetime cache keyed by `companyId:agentId` where repeated run events could otherwise fan out.

Review gate: helper behavior is covered by focused unit tests or indirect worker/formatter tests before expanding call sites.

### Phase 2: Event Notification Enrichment

Goal: make Paperclip event notifications name-first.

- `src/worker.ts`
  - Replace duplicated approval/error/run lookup code with the shared resolver.
  - Ensure `approval.created`, `agent.run.failed`, `agent.run.started`, and `agent.run.finished` populate a display label before formatting.
  - Keep existing dedupe keys, event routing, topic routing, issue anchoring, and callback behavior unchanged.
- `src/formatters.ts`
  - Keep display name as primary text.
  - Keep full IDs in URLs and callback-independent operational data.
  - Add secondary ID text only if tests or review show it is useful and not noisy.

Review gate: formatter snapshots/assertions show name-first output and ID fallback for every changed event type.

### Phase 3: Interactive Agent Surfaces

Goal: make Telegram agent sessions and handoffs use resolved Paperclip names.

- `src/acp-bridge.ts`
  - When `/acp spawn` resolves a native Paperclip agent, store `agentDisplayName` from the resolved agent record instead of title-casing raw input.
  - Apply the same resolved-name behavior when auto-spawning through handoff and discuss flows.
  - Preserve session IDs in `/acp status`, cancel/close confirmations, state keys, and reply routing.
  - Keep ACP fallback labels based on user input because no Paperclip agent record exists.
- `src/escalation.ts`
  - Extend escalation event/storage shape to include an optional display label, or resolve just before sending the escalation notification.
  - Render the display label as `Agent:` and retain `agentId` only where needed for routing back to native sessions.

Review gate: session routing tests still prove reply-to and mention routing work after display-label changes.

### Phase 4: Configured Bot/Persona Targets

Goal: name configured Paperclip agent targets such as the brief agent.

- `src/media-pipeline.ts`
  - Resolve `briefAgentId` to an agent name before the media intake confirmation.
  - Keep the run button URL as `${publicUrl}/agents/${briefAgentId}/runs/${runId}`.
  - Keep the current confirmation behavior when lookup fails.
- README
  - Document that Paperclip agent names are used when resolvable.
  - Document that IDs remain in links and selected debug/session contexts.

Review gate: media pipeline tests show the label changes without changing the run link.

### Phase 5: Verification and Smoke

Goal: prove the behavior changed only where intended.

- Run focused tests:
  - `npm test -- --run tests/formatters.test.ts tests/escalation.test.ts tests/media-pipeline.test.ts tests/acp-bridge.test.ts`
- Run typecheck:
  - `npm run typecheck`
- If focused tests show shared type risk, run the full suite:
  - `npm test`
- Production-safe smoke checks after code review approval:
  - Trigger an agent run lifecycle event in an approved non-production or explicitly approved Telegram chat and verify the visible label is a name while the run button still opens.
  - Route one media intake item to the configured brief agent and verify the confirmation names the agent.
  - Trigger one escalation and verify the source agent is named without exposing prompt/private context.

Review gate: smoke evidence is posted to [TEL-7](/TEL/issues/TEL-7) before merge preparation.

## File-Level Impact

- `src/worker.ts`
  - Shared display-name resolver and event enrichment call sites.
- `src/formatters.ts`
  - Message text assertions and minor formatter fallback changes.
- `src/acp-bridge.ts`
  - Native session display-name source and handoff/discuss auto-spawn labels.
- `src/escalation.ts`
  - Optional source-agent display label in escalation rendering/storage.
- `src/media-pipeline.ts`
  - Brief agent label resolution for media confirmation.
- `README.md`
  - User-facing behavior note.
- Tests:
  - `tests/formatters.test.ts`
  - `tests/escalation.test.ts`
  - `tests/media-pipeline.test.ts`
  - `tests/acp-bridge.test.ts`
  - Worker-adjacent tests only if the shared resolver is not adequately covered through existing formatter/media/session tests.

## Compatibility and Rollback

- No new required settings.
- No callback data format changes.
- No state key changes.
- No routing, dedupe, or anchor-key changes.
- Rollback is a code revert of the implementation commit(s). Since URLs and callback payloads remain ID-based, rollback should not require data migration.
- Any new optional stored display-name field must be backward-compatible with existing session state. Missing names must continue to fall back to current labels.

## Subtask Plan After Approval

Implementation can be done as one bounded code task unless the board prefers parallel subtasks. If split, use these child issues after plan approval:

- Resolver and event notifications: `src/worker.ts`, `src/formatters.ts`, `tests/formatters.test.ts`
- Interactive/session labels: `src/acp-bridge.ts`, `src/escalation.ts`, related tests
- Media/README verification: `src/media-pipeline.ts`, `README.md`, related tests

Do not create these child issues until this plan is accepted.

## Open Review Questions

- Should normal run/error messages include a short agent ID suffix, or keep IDs only in links/logs? Plan default: keep normal messages name-first without inline IDs.
- Should brief agent display names be configurable if lookup fails? Plan default: no new setting for the first implementation.
- Should the shared resolver live in `worker.ts` or a separate helper file? Plan default: start in `worker.ts`, extract only if reuse across `media-pipeline.ts`/`escalation.ts` makes a helper materially clearer.
