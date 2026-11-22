# 0001 — Keep project memory in a split harness with dotted stages

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.1

## Decision
Adopt the Satellite-Chess harness layout: `AGENTS.md` (single copy of the rules,
with root `CLAUDE.md`/`AGENTS.md` as pointers), `STATE.md`, `plan/` with dotted
stage numbering checked by `scripts/plan.mjs`, append-only `decisions/`,
immutable `sessions/`, churning `observations/`, durable `reference/`, and the
ratchet process in `pipeline/`. A SessionStart hook prints the orientation.

`SPEC.md` stays at the repo root as the locked design; the original `CLAUDE.md`
is preserved verbatim in `reference/claude-md-original.md` and its rules moved
into `AGENTS.md`.

## Why
The owner asked for a harness "structured according to current best practices".
Satellite-Chess is the most mature of the owner's harnesses and was refined in
the field (its decision 0010); confess_n_guess and Storython2 use flatter
TASKS/PROGRESS files that grow without bound.

## Rejected
- Flat `TASKS.md` + `PROGRESS.md` (confess_n_guess, Storython2): single files
  that grow forever and mix lifecycles.
- Moving `SPEC.md` into `harness/`: the spec is the product definition, linked
  from the README, and owned by Joshua; it is not agent memory.

## Revisit if
The project stays small enough that the structure is ceremony.
