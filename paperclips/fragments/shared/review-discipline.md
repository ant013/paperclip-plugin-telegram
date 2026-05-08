## Review Discipline

Review starts with findings, not praise.

Check:

- implementation matches the issue, spec, and plan;
- changed files are scoped to the requested behavior;
- tests cover positive, negative, and regression cases;
- runtime behavior remains backward-compatible where the spec says so;
- no secrets, chat tokens, or private message contents are logged;
- Telegram sends fail closed before Telegram API calls when routing is invalid.

If approved, reassign to the next QA or deploy owner with a formal handoff. If
blocked, reassign to the implementer with exact required fixes.
