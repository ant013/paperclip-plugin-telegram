# TEL project-key file routing implementation plan

Status: Draft for review
Date: 2026-05-08
Scope: plan-only; implementation starts only after spec and plan review approval

Spec: `docs/project-key-telegram-routing-spec.md`

## Goal

Implement v1 project-key routing for agent-initiated Telegram file sends in the TelegramUpdate plugin, inside one Paperclip issue.

The v1 implementation must:

- add a `Files` route table to plugin settings
- route `send_to_telegram` / `send_file_to_telegram` by `projectKey`, `issueIdentifier`, or `issueId`
- keep automatic notifications unchanged
- preserve TEL-8 explicit `chatId` behavior
- fail closed for route-aware Markdown document sends when routing is invalid, missing, or ambiguous
- prove the behavior with focused unit tests, full test suite, and real plugin smoke

## One-issue workflow rule

All work must stay inside the owning TEL issue.

Hard rules:

- Do not create child issues for normal implementation, review, QA, infra, or smoke.
- Create a child issue only for a real external blocker that cannot be resolved in the owning issue.
- Every agent must post status/evidence in the same issue before reassigning.
- Every agent must assign the issue to the next owner before finishing.
- If unsure who owns the next step, assign to `TGCTO`.

## Agent baton

Use this exact order unless the issue owner changes it in a comment:

1. `TGCTO`
2. `TGCodeReviewer`
3. `TGPluginEngineer`
4. `TGCodeReviewer`
5. `TGQAEngineer`
6. `TGInfraEngineer`
7. `TGQAEngineer`
8. `TGCTO`

Fallback owner: `TGCTO`.

## Phase 0: issue setup by TGCTO

Owner: `TGCTO`

Tasks:

- Create or select the single owning TEL issue.
- Confirm the issue title references project-key file routing.
- Confirm the issue description links:
  - `docs/project-key-telegram-routing-spec.md`
  - `docs/project-key-telegram-routing-plan.md`
- Confirm branch name:
  - recommended: `cx/tel-project-key-file-routing`
- State in the issue:
  - v1 is files/send_to_telegram only
  - automatic notifications are unchanged
  - no child issues without blocker approval

Exit criteria:

- issue contains branch/spec/plan links
- issue assigned to `TGCodeReviewer`

## Phase 1: spec and plan review by TGCodeReviewer

Owner: `TGCodeReviewer`

Review scope:

- spec scope is v1 files-only
- no Gimle/GIM examples or assumptions remain
- project-key matching is exact and deterministic
- TEL-8 backward compatibility is explicit
- route-aware Markdown fail-closed behavior is clear
- allowlist behavior is not conflated with inbound `allowedTelegramChatIds`
- acceptance criteria are testable
- this plan keeps all work inside one issue

Exit criteria:

- if changes needed:
  - comment findings in the same issue
  - assign back to `TGCTO`
- if approved:
  - comment approval in the same issue
  - assign to `TGPluginEngineer`

## Phase 2: implementation by TGPluginEngineer

Owner: `TGPluginEngineer`

Implementation slices:

1. Config and types
   - Add `fileRoutes` to `DEFAULT_CONFIG`.
   - Add TypeScript route types.
   - Add validation helpers for route object shape.

2. Resolver
   - Implement shared file destination resolver.
   - Normalize route context:
     - explicit `chatId`
     - explicit `threadId`
     - `projectKey`
     - `issueIdentifier`
     - `issueId` enrichment
   - Implement exact project-key matching.
   - Implement duplicate/ambiguous route failure.
   - Keep legacy fallback for no route context.

3. Tool/action integration
   - Extend `send_to_telegram` params:
     - `issueId`
     - `issueIdentifier`
     - `projectKey`
   - Route both text and Markdown through resolver.
   - Preserve explicit `chatId` behavior.
   - Preserve alias `send_file_to_telegram`.

4. Settings UI
   - Add `Files` section to routing settings.
   - Add route table:
     - enabled
     - name
     - project key
     - chat id
     - topic id
     - remove
   - Add preview/test issue key behavior.
   - Block save or show validation errors for invalid enabled routes.

5. Docs
   - Update README with:
     - `fileRoutes`
     - `send_to_telegram` route params
     - fail-closed behavior
     - smoke instructions

Constraints:

- Do not change automatic notification routing in v1.
- Do not add regex in v1.
- Do not change Paperclip core.
- Do not log message/document content.

Required checks before handoff:

```bash
npm test
npm run build
```

Exit criteria:

- commit implementation to the branch
- push branch
- comment in the issue:
  - commit SHA
  - changed files summary
  - test output summary
  - known risks
- assign to `TGCodeReviewer`

## Phase 3: implementation review by TGCodeReviewer

Owner: `TGCodeReviewer`

Review scope:

- resolver contract matches spec
- no notification routing behavior changed
- explicit `chatId` behavior preserved
- route-aware Markdown failure does not call Telegram
- UI validation matches worker validation
- tests cover no-route, duplicate-route, invalid-route, and legacy fallback
- logs redact content/secrets

Exit criteria:

- if changes needed:
  - comment exact findings
  - assign back to `TGPluginEngineer`
- if approved:
  - comment approval
  - assign to `TGQAEngineer`

## Phase 4: local QA by TGQAEngineer

Owner: `TGQAEngineer`

Tasks:

- Run full test suite:

```bash
npm test
npm run build
```

- Run targeted tests for:
  - TEL route document success
  - TEST route document success
  - unmatched route-aware document fail-closed
  - duplicate route fail-closed
  - explicit chat allowed/disallowed behavior
  - text-only no-context fallback

- Inspect README and settings UI behavior.

Exit criteria:

- comment QA evidence in the same issue
- assign to `TGInfraEngineer`

## Phase 5: deploy/reload by TGInfraEngineer

Owner: `TGInfraEngineer`

Tasks:

- Confirm branch and commit approved by review/QA.
- Build plugin on server.
- Reinstall/reload plugin from the approved branch/path.
- Confirm plugin status:
  - `ready`
  - `lastError: null`
- Do not change unrelated plugin settings.

Exit criteria:

- comment deployment evidence in the same issue:
  - commit SHA
  - package path
  - plugin status
  - timestamp
- assign to `TGQAEngineer`

## Phase 6: production-safe smoke by TGQAEngineer

Owner: `TGQAEngineer`

Smoke setup:

- Configure two file routes:
  - `TEL` -> test Telegram chat/topic
  - `TEST` -> second test Telegram chat/topic
- Use real installed plugin action endpoint.

Smoke cases:

1. TEL success
   - call `send_to_telegram` with `issueIdentifier: "TEL-8"` and small `markdownContent`
   - expect document in TEL route destination only

2. TEST success
   - call `send_to_telegram` with `issueIdentifier: "TEST-1"` and small `markdownContent`
   - expect document in TEST route destination only

3. unmatched fail-closed
   - call `send_to_telegram` with `issueIdentifier: "OPS-1"` and small `markdownContent`
   - expect structured failure
   - expect no Telegram document sent

4. explicit chat compatibility
   - call `send_to_telegram` with explicit allowed `chatId`
   - expect existing TEL-8 behavior

Evidence to post:

- action response JSON with secrets redacted
- Telegram message ids for successful document sends
- structured error code for fail-closed case
- plugin status after smoke
- log redaction confirmation

Exit criteria:

- comment all smoke evidence in same issue
- assign to `TGCTO`

## Phase 7: closeout and merge by TGCTO

Owner: `TGCTO`

Tasks:

- Confirm:
  - spec approved
  - plan approved
  - implementation reviewed
  - QA passed
  - deployment passed
  - live smoke passed
  - all evidence is in the same issue
- Merge according to repo policy.
- Reinstall/reload plugin from merged branch if needed.
- Mark issue `done`.

Exit criteria:

- issue status is `done`
- merged branch/commit is posted in issue
- plugin runtime is on merged code
- final comment lists:
  - merge SHA
  - tests
  - smoke message ids
  - plugin status

## Review gates

The issue must not advance to implementation until:

- spec is approved
- plan is approved
- scope is confirmed as v1 files-only

The issue must not close until:

- real Telegram smoke sends a Markdown file through the installed plugin
- fail-closed unmatched route smoke is proven
- plugin is running from merged code or closeout explicitly states why not

