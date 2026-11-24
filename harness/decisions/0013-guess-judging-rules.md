# 0013 — Guess judging: guess timer, whoever judged counts, 0–0 accepts

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.8.4

## Decision
Clarifies `SPEC.md` §4's accept/reject vote on a guess that is not
auto-accepted.

1. **Timer:** the judging deadline is the guess timer setting again, from when
   judging opens.
2. **Quorum:** whoever has judged by the deadline counts; the rest abstain.
   Judges are roster non-fakers (3.2).
3. **Early end:** once every connected roster non-faker has judged (after the
   0012 blip grace).
4. **One tap, final:** a judgment cannot be changed.
5. **Tie, including 0–0:** accepted — ties go to the faker.

## Why
The owner accepted the recommendation (2026-11-23): no new setting, and it
follows the rule the spec already has (ties favor the faker).

## Rejected
- A fixed short judging beat: another magic number.
- All connected non-fakers must judge: one idle phone stalls the round.
- 0–0 rejects: contradicts "tie goes to the faker".

## Revisit if
Playtests show judging drags or groups forget to judge.
