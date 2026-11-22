# 0004 — Host "continue" points auto-advance unless the host is actively tapping

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.4
- **Amends:** `SPEC.md` §4 — resolves phase 7 "host taps Next round (or auto…; pick
  one)" and applies the same control to briefing's "host taps continue".

## Decision
Adapt confess_n_guess's `AutoContinueButton` to phones, with the server as the
clock:

1. The host's screen shows a Continue button that fills like a progress bar and
   auto-continues when the fill completes (~8 s on round results; shorter where
   the spec already has a short fixed beat).
2. The fill starts only once the host has been idle and the host's narrator is
   not speaking.
3. **Any tap on the host's screen other than the button** is a "hold": the fill
   snaps back, and it re-arms after **60 s** with no taps.
4. Tapping the button continues immediately.
5. **The auto-advance deadline lives in RoomDO**, not in the host's browser. A
   hold is a `host:hold` intent that pushes the stored deadline out. If the host
   is disconnected, the deadline runs normally, so a pocketed phone never
   stalls the room.
6. Exactly-once: the server ignores a duplicate continue for a phase it has
   already left.

## Why
The owner asked for the confess_n_guess behavior, with "a tap anywhere else on
the screen" standing in for mouse movement (2026-11-22). The re-arm after 60 s
(rather than staying cancelled) was confirmed: a host who taps once and wanders
off must not strand the room. Server-held deadline follows the "server is
authoritative for timers" rule and the hibernation rule (no client- or
memory-held timing).

## Rejected
- Host-tap only: stalls when the host's phone sleeps.
- Plain auto-advance: cuts off the out-loud discussion, which is the fun part.
- Client-side timer on the host (as in confess_n_guess): the host's phone
  locking would freeze the game.

## Revisit if
Hold taps cost meaningful requests (they should be throttled client-side to at
most one per few seconds), or playtests show the 60 s hold is wrong.
