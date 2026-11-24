# 0010 — While the host is disconnected, any connected player may claim host

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.8.1

## Decision
Amends `SPEC.md` §3 ("the host is the player who created the room").

1. The host role never moves on its own.
2. While the host is disconnected — past the same short reconnect grace that
   presence uses elsewhere, so a reload does not flash the option — every
   connected, non-removed player sees a "Take over as host" control. The first
   claim the server accepts wins; later claims are refused.
3. A claimed role stays with the new host. If the old host reconnects they are
   an ordinary player; they can only claim it back if the new host in turn
   disconnects.
4. Until someone claims, decision 0004 keeps auto-continue running; host-only
   actions (start, remove, settings, end game, Play again) wait.
5. Host identity is public state; the claim is a reducer intent (`host:claim`),
   tested in 3.3.5.

## Why
The owner's ruling (2026-11-23): anyone may claim host while the host is
disconnected, "because it's still a human decision and there's not an
automatic transfer that happens just because the person turned off the screen
for a little bit too long."

## Rejected
- No migration: a host whose phone dies strands the room.
- Automatic transfer after a grace period: moves the role without anyone
  choosing to, e.g. when the host's screen merely sleeps.

## Revisit if
Playtests show players grabbing host during short blips, or nobody noticing
the claim control.
