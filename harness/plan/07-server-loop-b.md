# Phase 7 — Server loop B: unmask to Play again

The second half of the round and the whole game on the server: unmask, the
faker's guess and group judging, scoring, round results with auto-continue,
the next round with a fresh faker pick, final results and Play again, plus the
server side of removal, ending and pausing. After this phase the protocol is
stable and the client phases build on it. Ends with a budget re-check
against a full game.

- `7` done: Server loop B — unmask to Play again
  - `7.1` done: Unmask beat: votes and faker revealed in public state (§4); the word stays out of public state, and out of the faker's `private`, until the faker's guess is resolved — auto-accepted, judged, or timed out — judging included (§4, §14, decision 0026 item 5; the core's rule, proven through sockets by `assertGameSecrecy`)
  - `7.2` done: Faker's guess: `guess:submit`, guess timer (§8), auto-accept via 2.3, no guess = wrong (§4); the word enters public state (`round.result.word`) only once the guess resolves: on an auto-accept, at the end of judging, or when the guess timer ends with no guess (0026 item 5). The submitted guess text is public at once
  - `7.3` done: Judging: `guess:judge` from roster non-fakers only (3.2), tie → faker (§4), timer and quorum per 0.8.4 (0013); judging starts after the guess is submitted, the word is still hidden from public state and the faker during it (0026 item 5), and non-faker judges have held it in their own `private` since briefing
  - `7.4` done: Scoring step applies `scoreRound` with presence windows (§5, 0003, 0007)
  - `7.5` done: Round results with 0004 auto-continue, `host:hold` and exactly-once continue
  - `7.6` done: Next round: fresh faker pick; late joiners and returning players are seated; the game ends after `totalRounds` (2.7, 0020)
  - `7.7` done: Final results with shared placement (0007); Play again keeps room and players, resets scores (§4), per 0.8.5 (0014)
  - `7.8` done: Server side of fairness: `host:remove` (disconnected players only, §7), `host:end`, return of a removed player (0019), pause below 3 and resume per 0.8.2 (0011), host claim per 0.8.1 (0010)
  - `7.9` done: Full-game DO tests: 3-player and 10-player games to final results with stub stroke lists, covering every §5 edge case through real sockets
  - `7.10` done: Budget re-check: update `reference/budget.md` with measured message counts and sizes and storage per game, as expressions in players and rounds; re-measure stroke payloads with the real codec (2.10) against 1.7.1
  - `7.11` done: Display sockets: `hello` as a display, which receives public state and drawings only, never `private`, and is not a player for presence, the 10-player cap, or done/lock counts (§3)

**Verification.** DO leg with N sockets and `runDurableObjectAlarm`: full
games to final results; the secrecy recording from phase 6 extended to the
unmask boundary (nothing secret before it) and through the guess (the
faker's socket receives no frame containing the word before its guess is
resolved, judging included, decision 0026 item 5); judging tie and zero-judge cases; a duplicate
continue is ignored; removal, pause and resume; Play again resets scores; a
display socket receives no `private` and does not change player counts.
Budget figures in 7.10 are measured from these runs.
