# 0025 — A 0023 restart waits a beat and counts only open sockets; the faker pool is every connected roster player; graces are not frozen

- **Date:** 2026-11-24
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 3.3.5 (unit 3a review round 2)

## Decision
1. **Restart trigger (refines 0023 item 1).** A paused round restarts with
   newcomers only when both hold:
   - seated plus waiting players **with an open socket** reach 3 (a player
     inside the blip grace but with no socket does not count); and
   - the pause has lasted at least `RESTART_WAIT_MS` = 30 s.
   A seated player's return within that time resumes the round as before
   (0011), so their drawing is not thrown away.
2. **Faker pool (refines 0020).** The faker is picked uniformly from every
   roster player who is `connected` (public presence, inside the grace
   included), as 0020 says literally — not only those with an open socket.
   A pick who never comes back is cancelled by the normal §7 rule.
3. **Blip graces run on wall time during a pause (amends 0011 item 3).**
   0011 listed the grace among the frozen deadlines; it is not frozen, so a
   host whose phone dies during a pause becomes claimable (0010) and a
   dropped player becomes "Rejoin as…"-able (0024) after the usual grace.

## Why
1. Review found that counting a host whose phone had just slept could scrub
   a nearly finished round and then pause again at once, and that a waiting
   newcomer turned any single drop into an instant scrub — against 0011's
   "no drawing is lost". The wait is public (pause start + constant), so it
   reveals nothing about the faker.
2. Excluding visibly reloading players tells the table who is not the faker.
   The occasional cancel is the lesser cost.
3. A frozen grace let a dead host block host claim and rejoin for the whole
   pause (unit 3a review round 1).

## Rejected
- Restart with no wait (0023 as first written).
- Pick only from open sockets (leaks through what the table sees).

## Revisit if
Playtests show 30 s feels too long or too short, or the owner prefers
another rule.
