# 0023 — A paused round restarts with newcomers; default difficulty is Mixed

- **Date:** 2026-11-23
- **Status:** accepted (orchestrator default under 0021; the owner may override); item 1 refined by 0025
- **Stage:** 3.3.2 (observations O-05, O-06)

## Decision
1. **Paused round with enough newcomers.** Under 0011 a game pauses when
   fewer than 3 seated players are active, and under 0020 late joiners (and
   returning removed players) are seated only at the next round. If, while
   paused, the connected seated players plus the connected waiting players
   reach 3, and no seated player's return has already lifted the pause, the
   paused round is cancelled exactly like a §7 cancel — no points, not counted
   toward the game length, generic "Mission scrubbed" wording — and a new
   round starts with everyone seated and a fresh random faker.
2. **Default difficulty** in the settings panel is **Mixed** (`SPEC.md` §6
   lists the four choices but names no default).

## Why
Taken literally, 0011 + 0020 leave a 3-player game deadlocked in a pause
however many friends arrive (O-06) — the owner asked that a disconnect never
have "permanent ramifications" beyond missing a round (0019). The trigger is
public (who is connected), so cancelling reveals nothing about the faker.
Mixed gives a new group a taste of every difficulty (O-05). Decided by the
orchestrator because the owner asked the run not to stop for questions
(0021); listed in `STATE.md` for the owner to confirm.

## Rejected
- Keep the deadlock until a seated player returns or the host ends.
- Seat newcomers into the paused round: the roster, words and drawings were
  fixed at round start (3.2).

## Revisit if
The owner prefers another rule or default.
