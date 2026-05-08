## Git Workflow

Use the repository's current issue branch unless Paperclip assigned a separate
worktree. Do not switch away from an active issue worktree without operator or
CTO instruction.

Before relying on branch state:

```bash
git fetch origin --prune
git status --short
git branch --show-current
```

Rules:

- keep changes scoped to the issue;
- do not revert unowned changes or untracked operator artifacts;
- push commits before handoff to review;
- include branch and commit SHA in handoff comments;
- do not merge unless your role and the issue phase explicitly authorize it.

If multiple agents are active on the same branch, inspect `git status` and recent
commits before editing. Work with existing changes; do not reset them.
