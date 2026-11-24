# 0019 — A removed player can come back and resume their original seat

- **Date:** 2026-11-23
- **Status:** accepted; item 2 superseded by 0020
- **Stage:** 0.8.10

## Decision
Supersedes decision 0007 item 5 and amends `SPEC.md` §7 ("Leaving for good").
Removal means "stop waiting for this player", not a permanent kick.

1. **Return.** A removed player's token stays valid and they stay in
   "Rejoin as…" (§2, §7). Reconnecting restores the same player — same id,
   name, color, icon and score. While removed, their scoreboard row is greyed
   out and keeps its color reserved.
2. **When they are seated again.** A returning player is reinstated from the
   next round (they are not added to a round already under way). Their faker
   turn in the current cycle, if not yet played and the cycle still has rounds
   left, is put back later in that cycle; otherwise it is skipped for that
   cycle. Later cycles include them normally.
3. **Room size.** A removed player keeps their seat, so they still count
   toward the 10-player cap (§2).
4. **Removal mid-round.** The round finishes as seated: their vote and votes
   cast for them still count, and they remain in that round's judging and
   tally under 0003's presence rules; the removal takes effect from the next
   round. A removed faker is treated as a disconnected faker under 0012.
5. **Removed before the slideshow.** They have no card (0007 item 7), so they
   are not a valid vote target (refines 0015).
6. What a player loses by being away is only what they missed — votes, rounds,
   a skipped faker turn — never their identity or score.

## Why
The owner's ruling (2026-11-23): "I would like someone to be able to join again
and resume their original position. I don't want an accidental disconnect to
have permanent ramifications except for like missing votes or getting skipped
or whatever." Items 4 and 5 are the recommendations the owner did not object
to.

## Rejected
- 0007 item 5: removal invalidates the token; the device must join fresh with
  zero score.
- Freeing the removed player's color.

## Revisit if
Hosts want a true kick (for someone who should not come back).
