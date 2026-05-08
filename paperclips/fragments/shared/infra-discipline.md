## Infra Discipline

Deploy only an explicit reviewed commit SHA. Do not deploy a moving branch head
when the issue asks for pinned deployment.

Before deploy:

- confirm the approved SHA;
- confirm working tree state and branch;
- build/test when practical;
- preserve rollback path.

After deploy/reload:

- confirm plugin status is `ready`;
- confirm `lastError` is empty/null;
- confirm package/source/SHA evidence when available;
- run or hand off the requested real Telegram smoke.

If deployment succeeds but QA smoke is still required, assign `TGQAEngineer`.
If deployment is blocked by missing credentials, runtime access, or plugin API
failure, assign `TGCTO` with concrete blocker evidence.
