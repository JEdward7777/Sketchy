# The plan

The stage tree, one file per top-level phase. **These files are the source of
truth for what is done and what is next.** Run `node scripts/plan.mjs` for a
rollup rather than reading them all.

## Phases

| # | Phase | File |
|---|---|---|
| 0 | Decisions with the owner before code | [`00-decisions.md`](00-decisions.md) |
| 1 | Scaffold: toolchain, Worker + assets, DO shells, PWA shell | [`01-scaffold.md`](01-scaffold.md) |
| 2 | Lobby: rooms, QR join, identity, reconnect | [`02-lobby.md`](02-lobby.md) |
| 3 | Deck: global shuffled `DeckDO` | [`03-deck.md`](03-deck.md) |
| 4 | Round engine: state machine, alarms, briefing | [`04-round.md`](04-round.md) |
| 5 | Drawing: canvas and image submit | [`05-drawing.md`](05-drawing.md) |
| 6 | Evidence: synced slideshow, live voting, free browse | [`06-evidence.md`](06-evidence.md) |
| 7 | Unmask: faker guess, judging, scoring, results | [`07-unmask.md`](07-unmask.md) |
| 8 | Fairness: cycles, disconnects, removal, late joiners | [`08-fairness.md`](08-fairness.md) |
| 9 | Polish: narrator, rules sheet, spy theme, big screen | [`09-polish.md`](09-polish.md) |
| 10 | Playtest: real phones, real people | [`10-playtest.md`](10-playtest.md) |

Phases 1–8 follow the implementation order in the original `CLAUDE.md`
(preserved in `reference/claude-md-original.md`). Each phase is one ratchet run
unit: implemented, reviewed until quiet, second-model gated, committed.

The pure modules (scoring, guess normalization, clock, slideshow index) are
written test-first inside the phase that first needs them, not saved for the
end — scoring in particular lands in 7 but its tests are specified by `SPEC.md` §5
from day one.

## Numbering

Dotted decimals, arbitrary depth. One stage per line:

```
- `3.2.4` active: Persist the vote tally across hibernation
```

Statuses: `todo`, `active`, `done`, `blocked`, `dropped`. Indented prose beneath
a stage line is notes, ignored by the parser. A `blocked` stage says what it is
blocked on; a `dropped` stage says why. **Never renumber siblings**; go deeper.

Checker rules (`node scripts/plan.mjs --check`): unique ids, every nested stage
has a parent, a `done` parent has no unfinished children, a `dropped` stage has
notes.
