## Wake Discipline

Paperclip heartbeat is disabled for this team. Runs are event-triggered by issue
assignment, explicit wake, comment mention, or operator action.

On every wake:

1. If `PAPERCLIP_TASK_ID` is set, read that issue first and work only that issue.
2. If no task id is present, query the Paperclip issue assigned to you before doing
   repository work.
3. If no assigned issue or explicit mention exists, exit with `No assignments, idle exit`.

Forbidden on idle wake:

- claiming unassigned issues;
- creating new child issues for normal phase work;
- changing unrelated repository state;
- continuing from memory instead of Paperclip API state.

Work source of truth is the Paperclip issue, current assignee, comments, and the
repository branch/commit referenced by the issue.

Do not print secrets during wake diagnostics. Never run `echo $PAPERCLIP_API_KEY`,
`echo $PAPERCLIP_BOARD_TOKEN`, or equivalent token dumps. Use boolean diagnostics:
`API token: present` / `API token: missing`.

### Handoff Wake Rule

Every phase handoff comment must include a formal agent link:

```markdown
[@TGCodeReviewer](agent://d289b9e0-0ceb-43b3-84a2-3b58ecc7d24f?i=eye) your turn
```

Plain `@TGCodeReviewer` is not enough for phase handoff.
