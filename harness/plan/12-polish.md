# Phase 12 — Polish

The narrator (§10), the ⓘ rules sheet (§11), the spy art pass (§12) and the
optional big-screen display (§3). The narrator carries a platform risk:
iOS `speechSynthesis` needs a user gesture before it will speak, voices load
asynchronously, and a standalone PWA may go silent after the phone sleeps.
Decision 0004 starts the auto-continue fill only when the host's narrator is
not speaking, so a narrator stuck "speaking" must never stall the room.

- `12` active: Polish
  - `12.1` active: Narrator (§10)
    - `12.1.1` done: Phrase banks in the spy voice with a no-repeat shuffle, from confess_n_guess `announcer.ts`; phase transitions and final results; lines are chosen and filled from public state only, never from `private`
    - `12.1.2` done: Per-device toggle; on by default for the host, off for everyone else (§3, §10)
    - `12.1.3` done: iOS priming: speak on the first user gesture (create or join tap), wait for `voiceschanged`, re-prime when the page becomes visible again
    - `12.1.4` done: "Speaking" sent to the server via the 3.1 narrator signal, with a client timeout so a stalled utterance counts as not speaking (the server-side cap backs it up)
    - `12.1.5` todo: Owner's: real-phone TTS check — iOS Safari, iOS installed PWA after sleep, Android Chrome
  - `12.2` done: ⓘ rules sheet on every screen including the lobby, with the scoring table; opening it never pauses the game (§11)
    On short landscape round screens (draw, evidence, guess, judging) the header with ⓘ is hidden; carried into `12.3` as O-20.
  - `12.3` todo: Spy art pass: envelope that slides open while held, stamps, dossiers, fingerprints, icons; bold and playful, not moody, not baby-ish (§12)
  - `12.4` todo: Optional big-screen display view: public state only, drawings (shared renderer, 2.11), votes and scoreboard large (§3), over the 7.11 display socket
  - `12.5` todo: Owner's: PWA install check on iOS and Android, and a full real-phone pass of every screen

**Verification.** Unit leg for the phrase picker and the speaking-timeout
logic; E2E leg checks the ⓘ sheet opens on every screen without changing
game state, and the display view receives public `state` and the round's
drawings (6.5, 7.11), never `private`. TTS and install cannot be verified
headless: 12.1.5 and 12.5 are the owner's and are never simulated. Unit
test: for the same public state, the phrase picker returns the same line
whether the device's `private` is a faker or a non-faker view.
