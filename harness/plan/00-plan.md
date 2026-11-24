# Phase 0 — Plan and owner decisions

Everything settled before the ratchet starts at phase 1: the harness, the
stack, the phase plan itself, the technical defaults for gaps in `SPEC.md`
(decision 0007), and the design questions only Joshua can answer. Owner
questions are asked one at a time; each answer becomes a decision record and
its stage goes `done`. Each question names the stage it first blocks; the
recommendation is to settle all of them before phase 1 starts, because the
core reducer (phase 3) encodes every one.

- `0` done: Plan and owner decisions
  - `0.1` done: Harness layout — decision 0001
  - `0.2` done: Client stack is React + Vite — decision 0002
  - `0.3` done: Review the scoring edge cases `SPEC.md` §5 — confirmed unchanged, decision 0003
  - `0.4` done: Round results → next round: auto-continue held by host taps, decision 0004
  - `0.5` done: Git — public `JEdward7777/Sketchy`, MIT, `main` — decision 0005
  - `0.6` done: Ratchet operator inputs — no stop point, deploys granted, email before blocking (0021); gate skipped (0008)
      Stop point: which phases one ratchet run covers. Deploy authority: whether
      the orchestrator may run `wrangler deploy` in this run, or every deploy is
      the owner's (harness/AGENTS.md §6). Second model: which model runs the
      gate in `pipeline/ratchet.md` step 3 — settled: skipped without Fable,
      decision 0008.
  - `0.7` done: Phase plan rewritten (this tree), decisions 0006, 0007 and 0009 — done when committed
      Phase structure in decision 0006; technical spec defaults in decision
      0007; drawings as strokes (owner-approved) in decision 0009; owner
      questions below. The operator flips this to `done` on commit.
  - `0.8` done: Owner design questions — decisions 0010–0020
    - `0.8.1` done: Host disconnects or leaves — any connected player may claim host, decision 0010 (blocks 3.3.5)
        Question: §3 says the host is "the player who created the room". If
        the host's phone dies for good, nobody can start, remove players or
        end the game. Decision 0004 already keeps auto-continue running.
        Options: (a) no migration — host controls wait for the host to
        reconnect or "Rejoin as…"; (b) after a grace period with the host
        disconnected, the role moves to the earliest-joined connected player
        and stays there; (c) any connected player may claim host while the
        host is disconnected.
        Recommendation: (b). It never strands a room, needs no extra button,
        and keeping the role where it moved avoids flapping when a flaky host
        phone reconnects. It amends §3, so it needs Joshua.
    - `0.8.2` done: Pause below 3 players — freeze and resume, decision 0011 (blocks 2.7.1, 3.3.5)
        Question: §7 says the game pauses below 3 active players "until
        someone rejoins or the host ends it", and also that a mid-round
        disconnect lets the round continue. Undecided: whether "active" means
        connected-and-not-removed or only not-removed; what happens to the
        running deadline; and what happens if a host removal is the cause.
        Options: (a) freeze — store the remaining time of every deadline,
        resume it when back to 3; (b) cancel the current round (no points, the
        faker turn moved later as in §7) and resume with a fresh round;
        (c) freeze only between rounds, let a running round finish.
        Recommendation: "active" = connected and not removed; pause only
        after a short grace so a reload does not flash a pause screen; then
        (a) freeze and resume. Under this definition a removal never changes the count (only
        disconnected players can be removed, §7), so the removal case matters
        only if "active" is instead "not removed"; then a removal that drops
        below 3 pauses the same way. The host can still end. One rule, no lost drawings.
        Also undecided: whether a waiting late joiner counts toward the 3
        (they are not in the round roster, 3.2, so they cannot play the
        current round).
        The definition of "active" also decides who enters a cycle (§7,
        stage 2.7.1). In a 3-player game, any mid-round disconnect makes this
        rule override §7's "the round continues"; say which applies first
        when the faker is the one who drops during briefing or draw (cancel
        or pause).
    - `0.8.3` done: Faker disconnects after drawing, and a reload blip during drawing — decision 0012 (blocks 2.7.2, 3.3.2)
        Question: §7 cancels the round only when the faker disconnects
        "during briefing or drawing". Undecided: slideshow, vote and guess;
        and whether a reload counts as a disconnect.
        Options for after drawing: (a) the round continues — the faker's
        drawing and any selected vote stand, and an absent faker at the
        guess means no guess = wrong (§4); (b) cancel as in briefing/draw.
        Options for blips: (a) any socket close cancels; (b) a grace window
        — reconnecting within it is not a disconnect.
        Recommendation: continue after drawing (the round's evidence already
        exists, and §4's "no guess = wrong" covers the guess), and a grace
        window before cancelling in briefing/draw, so a phone that sleeps for
        a moment does not wreck the round.
        Related: a cancelled round shows everyone that a disconnected player
        was the faker, and §7 moves that turn later in the cycle. Accept
        this, or keep the cancel screen generic ("Mission scrubbed")?
        Recommendation: generic wording; the leak is inherent (the public
        state changes because of who the faker is, stage 3.6.1) but need not
        be announced.
        Also: the scheduled faker is already disconnected when their round
        would start. Options: (a) start the round and cancel it per §7;
        (b) defer their turn later in the cycle without starting.
        Recommendation: (b) — starting a round only to cancel it wastes a
        briefing and announces who the faker would have been.
        Also: does a roster player who is disconnected during the draw hold
        up the "everyone is done" early end (§4)? Options: (a) only connected
        roster players must be done, matching §4's "last connected player
        locks in"; (b) every roster player must be done, so the full draw
        timer runs. Recommendation: (a), applied after the same blip grace,
        so a reload does not end the draw early for a player about to return.
        Also: under (a) for after-drawing, the faker may be disconnected for
        the whole voting window (slideshow + free browse, 0007 item 6).
        Decision 0003 item 2 excludes such a player from the tally ("neither
        side scores from them"). Does that apply to the faker — no +1 per real
        player not voting them, and no +1 to real players who voted for them —
        or does the exclusion cover real players only, so the faker's §5 rows
        score as usual? Recommendation: exclusion covers real players only;
        the faker's drawing stood as evidence, so the §5 rows score as usual
        (and no guess = wrong). Stage 2.2.2 tests whichever is chosen.
    - `0.8.4` done: Guess judging — timer, who must judge, zero judges, early end — decision 0013 (blocks 3.3.4)
        Question: §4 says everyone except the faker votes accept/reject and a
        tie goes to the faker, but gives no judging timer or quorum.
        Options: timer — (a) reuse the guess timer value, (b) a fixed short
        beat; quorum — (a) whoever judged by the deadline counts and the rest
        abstain, (b) all connected roster non-fakers (3.2) must judge; zero judges — 0–0 is
        a tie, so (a) accept per "tie goes to the faker", or (b) reject.
        Recommendation: reuse the guess timer; count whoever judged by the
        deadline; end early once every connected roster non-faker has judged; a
        judgment is one tap, final; 0–0 accepts (it is a tie, and the rule
        already favours the faker).
    - `0.8.5` done: Late joiners with no next cycle, and how Play again rebuilds the schedule — decision 0014 (blocks 2.7, 3.3.5)
        Question: §7 seats late joiners at the start of the next cycle; on the
        final cycle there is none. §4 says Play again keeps the room and
        players and resets scores, but not who is in the new schedule.
        Options: (a) a late joiner in the final cycle waits for Play again;
        (b) add an extra cycle for them. For Play again: (a) every
        non-removed player, including waiting late joiners, gets a fresh
        schedule with the current cycles setting, and removed players leave
        the scoreboard; (b) the same, but return to the lobby first so the
        host can change settings before starting.
        Recommendation: late joiner waits for Play again (an extra cycle
        would change the agreed game length); Play again returns to the lobby
        with everyone non-removed and settings editable, then a fresh
        schedule on start.
    - `0.8.6` done: Voting for a disconnected player, and the faker's own no-vote — decision 0015 (blocks 2.2, 3.3.3)
        Question: may a player vote for someone who is disconnected (their
        card may be dark)? If the faker casts no vote, is the §5 framing
        bonus simply not earned?
        Options: (a) any player in the round except yourself is a valid
        target, connected or not; (b) only connected players. Faker no-vote:
        (a) no framing bonus; (b) something else.
        Recommendation: (a) for targets — under 0.8.3's recommendation a
        faker can drop after drawing and must still be catchable; a vote for
        a player removed later in the round still counts. Faker no-vote earns
        no framing bonus, which is what §5's wording already implies.
    - `0.8.7` done: Everyone locks in during the slideshow — voting ends immediately, decision 0016 (blocks 3.3.3)
        Question: §4 ends the slideshow when two passes complete and ends
        free browse when the last connected player locks in. If everyone is
        locked before pass 2 ends, which happens?
        Options: (a) the slideshow plays out and voting ends at the end of
        pass 2, skipping free browse; (b) voting ends immediately, cutting
        the slideshow; (c) free browse runs its full timer anyway.
        Recommendation: (a). It is the literal reading of both rows of the
        §4 table, and everyone still sees every drawing twice.
    - `0.8.8` done: Does pressing the briefing envelope count as a host "hold" under 0004 rule 3? No — decision 0017 (blocks 3.3.2)
        Question: decision 0004 rule 3 makes any tap on the host's screen
        other than the Continue button a hold, and 0004 applies the same
        control to the briefing. The host must press and hold the envelope
        to read the word (§4).
        Options: (a) envelope presses are not holds; (b) literal 0004 — they
        are.
        Recommendation: (a). Under (b) a host who reads the briefing always
        pushes the deadline out, so the briefing is never the ~8 s beat §4
        describes.
    - `0.8.9` done: Default number of cycles — 2, decision 0018 (blocks 2.7.5, 4.6)
        Question: §7 says "default: 1 for a quick game, 2 for a longer one;
        allow 1–3" but not which default the settings panel shows.
        Options: (a) default 1; (b) default 2; (c) follow the timer preset —
        Quick gives 1, the others 2.
        Recommendation: (a). A first game should be short, and the host can
        raise it; (c) couples two settings in a way nobody would guess.
    - `0.8.10` done: Removed players — they can return to their original seat, decision 0019 (blocks 3.3.1)
        Question: decision 0007 item 5 lets a removed player's device join
        fresh as a late joiner. §7 keeps the removed player's score visible,
        greyed out, and §2 requires unique colors in the room.
        Options: (a) rejoin fresh allowed, the greyed entry keeps its color
        reserved; (b) rejoin fresh allowed, the color is freed; (c) a
        removed device may not rejoin this game.
        Recommendation: (a). The greyed scoreboard row stays readable by its
        color, and a fresh joiner simply picks another.
        Also: a player can be removed mid-round once disconnected (§7). Does
        the removal take them out of that round's roster (3.2) — their own
        vote, votes cast for them, the judging quorum and the `scoreRound`
        tally — or does the round finish as seated? And if the removed
        player is the faker after drawing (possible under 0.8.3's
        recommendation), does the round continue or cancel?
        Recommendation: the round finishes as seated (0003's presence rules
        already cover a disconnected player), the removal taking effect from
        the next round; a removed faker is treated like a disconnected one
        under 0.8.3.
        Note: a player removed before the slideshow has no card (0007 item
        7, 3.2), so "finishes as seated" must still say whether they remain
        a valid vote target (0.8.6) with no card to vote on; recommendation:
        not a valid target once removed before the slideshow.
    - `0.8.11` done: The last faker of each cycle is deducible — fixed by a random faker every round, decision 0020 (blocks 2.7.1)
        Question: unmask reveals each round's faker (§4) and §7 makes
        everyone faker exactly once per cycle, so the final round of every
        cycle has a known faker (and a cancelled turn moved later in the
        cycle is deducible the same way).
        Options: (a) accept — the last round of a cycle is a pure guess
        round; (b) for 2–3 cycles, shuffle all cycles' turns as one sequence
        with each player exactly `cycles` times, so only the game's final
        round is deducible (changes when late joiners can be seated);
        (c) something else from Joshua.
        Recommendation: (a) with the rules sheet (12.2) saying so; (b) helps
        only multi-cycle games and conflicts with §7's per-cycle late-joiner
        rule. Any option but (a) amends §7.
