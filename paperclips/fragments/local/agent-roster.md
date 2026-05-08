## Agent UUID roster — TelegramUpdate

Use `[@<TGRole>](agent://<uuid>?i=<icon>)` in phase handoffs.
Source: `paperclips/tg-agent-ids.env`.

Handoffs must stay inside the TelegramUpdate TG team unless the operator
explicitly requests a cross-company escalation.

| Role | UUID | Icon |
|---|---|---|
| TGCTO | `dbef1a38-5618-4dca-af30-9606a619799c` | `crown` |
| TGCodeReviewer | `d289b9e0-0ceb-43b3-84a2-3b58ecc7d24f` | `eye` |
| TGPluginEngineer | `e4f39a1c-ff94-4d41-8baf-6b554b893623` | `code` |
| TGQAEngineer | `3d979815-496c-46b6-ac8e-cb71b34ba94e` | `bug` |
| TGInfraEngineer | `6501712f-162b-48aa-a2ce-6d3344a44e49` | `wrench` |

`@Board` stays plain.

### Routing Rule

| Need | Use |
|---|---|
| technical owner / final close | `[@TGCTO](agent://dbef1a38-5618-4dca-af30-9606a619799c?i=crown)` |
| implementation review | `[@TGCodeReviewer](agent://d289b9e0-0ceb-43b3-84a2-3b58ecc7d24f?i=eye)` |
| TypeScript plugin work | `[@TGPluginEngineer](agent://e4f39a1c-ff94-4d41-8baf-6b554b893623?i=code)` |
| local QA / post-deploy smoke | `[@TGQAEngineer](agent://3d979815-496c-46b6-ac8e-cb71b34ba94e?i=bug)` |
| install / reload / production runtime | `[@TGInfraEngineer](agent://6501712f-162b-48aa-a2ce-6d3344a44e49?i=wrench)` |
