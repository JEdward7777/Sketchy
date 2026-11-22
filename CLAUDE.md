# Sketchy

A spy-themed party drawing game. The locked game design is **`SPEC.md`** — don't
change game rules without asking Joshua.

## Read this first

The working agreement lives in **[`harness/AGENTS.md`](harness/AGENTS.md)**. Read
it before doing anything else. It is the only copy of the rules; this file is a
pointer. (The original design-chat `CLAUDE.md` is preserved at
`harness/reference/claude-md-original.md`.)

Then orient yourself:

1. `harness/STATE.md` — where the project is right now.
2. The newest file in `harness/sessions/` — what the last thread did and left.
3. `node scripts/plan.mjs` — the stage tree with statuses.
4. `harness/observations/open.md` — known problems not yet scoped.

A SessionStart hook prints a summary of these. If you did not see it, read the
files yourself.
