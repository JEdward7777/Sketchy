# Phase 11 — Fairness UI

Screens only: every rule here already lives in the core reducer (phase 3)
and the server loops (phases 6–7), per decision 0006. This phase gives them
a face — removal, greyed scores, the late-joiner wait, the pause screen, the
cancelled-round screen — and proves the connection rules end to end across
several browser contexts (§7).

- `11` todo: Fairness UI
  - `11.1` todo: Host can remove a disconnected player; their score stays visible, greyed out, and they can rejoin to their original seat (§7, 0019)
  - `11.2` todo: Late joiner's waiting screen until the next round starts (0020)
  - `11.3` todo: Pause screen below 3 active players, with the host's End game (§7), per 0.8.2
  - `11.4` todo: Cancelled-round screen after a faker disconnect (§7), wording per 0.8.3
  - `11.5` todo: Connection indicator on player chips and a "reconnecting…" banner for this device
  - `11.6` todo: Host-loss behaviour on screen, per 0.8.1
  - `11.7` todo: Multi-context e2e scenarios
    - `11.7.1` todo: A player reloads mid-draw and returns as the same player with the same score; their briefing envelope still reveals their own word, and a faker's reload follows the blip rule per 0.8.3 (round continues with the envelope revealing the faker role, or is cancelled as in 11.7.2)
    - `11.7.2` todo: The faker's context closes during drawing; the round is cancelled; the next round picks a fresh faker (0020)
    - `11.7.3` todo: The host removes a disconnected player; the game continues with greyed score; the removed player rejoins and is reinstated next round with their score
    - `11.7.4` todo: A late joiner waits, then plays from the next round (0020)
    - `11.7.5` todo: Dropping below 3 pauses; a rejoin resumes

**Verification.** E2E leg: the 11.7 scenarios, each with N browser contexts
against `wrangler dev` and a short Custom preset, closing and reopening
contexts to simulate drops. No new rules: a scenario failure that needs a
rule change goes back to the reducer with a DO-leg test.
