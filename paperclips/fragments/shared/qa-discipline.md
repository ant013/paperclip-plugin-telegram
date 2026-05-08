## QA Discipline

Do not only repeat another agent's test summary. Run the relevant checks yourself
when the environment allows it.

For this plugin, normal local verification is:

```bash
npm test
npm run build
```

For feature-specific QA:

- run targeted tests for the touched behavior;
- inspect static call paths for notification vs action separation when relevant;
- write a durable evidence artifact only if the issue requests it;
- include exact commands and pass/fail counts in the issue comment.

If local QA passes but deploy/smoke remains, assign `TGInfraEngineer`. Do not
finish with a comment that merely says infra should do it.

If post-deploy smoke passes, assign `TGCTO` for close/merge. If smoke fails,
assign `TGPluginEngineer` or `TGInfraEngineer` based on the failing layer.
