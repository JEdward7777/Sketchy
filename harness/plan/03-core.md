# Phase 3 — Core reducer

The whole game as a pure state machine in `src/shared`, with presence inside
it (decision 0006): protocol types, the state shape, `reduce`, the two
projections and `nextDeadline`. `RoomDO` later becomes a thin adapter that
loads state, calls `reduce`, persists, sends, and arms the alarm. This is
where secrecy (§14, harness/AGENTS.md §5) is proven, for every phase, before
any socket exists. Requires the owner answers to 0.8.x; each child names the
one it encodes.

Runs as two ratchet units: **3a** = 3.1, 3.2, 3.3.1, 3.3.2, 3.4, 3.5 and 3.6
for lobby, briefing and draw; **3b** = 3.3.3–3.3.5, 3.4 and 3.5 extended to
slideshow through final results (unmask projection, auto-continue and pause
deadlines), 3.6 extended to slideshow, browse and the guess, and 3.7. Each unit is
committed separately.

- `3` todo: Core reducer
  - `3.1` todo: Protocol types: client intents (§14 sketch plus `host:hold` and a host narrator-speaking signal (start/stop, with a server-side cap) from 0004 rules 2 and 5, and a versioned `hello`), server messages, `PublicState`, `PrivateView`; update `reference/protocol.md`
  - `3.2` todo: State shape (§14 persisted list) plus presence
      Players (name, color, icon, token, removed flag, seated flag), presence
      (connected flag and a per-phase connection history), settings,
      completed and total rounds (0020), an RNG state (2.1) seeded at room creation that `reduce`
      advances for every random choice (faker pick, slideshow order, Mixed
      bag), the Mixed-difficulty bag (2.8, 0007), the words used this game
      (§6, the exclude list for 5.3), phase and its deadlines, round (word
      with its `alt` list, faker, votes, locks, guess, judgments), drawing
      references — never stroke data (0006,
      0009). The category is public: every player, the faker included, sees
      it (§6), so it is not a secret.
      A round roster: the players seated when the round starts (non-removed,
      not waiting late joiners), fixed for the round. Every round rule —
      private word/faker view, draw done, vote targets and voters, lock-in
      end, judges, judging quorum, `scoreRound` inputs — ranges over the
      roster only; a waiting late joiner gets public state and no `private`
      round view. The slideshow card set (0007 item 7) is the roster minus
      anyone removed before the slideshow starts; the 0003 presence edge
      cases apply to roster members. What a removal later in the round does
      to the roster's votes, judging and tally is settled in 0019 (the round finishes as seated).
  - `3.3` todo: `reduce(state, input, now) → {state, effects}`
      Inputs: intents from a player, alarm ticks, presence events
      (connect/disconnect), adapter results (word dealt, drawing stored).
      Effects: deal a word, store/clear drawings, send. Split into one
      module per phase group, each ≤400 lines.
    - `3.3.1` todo: Lobby: join with unique color, refused when the room already has 10 players, counting removed players and waiting late joiners (§2, 0019), token reconnect, "Rejoin as…" (§2, §7), settings, start at ≥3 players; removed players keep their token and seat and can return (0019)
    - `3.3.2` todo: Briefing and draw: deal-word effect, private views for the roster (3.2), briefing beat with 0004 continue per 0.8.8 (0017), `draw:done` with strokes (0009), all-done early end over the roster per 0.8.3 (0012), faker disconnect cancel (§7, 0003) per 0.8.3 (0012), draw submissions accepted up to a named grace constant after the draw deadline, and on a timeout end the slideshow starts at deadline + grace
    - `3.3.3` todo: Slideshow and free browse: card set and random order (0007), `vote:set`/`vote:lock` rules (§4) with roster voters and targets, last-connected-lock end over the roster, unlocked-selected counts; per 0.8.6 (0015) and 0.8.7 (0016)
    - `3.3.4` todo: Unmask, guess (auto-accept via 2.3), judging by roster non-fakers per 0.8.4 (0013), the word kept from the faker and from public state until the guess is submitted or times out (§4, §14), scoring via `scoreRound` with presence windows (0003, 0007), round results with 0004 auto-continue and `host:hold`, exactly-once continue
    - `3.3.5` todo: Game length and fairness: faker pick and round count (2.7, 0020), remove, late joiners, final results (shared placement, 0007), Play again per 0.8.5 (0014), host claim per 0.8.1 (0010), pause per 0.8.2 (0011)
  - `3.4` todo: `projectPublic(state)` and `projectPrivate(state, playerId)`
  - `3.5` todo: `nextDeadline(state)`: earliest of phase deadline, auto-continue, room expiry (§14), and every grace or pause deadline the 0.8.x answers and 3.3.2's submission grace introduce
  - `3.6` todo: Secrecy tests, for every phase before unmask, and for the word until the faker's guess is submitted or times out
    - `3.6.1` todo: `projectPublic` is identical for two states that differ only in the word (same category), the faker and the RNG state (0020)
        A plain "string not present" check is not enough: player ids are
        public, so the faker's id always appears. Indistinguishability is
        the property that matters. Exempt by design: the faker-disconnect
        cancel transition (§7) and everything from unmask on.
        Except the word: from unmask until the guess is submitted or times
        out, `projectPublic` and the faker's `projectPrivate` are identical
        for two states that differ only in the word (same category).
        Also: while any player is disconnected during briefing or draw, the
        public projection is the same whether or not that player is the
        faker. Any faker-only grace deadline (0.8.3) stays out of
        `projectPublic`; only the cancel itself is exempt. Test by comparing
        a faker disconnect with a non-faker disconnect in otherwise
        identical states.
    - `3.6.2` todo: The word never appears in serialized public state; no player token ever appears in serialized public state (§7 "private player token"); `projectPrivate` gives the word only to roster non-fakers, the faker flag only to the faker, nothing round-specific to a waiting late joiner, and a token only to its own player
  - `3.7` todo: Property tests over seeded random sequences of intents, ticks and presence events
      Invariants: 3.6 holds at every step before unmask, and the word stays
      hidden from the faker until the guess resolves, except across a
      faker-disconnect cancel; nobody votes for themselves; a
      locked vote never changes; scores change only at the scoring step;
      with ticks alone, every game reaches final results or a pause.

**Verification.** Unit leg only: vitest over `src/shared` with fake time
and seeded RNG. 3.6 and 3.7 are the secrecy gate for every later phase; a
change to `reduce` or the projections re-runs them. No Workers runtime yet.
Under harness/AGENTS.md §6 these rules count as verified only once the DO
leg exercises them through real sockets in phases 6–7 (7.9); phases 2–3
commit on the unit leg as their ratchet gate.
