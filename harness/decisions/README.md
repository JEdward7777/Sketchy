# Decisions

One file per decision, numbered sequentially with no gaps, named
`NNNN-short-slug.md`. **Append-only: never edit a decision after writing it.** To
change course, write a new decision and add a `Superseded by NNNN` line to the
old one's Status.

Write one when a choice would be expensive to reverse, or when a future session
would otherwise waste time re-deriving it or quietly undo it. Not for routine
implementation detail — that belongs in code comments.

```markdown
# NNNN — Title in the imperative

- **Date:** YYYY-MM-DD
- **Status:** accepted | superseded by NNNN
- **Stage:** the plan stage this came out of

## Decision
## Why
## Rejected
## Revisit if
```

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-harness-layout.md) | Harness layout and dotted stage numbering, from Satellite-Chess | accepted |
| [0002](0002-react-vite-client.md) | The client is React + Vite | accepted |
| [0003](0003-scoring-edge-cases-confirmed.md) | Keep the SPEC §5 scoring edge cases as written | accepted |
| [0004](0004-auto-continue-held-by-host-taps.md) | Host "continue" points auto-advance unless the host is actively tapping | accepted |
| [0005](0005-public-repo-mit-main.md) | Public GitHub repo, MIT license, work on `main` | accepted |
| [0006](0006-phase-structure.md) | Build a pure core first, then the server loop, then the screens | accepted |
| [0007](0007-technical-spec-defaults.md) | Technical defaults for gaps in the spec | accepted |
| [0008](0008-no-second-model-gate-without-fable.md) | Skip the ratchet's second-model gate unless Fable is available | accepted |
| [0009](0009-drawings-as-strokes.md) | Drawings travel as strokes, not images (amends SPEC §9) | accepted |
| [0010](0010-any-player-may-claim-host.md) | While the host is disconnected, any connected player may claim host (amends SPEC §3) | accepted |
| [0011](0011-pause-below-three-freezes.md) | Below 3 active players the game freezes and resumes | accepted |
| [0012](0012-faker-disconnect-and-blips.md) | Faker disconnects after drawing, reload blips and presence rules | accepted |
| [0013](0013-guess-judging-rules.md) | Guess judging: guess timer, whoever judged counts, 0–0 accepts | accepted |
| [0014](0014-late-joiners-and-play-again.md) | Final-cycle late joiners wait; Play again returns to the lobby | accepted |
| [0015](0015-vote-targets-and-faker-no-vote.md) | Any roster player but yourself is a vote target; a faker no-vote earns nothing | accepted |
| [0016](0016-all-locked-ends-voting-immediately.md) | When everyone has locked in, voting ends immediately, even mid-slideshow | accepted |
| [0017](0017-envelope-press-is-not-a-hold.md) | Pressing the briefing envelope is not a host hold | accepted |
| [0018](0018-default-two-cycles.md) | The cycles setting defaults to 2 | accepted |
| [0019](0019-removed-players-can-return.md) | A removed player can come back and resume their original seat (supersedes 0007 item 5) | accepted |
| [0020](0020-random-faker-each-round.md) | The faker is picked at random every round (amends SPEC §7) | accepted |
| [0021](0021-ratchet-runs-until-blocked.md) | The ratchet runs until it is blocked on the owner; email before stopping | accepted |
| [0022](0022-custom-timer-bounds.md) | Bound the Custom timers; the draw maximum is twice Relaxed | accepted |
| [0023](0023-paused-round-restarts-with-newcomers.md) | A paused round restarts with newcomers; default difficulty is Mixed | accepted |
| [0024](0024-rejoin-as-needs-host-ok-mid-round.md) | "Rejoin as…" during a round needs the host's OK, and moves the token | accepted |
| [0025](0025-restart-waits-and-needs-open-sockets.md) | A 0023 restart waits 30 s and counts only open sockets; the faker pool is every connected roster player; graces run during a pause | accepted |
| [0026](0026-round-end-defaults.md) | Round-end and game-end defaults from unit 3b (randomness, Play again, host:end, beats) | accepted |
| [0027](0027-no-pause-after-unmask.md) | No pause from unmask on or on final results; round numbers never reset | accepted |
