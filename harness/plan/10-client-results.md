# Phase 10 — Client: unmask, guess, judging, results, podium

The rest of the round on screen: the unmask beat, the faker's guess input,
the group judging buttons, round results with the running scoreboard and the
0004 auto-continue button, and the final podium with Play again (§4, §5).
The narrator lands in phase 12; until then no client sends the 3.1
narrator-speaking signal, so the server treats the host's narrator as not
speaking and the 0004 fill starts on idle alone.

- `10` active: Client: unmask, guess, judging, results, podium
  - `10.1` todo: Unmask: who voted for whom, then the faker revealed (§4)
  - `10.2` todo: Faker's guess input with countdown; everyone else sees a waiting state (§4)
  - `10.3` todo: Judging: accept/reject for roster non-fakers only (3.2); the result shown with the tie rule (§4), per 0.8.4
  - `10.4` todo: Round results: points this round and running scoreboard (§4, §5)
  - `10.5` todo: Auto-continue button on the host's screen for round results, reusing the 8.9 component adapted from confess_n_guess `AutoContinueButton` (0004)
    - `10.5.1` todo: Fill shown from the server deadline; any other tap on the host's screen sends a throttled `host:hold`
  - `10.6` todo: Final results podium with shared placement (0007) and Play again (§4), per 0.8.5 (0014)
  - `10.7` todo: "Save my drawing": from the results screens any player renders a drawing to a PNG on their device with the shared renderer, then downloads or shares it (0009)

**Verification.** E2E leg with N contexts and a short Custom preset: play a
full game to the podium; an exact guess auto-accepts; a near guess goes to
judging where only non-faker contexts get buttons; host taps hold the fill
and it re-arms; Play again returns everyone with scores reset; no non-faker
context's DOM shows the word until the guess resolves, judging included (0026 item 5).
Component logic (fill progress from deadline) on the unit leg.
