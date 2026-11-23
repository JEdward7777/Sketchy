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
