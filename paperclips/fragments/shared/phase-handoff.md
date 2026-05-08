## Phase Handoff Discipline

Between phases, explicitly reassign the issue to the next agent. Never leave
"next action: someone should..." as the final state.

Required handoff operation:

1. PATCH the issue with `status + assigneeAgentId + comment` in one API call.
2. GET the issue and verify `assigneeAgentId` equals the expected next agent.
3. If verify mismatches, retry once with the same payload.
4. If it still mismatches, set `status=blocked`, comment actual vs expected, and
   assign or escalate to `TGCTO`.

Comment-only handoff is invalid. Writing a document that says "next owner is X"
without assigning the Paperclip issue is a stall.

### Handoff API Pattern

Use `PAPERCLIP_API_URL` and `PAPERCLIP_API_KEY` when present. If
`PAPERCLIP_API_KEY` is missing but `PAPERCLIP_BOARD_TOKEN` exists, use that token.

Never print, echo, log, or paste `PAPERCLIP_API_KEY`, `PAPERCLIP_BOARD_TOKEN`,
`API_TOKEN`, Authorization headers, or full request headers. It is acceptable to
print only whether a token is present, for example `API token: present`.

```bash
API_TOKEN="${PAPERCLIP_API_KEY:-${PAPERCLIP_BOARD_TOKEN:-}}"
curl -sS -X PATCH "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/handoff.json
```

The JSON payload must include all three:

```json
{
  "status": "in_review",
  "assigneeAgentId": "<next-agent-uuid>",
  "comment": "## Phase complete...\n\n[@TGCodeReviewer](agent://...?i=eye) your turn..."
}
```

### Handoff Comment Format

```markdown
## Phase N complete — brief result

Evidence:
- Branch: `<branch>`
- Commit: `<sha>`
- Verification: `<commands and result>`

[@<NextAgent>](agent://<uuid>?i=<icon>) your turn — Phase N+1: concrete task.
```

### Exit Protocol

After the PATCH returns success and GET-verify confirms the next assignee:

- stop tool use immediately;
- write a short final summary;
- do not re-fetch, do not post another comment, do not keep testing.

Paperclip may terminate the old run after reassignment. Extra tool calls after
handoff can make a successful handoff look like a failed run.

### Default TEL-23 Style Chain

Use the issue's explicit chain when provided. If no chain is provided, default:

`TGCTO -> TGCodeReviewer -> TGPluginEngineer -> TGCodeReviewer -> TGQAEngineer -> TGInfraEngineer -> TGQAEngineer -> TGCTO`

Failure routing:

- implementation defect -> `TGPluginEngineer`
- review approval -> `TGQAEngineer`
- local QA pass requiring deploy -> `TGInfraEngineer`
- deployment pass requiring smoke -> `TGQAEngineer`
- final smoke pass -> `TGCTO`
- unclear blocker -> `TGCTO`
