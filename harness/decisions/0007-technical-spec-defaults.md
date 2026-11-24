# 0007 — Technical defaults for gaps in the spec

- **Date:** 2026-11-22
- **Status:** accepted; item 5 superseded by 0019
- **Stage:** 0.7

## Decision
1. **Room-code collision:** `POST /api/room` picks a random code and asks
   that `RoomDO` to initialise; an occupied room refuses and the Worker
   retries with a new code a bounded number of times. Expired rooms have
   cleared storage (§14), so their codes are free again.
2. **Slideshow order:** a fresh random order per round, drawn when the
   slideshow starts and used for both passes and free browse.
3. **Mixed difficulty:** a shuffled bag of the three difficulties; each
   round takes the next, and the bag refills and reshuffles when empty.
4. **Final ties:** shared placement (1, 1, 3); tied players share a podium step.
5. **Removed player's token:** no longer valid for that player, who is also
   never offered in "Rejoin as…". The device may join fresh as a new late
   joiner (§7) with a new id and zero score.
6. **Voting window for §5 edge case 2** (decision 0003) = slideshow + free
   browse. "Disconnected for the whole voting phase" means not connected at
   any moment in that window; connected at any instant means included.
7. **Slideshow length:** `n` in `n × 2 × perSlide` counts every card,
   including "went dark" cards. The card set is the round's players not
   removed by the time the slideshow starts, and is fixed from then on.
8. **Protocol version mismatch:** `hello` carries the client's protocol
   version; on mismatch the room sends `error {code: "version"}` and closes
   the socket, and the client shows a "new version — reload" prompt that
   updates the service worker and reloads. The player token is kept, so the
   reload reconnects as the same player.

## Why
1. `idFromName(code)` makes the DO the only authority on whether a code is
   live; a Worker-side check would race.
2. A fixed order puts each player in the same slot every round, so position
   becomes a habit or a tell; §14's derived index works for any stored order.
3. Uniform random can serve several abstract rounds in a row; the bag keeps
   the mix even and still unpredictable.
4. Standard competition ranking; nobody is placed below someone they tied.
5. A removal is the host's decision (§7); letting the old token resurrect the
   player would undo it, while joining fresh keeps cycles fair.
6. Voting is open throughout both stages (§4); "any moment" is the most
   literal reading of "the whole phase" and is cheap to store as history.
7. Every card is shown for `perSlide`, so the timing must count them all
   (§8); fixing the set keeps every phone's derived index in step.
8. A mid-game deploy must fail loudly and recover, not desync silently.

## Rejected
- Rotation for Mixed (concrete → medium → abstract): predictable.
- Dense ranking for ties (1, 1, 2): reads as if a third place was skipped.
- A grace period before "disconnected for the whole window": that question
  for briefing/draw is the owner's (0.8.3); here "any moment" needs none.

## Revisit if
Playtests show a pattern in Mixed rounds feels off, or a version bump
mid-evening strands players who cannot reload.
