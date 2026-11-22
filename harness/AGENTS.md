# Working agreement for Sketchy

This file is the contract every coding assistant on this project follows —
Claude Code, Codex, Cursor, or a human standing in for one. Root `CLAUDE.md` and
root `AGENTS.md` are thin pointers here so there is exactly one copy of the rules.

Read this once at the start of a session. It is short on purpose.

---

## 1. What this project is

A spy-themed party drawing game for 3–10 players in the same room, each on their
own phone. Everyone draws the secret word except the **faker**, who sees only the
category and bluffs. Everyone browses the drawings, votes publicly on who the
faker is, and the faker tries to guess the word. Concept by Joshua's daughter.

Stack: installable PWA (React + Vite) on Cloudflare Workers with static assets,
plus SQLite-backed Durable Objects (`RoomDO` per room, singleton `DeckDO`). Free
tier throughout, hosted on `*.workers.dev`.

**`SPEC.md` (repo root) is the locked game design.** Do not change game rules
without asking Joshua. Where a later decision in `harness/decisions/` amends the
spec, the decision wins, and it says so.

**Data:** `data/words.json` holds 400 words (200 concrete, 120 medium, 80
abstract), each with a category and some with `alt` accepted answers; words are
unique across the whole file. Expand it freely, keeping it family-friendly.

## 2. Orient yourself before doing anything

In this order:

1. **`harness/STATE.md`** — where the project is right now, and the next action.
2. **The newest file in `harness/sessions/`** — what the previous thread did and
   what it left. Pick up there.
3. **`harness/plan/`** — the stage tree. Run `node scripts/plan.mjs` (or
   `npm run plan` once `package.json` exists) for a rollup.
4. **`harness/observations/open.md`** — known problems not yet scoped. Check it
   before "discovering" something already logged.

A SessionStart hook (`.claude/settings.json` → `scripts/session-start.mjs`)
prints a summary of 1, 2 and 4. If you did not see it, read the files yourself —
do not assume the project is empty.

## 3. Stage numbering

Stages are dotted decimals of arbitrary depth: `3`, `3.2`, `3.2.4`. One line per
stage in the plan files:

```
- `3.2.4` active: Persist the vote tally across hibernation
```

Status is one of `todo`, `active`, `done`, `blocked`, `dropped`. Indented prose
under a stage line is notes for humans and is ignored by the parser.

- Adding detail means adding children, never renumbering siblings.
- A parent is `done` only when every child is `done` or `dropped`.
- Keep at most two or three stages `active` at once.
- `node scripts/plan.mjs --check` validates numbering, parentage and statuses.
  Run it after editing any plan file.

## 4. Where things go

| You have | Put it in |
|---|---|
| A choice with a lasting consequence | `harness/decisions/NNNN-slug.md` (new file, append-only) |
| A real problem, out of scope right now | `harness/observations/open.md` |
| Work understood well enough to scope | a stage in `harness/plan/` |
| A record of what you did this session | `harness/sessions/YYYY-MM-DD-NN.md` |
| Durable technical facts (protocol, budget, gotchas) | `harness/reference/` |
| Current position and next step | `harness/STATE.md` (rewrite, keep it short) |
| How multi-phase work is executed | `harness/pipeline/ratchet.md` |

Anything that grows without bound is a folder, not a file. Never edit a decision
after writing it; supersede it with a new one and add a `Superseded by` line.

## 5. Must-not-break rules

These come from `SPEC.md` §13–14 and the free-tier budget. Breaking them breaks
the game, not just the design.

- **Secrecy.** The secret word reaches only non-fakers, and the faker's identity
  only the faker, until unmask. Never in the shared/public state, never in logs,
  never anywhere a client could find it in dev tools. Private data goes out on a
  per-socket `private` message only. Tests must assert this.
- **The server is authoritative** for phases, timers, votes and scoring. Clients
  send intents; the room broadcasts state.
- **WebSocket Hibernation is mandatory.** `ctx.acceptWebSocket()`, never
  `server.accept()`. Consequence: **no timing state in memory** and no
  `setTimeout` on the server. Everything must be reconstructible from storage on
  wake. Deadlines are absolute epoch ms in storage.
- **A Durable Object has exactly one alarm.** Phase deadlines and the room
  inactivity expiry are multiplexed: the alarm is always set to the earliest due
  deadline. Feature code does not call `setAlarm` directly.
- **SQLite DOs only.** Migrations use `new_sqlite_classes`; `new_classes` fails
  to deploy on the free plan.
- **No per-slide messages.** The slideshow index is derived on the client from
  `slideshowStart + n × perSlide` with a measured clock offset.
- **Small images.** Drawings are exported ~600 px wide, WebP (PNG fallback), and
  stored only for the current round.
- **Scoring is pure functions** in `src/shared/` with unit tests covering every
  edge case in `SPEC.md` §5 and any decision that amends it.

## 6. Verification

Before you claim anything works:

```bash
npm run typecheck   # tsc per runtime (shared, worker, client)
npm test            # vitest: pure logic + DO integration via vitest-pool-workers
npm run plan:check  # plan tree integrity
```

UI and flow changes are not verified until exercised against `wrangler dev` with
several browser contexts (one per simulated player). A rules change is not
verified until a DO integration test exercises it — typechecking is not enough.

**Deploys and real-phone playtests are the owner's.** Do not deploy unless the
owner has authorized it for the current run, and never simulate a real-phone
check and mark it done.

Report failures with the actual output. Never describe a step as done when it is
partial.

## 7. Session discipline

At the end of every session, without being asked:

1. Write `harness/sessions/YYYY-MM-DD-NN.md` from the template in
   `harness/sessions/README.md`. Be honest about dead ends.
2. Rewrite `harness/STATE.md` to match reality.
3. Update stage statuses in `harness/plan/` and run the plan check.
4. Log anything spotted-but-unscoped in `harness/observations/open.md`.
5. Commit, staging **by explicit path** (see `pipeline/ratchet.md` hard rules).
   Never `git add -A`, `reset --hard`, `clean`, `stash` or `checkout -- .`.

Then, if the active stage is finished, the tree is clean and everything is
committed, tell the operator it is a good moment to start a fresh thread.

## 8. Style

- TypeScript everywhere; one tsconfig per runtime (shared / worker / client).
- Match the surrounding code. Comments explain *why*, especially where a
  platform constraint or game rule forced an unobvious shape.
- **Cite symbols, not line numbers**, in harness prose (`scoreRound`, not
  `scoring.ts:42`). Line anchors rot on every insertion.
- **Every comment or doc claim you write must be demonstrable**; if a claim
  cannot be cheaply checked, write it weaker or leave it out. Numbers especially:
  write the expression (`players × 2 × perSlide`) rather than a bare value.
- Player-facing text: American English, witty spy voice, family-friendly —
  playful but not baby-ish (`SPEC.md` §12).
- File writes ≤ ~400 lines; split modules before they grow past that.
