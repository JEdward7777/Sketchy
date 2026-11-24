# The plan

The stage tree, one file per top-level phase. **These files are the source of
truth for what is done and what is next.** Run `node scripts/plan.mjs` for a
rollup rather than reading them all.

## Phases

| # | Phase | File |
|---|---|---|
| 0 | Plan and owner decisions | [`00-plan.md`](00-plan.md) |
| 1 | Scaffold: toolchain, Worker + assets, DO shells, PWA shell, verification legs, budget | [`01-scaffold.md`](01-scaffold.md) |
| 2 | Pure leaves: scoring, guess matching, slide index, clock offset, room codes, faker pick and game length | [`02-pure-leaves.md`](02-pure-leaves.md) |
| 3 | Core reducer: protocol, state with presence, `reduce`, projections, `nextDeadline`, secrecy tests | [`03-core.md`](03-core.md) |
| 4 | Lobby: `RoomDO` adapter, create/QR/join/reconnect, settings, theme tokens, a lobby on a phone | [`04-lobby.md`](04-lobby.md) |
| 5 | Deck: global shuffled `DeckDO` | [`05-deck.md`](05-deck.md) |
| 6 | Server loop A: briefing → draw → slideshow → vote end, stroke intake | [`06-server-loop-a.md`](06-server-loop-a.md) |
| 7 | Server loop B: unmask → guess → judge → score → results → final → Play again | [`07-server-loop-b.md`](07-server-loop-b.md) |
| 8 | Client: briefing envelope and drawing canvas | [`08-client-briefing-drawing.md`](08-client-briefing-drawing.md) |
| 9 | Client: slideshow, dark cards, vote chips, lock, free browse | [`09-client-evidence.md`](09-client-evidence.md) |
| 10 | Client: unmask, guess, judging, results, podium | [`10-client-results.md`](10-client-results.md) |
| 11 | Fairness UI: removal, late joiners, pause, cancel, multi-context e2e | [`11-fairness-ui.md`](11-fairness-ui.md) |
| 12 | Polish: narrator with iOS priming, rules sheet, spy art, big screen | [`12-polish.md`](12-polish.md) |
| 13 | Playtest: real phones, real people (owner's) | [`13-playtest.md`](13-playtest.md) |

Each phase is one ratchet run unit (`../pipeline/ratchet.md`): implemented,
reviewed until a fresh review is quiet, second-model gated only when Fable
is available (decision 0008), committed. Phase 3 runs as two units (see
`03-core.md`). Each phase file ends
with a **Verification** paragraph naming which legs prove it — the unit leg,
the DO leg and the E2E leg, defined in phase 1 and recorded in
`../reference/verification.md`. Stages whose title starts **Owner's:** are
the owner's (deploys, real phones, playtests) and are never simulated.

## Why this order

Recorded in [`../decisions/0006-phase-structure.md`](../decisions/0006-phase-structure.md).
In short:

- **Rules before sockets.** The game is a pure reducer in `src/shared`
  (phases 2–3), so scoring, the faker pick, presence and secrecy are
  unit-tested with fake time and a seeded RNG before any Durable Object
  exists. Presence is in the core because it changes scoring (§5, decision
  0003), the "last connected player locks in" rule, dark cards and the 0004
  hold logic; it cannot be bolted on at the end.
- **A phone-visible lobby early.** Phase 4 ends with a lobby the owner can
  open on a real phone, and it brings the theme tokens and base components
  every later screen reuses.
- **Server first, then screens.** Phases 6–7 run the whole game through
  real sockets with stub stroke lists; phases 8–11 then build screens over a
  protocol that no longer moves.
- **Drawings never ride in `state`.** Every vote change rebroadcasts state, so
  drawings are delivered separately, once per client (decision 0006). They
  are stroke lists drawn by one shared renderer, not images (decision 0009,
  amending §9).

Phase 0's owner questions (`0.8.x`) are encoded by the core reducer, so they
are settled before phase 1 starts.

## Numbering

Dotted decimals, arbitrary depth. One stage per line, children indented two
spaces more than their parent:

```
- `3` todo: Core reducer
  - `3.3` todo: reduce
    - `3.3.2` active: Briefing and draw
```

Statuses: `todo`, `active`, `done`, `blocked`, `dropped`. Indented prose
beneath a stage line is notes, ignored by the parser. A `blocked` stage says
what it is blocked on; a `dropped` stage says why. **Never renumber
siblings**; go deeper.

The tree was renumbered once, during phase 0, when the draft tree (phases
0–10) was replaced by this one; no stage beyond phase 0 had started, so nothing
referred to the old numbers except decision 0003, whose "stage 7.1" is now
`2.2`. The never-renumber rule applies from here on.

Checker rules (`node scripts/plan.mjs --check`): unique ids, every nested stage
has a parent, a `done` parent has no unfinished children, indentation agrees
with depth within a file, and no more than three leaf stages `active`. (That a
`dropped` stage has notes is a convention, not checked — observation O-01.)
