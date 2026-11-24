# 0024 — "Rejoin as…" during a round needs the host's OK, and moves the token

- **Date:** 2026-11-23
- **Status:** accepted (orchestrator default under 0021; the owner may override)
- **Stage:** 3.3.1 (phase 3a secrecy review)

## Decision
Amends `SPEC.md` §7 ("Rejoin as…") and decision 0019 item 1.

1. **Between rounds** (lobby, round results, scrubbed, final results) "Rejoin
   as…" works as before: any new device may take a disconnected player's seat.
2. **While a round is under way** (dealing through the guess and judging) a
   "Rejoin as…" request only *asks*: public state shows "a device wants to
   rejoin as <name>", and the host approves or declines (`host:admit
   {playerId, approve}`). Until approved, the requesting socket gets no
   private view. If the host is the player being rejoined, or no host is
   connected, the request waits for the next between-rounds moment (or for a
   claimed host, 0010).
3. **Every successful "Rejoin as…" rotates that player's token** (the adapter
   mints a new one, as for a fresh join). The old device's token stops
   working; if it comes back it must ask to rejoin like any other device.
   Token reconnect from the same device (`rejoin` with the current token) is
   unchanged and needs no approval.
4. Pending requests are public facts (who is being rejoined, not by whom);
   they never depend on the round's word or faker.

## Why
The phase-3a secrecy review showed that an unauthenticated "Rejoin as…"
hands any device the disconnected player's private view and token: anyone
could learn the faker's identity (a faker who drops after drawing stays in
the round, 0012), the faker could read the word through a dropped agent's
seat, and the copied token allowed snooping for the rest of the game. That
breaks the secrecy rule in `harness/AGENTS.md` §5. A host's OK keeps the
common case (a dead phone, a borrowed one) to one tap by a person in the
room, and rotating the token ends any lasting takeover.

## Rejected
- No private view for "Rejoin as…" until the next round: a genuine faker or
  agent who changes phones mid-round loses their guess or drawing.
- Leave it open (spec as written): leaks the faker before unmask.

## Revisit if
The owner prefers a different trade-off, or playtests find the host prompt
annoying.
