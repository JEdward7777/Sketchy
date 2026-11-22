# harness/

Development state for Sketchy, kept in files so that any thread — of any
assistant — can pick up where the last one stopped. This folder is the memory.

**Start with [`AGENTS.md`](AGENTS.md).** It is the working agreement.

| Path | What it holds | Lifecycle |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | The rules every assistant follows | Edited rarely, deliberately |
| [`STATE.md`](STATE.md) | Where the project is right now | Rewritten every session |
| [`plan/`](plan/) | The stage tree — source of truth for what is done | Statuses updated constantly |
| [`decisions/`](decisions/) | Numbered decision records | Append-only, never edited |
| [`observations/`](observations/) | Real problems, not yet scoped into a stage | Churns |
| [`sessions/`](sessions/) | One file per session: done, learned, left | Immutable once written |
| [`reference/`](reference/) | Durable technical facts | Grows slowly |
| [`pipeline/`](pipeline/) | How multi-phase work is executed (the ratchet) | Edited when the process learns something |

The game design itself is `../SPEC.md` (locked). The word list is
`../data/words.json`.

## Why it is split this way

The kinds of information have different lifecycles, and mixing them means the
permanent things get edited by accident. Decisions are append-only. State is
rewritten constantly. Session files are immutable once written. Observations
churn. Layout adopted from the Satellite-Chess harness — see
[`decisions/0001-harness-layout.md`](decisions/0001-harness-layout.md).

## Tools

```bash
node scripts/plan.mjs          # stage tree with statuses (npm run plan later)
node scripts/plan.mjs --check  # validate numbering, parentage, statuses
node scripts/plan.mjs --next   # the next todo stage
```
