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
