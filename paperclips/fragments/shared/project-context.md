## Project Context — Telegram Plugin Fork

Repository: `ant013/paperclip-plugin-telegram`

Runtime: Paperclip plugin for bidirectional Telegram integration. Primary code is
TypeScript under `src/`, tests under `tests/`, operator docs under `docs/`.

Current production context:

- Paperclip company: `TelegramUpdate`
- Company issue prefix: `TEL`
- Plugin repo checkout: `/Users/Shared/Ios/worktrees/cx/paperclip-plugin-telegram`
- Paperclip API URL is supplied by `PAPERCLIP_API_URL`
- Agent bundles are uploaded through Paperclip managed `AGENTS.md` instruction bundles

Do not import Gimle-specific assumptions into this project:

- No Neo4j, MCP graph extraction, Gradle/Swift/Bazel extractor, Gimle Palace routing,
  or `GIM-*` project workflow unless the operator explicitly asks.
- Use `TEL-*` identifiers for this company.
- Merge/deploy target is this plugin fork's established branch flow, not Gimle's
  `develop`-only flow.

Default verification commands:

```bash
npm test
npm run build
```

For production smoke, use real Paperclip plugin runtime and real Telegram delivery
only when the issue explicitly requests it and credentials/config are present.
