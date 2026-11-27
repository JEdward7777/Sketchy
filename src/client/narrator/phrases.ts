/**
 * The narrator's lines (stage 12.1.1, `SPEC.md` §10, §12): one bank per
 * moment, in the spy voice — playful, family-friendly, never mean, never
 * baby-ish. Each line is a template over `LineVars`, which the picker
 * fills from the public state only (picker.ts), so nothing here can say
 * the word before the round's result is public or name the faker before
 * unmask. The structure (banks of templates, a no-repeat shuffle) follows
 * confess_n_guess's `announcer.ts`; the wording is Sketchy's own.
 *
 * Lines stay one or two short sentences: the server lets the host's
 * narrator hold the Continue fill for at most `NARRATION_CAP_MS`.
 */

/** What a line may mention. Every field comes from `PublicState` (picker.ts). */
export interface LineVars {
  /** A seated agent's public name, picked at random (briefing). */
  readonly agent: string;
  readonly category: string;
  /** A whole number of seconds, written as digits for the speech engine. */
  readonly seconds: string;
  /** From `round.faker`, so only from unmask on. */
  readonly faker: string;
  /** The submitted guess text (public once submitted). */
  readonly guess: string;
  /** From `round.result.word`, so only once the guess has resolved. */
  readonly word: string;
  /** Leader(s) by score, joined with "and". */
  readonly leader: string;
  readonly points: string;
}

export type Line = (v: LineVars) => string;

export const BANKS = {
  gameStart: [
    () => `Mission is a go. Agents, check your envelopes.`,
    () => `Welcome to the operation, agents. Your first briefing is on the table.`,
    (v) => `The game is afoot. Agent ${v.agent}, your briefing is classified.`,
    () => `Case files open. Somebody here is not who they seem.`,
    () => `Operation Sketchy is live. Trust your pencils. Trust nobody else.`,
    () => `Agents, assemble. One of you is faking it.`,
  ],
  briefing: [
    (v) => `New briefing, agents. The category is ${v.category}.`,
    (v) => `Agent ${v.agent}, your briefing is classified. Category: ${v.category}.`,
    (v) => `Fresh envelopes are out. Tonight's category: ${v.category}.`,
    (v) => `Read your orders. The category is ${v.category}. Straight faces, please.`,
    (v) => `Envelopes up. Category: ${v.category}. Someone is about to wing it.`,
    (v) => `Briefing time. ${v.category} is the category, and secrecy is the policy.`,
    (v) => `Psst. The category is ${v.category}. The rest is eyes only.`,
  ],
  drawStart: [
    (v) => `Draw now. ${v.seconds} seconds on the clock.`,
    (v) => `Pencils up, agents. You have ${v.seconds} seconds.`,
    (v) => `Sketch it. ${v.seconds} seconds, starting now.`,
    (v) => `The canvas is yours. ${v.seconds} seconds, and no peeking at your neighbor.`,
    (v) => `Draw like your cover depends on it. ${v.seconds} seconds.`,
    (v) => `Go go go. ${v.seconds} seconds to make it convincing.`,
  ],
  drawLast: [
    () => `Ten seconds, agents.`,
    () => `Ten seconds left. Finishing touches.`,
    () => `Ten seconds. Wrap it up.`,
    () => `The clock says ten. Make it count.`,
    () => `Ten seconds to go. Steady hands.`,
  ],
  slideshow: [
    () => `Pencils down. Let's review the evidence.`,
    () => `Time's up. Bring in the exhibits.`,
    () => `Hands off the canvas. The evidence is coming in.`,
    () => `Drawings secured. Study each one closely. Voting is open.`,
    () => `Pencils down, agents. Somebody here was bluffing. Find them.`,
    () => `Let the slideshow begin. Look for anything a little too vague.`,
  ],
  browse: [
    (v) => `Free browse. ${v.seconds} seconds to lock in your suspect.`,
    (v) => `Flip back through the evidence. You have ${v.seconds} seconds to vote.`,
    (v) => `Compare notes and point fingers. ${v.seconds} seconds.`,
    (v) => `The files are open. Lock in your vote within ${v.seconds} seconds.`,
    () => `Take another look, agents. Then name your suspect.`,
  ],
  unmaskCaught: [
    (v) => `The faker was… ${v.faker}! Nicely spotted, agents.`,
    (v) => `Unmasked! It was ${v.faker} all along. The room saw right through you.`,
    (v) => `The faker was… ${v.faker}! Busted, but not beaten yet.`,
    (v) => `And the faker is… ${v.faker}! Good detective work, everyone.`,
    (v) => `Caught red-handed. The faker was ${v.faker}!`,
  ],
  unmaskEscaped: [
    (v) => `The faker was… ${v.faker}! And they slipped right past you.`,
    (v) => `Plot twist. The faker was ${v.faker}! Smooth operator.`,
    (v) => `The faker was… ${v.faker}! Agents, check your instincts.`,
    (v) => `Surprise! It was ${v.faker}. A masterclass in blending in.`,
    (v) => `The faker was ${v.faker}! Nobody saw that coming. Well, almost nobody.`,
  ],
  guess: [
    (v) => `${v.faker}, one last chance. Guess the secret word. ${v.seconds} seconds.`,
    (v) => `Over to you, ${v.faker}. Name that word for two points.`,
    (v) => `${v.faker}, the drawings are your only clues. What was the word?`,
    (v) => `Your move, ${v.faker}. ${v.seconds} seconds to crack the code.`,
    (v) => `${v.faker}, study the evidence and take your best shot at the word.`,
  ],
  judging: [
    (v) => `${v.faker} guessed ${v.guess}. Agents, does it count?`,
    (v) => `The guess is ${v.guess}. Jury, thumbs up or thumbs down?`,
    (v) => `${v.guess}, says ${v.faker}. Is that close enough? You decide.`,
    (v) => `Ruling needed. ${v.faker} says ${v.guess}. A tie goes to the faker.`,
    () => `Close call. Everyone except the faker, cast your verdict.`,
  ],
  verdictRight: [
    (v) => `The word was ${v.word}, and ${v.faker} cracked it. Two points.`,
    (v) => `Correct! The word was ${v.word}. ${v.faker} reads drawings like a pro.`,
    (v) => `${v.word} it is. ${v.faker} pulls off the heist.`,
    (v) => `Confirmed: ${v.word}. ${v.faker}, that was sneaky good.`,
  ],
  verdictWrong: [
    (v) => `Not quite. The word was ${v.word}.`,
    (v) => `Denied. The real word was ${v.word}. Better luck next mission, ${v.faker}.`,
    (v) => `Swing and a miss. It was ${v.word}.`,
    (v) => `The word was ${v.word}. ${v.faker}'s cover story needs work.`,
  ],
  verdictNone: [
    (v) => `No guess from ${v.faker}. The word was ${v.word}.`,
    (v) => `Time's up, and the line went quiet. The word was ${v.word}.`,
    (v) => `${v.faker} stayed silent. For the record, it was ${v.word}.`,
  ],
  standings: [
    (v) => `${v.leader} leads with ${v.points}.`,
    (v) => `On top of the board: ${v.leader}, at ${v.points}.`,
    (v) => `Current standings: ${v.leader} out front with ${v.points}.`,
    (v) => `${v.leader} holds the lead at ${v.points}. For now.`,
  ],
  standingsTied: [
    (v) => `${v.leader} are tied at ${v.points}.`,
    (v) => `Dead heat: ${v.leader}, ${v.points} each.`,
    (v) => `It's neck and neck. ${v.leader} share the lead at ${v.points}.`,
  ],
  final: [
    (v) => `Mission complete! ${v.leader} wins with ${v.points}.`,
    (v) => `Case closed. Top agent: ${v.leader}, with ${v.points}.`,
    (v) => `And the medal for outstanding espionage goes to ${v.leader}. ${v.points}!`,
    (v) => `That's a wrap. ${v.leader} takes the game with ${v.points}.`,
  ],
  finalTied: [
    (v) => `Mission complete! ${v.leader} share the win with ${v.points}.`,
    (v) => `Case closed, and it's a tie. ${v.leader}, ${v.points} each. Rematch?`,
    (v) => `A photo finish. ${v.leader} split the top spot at ${v.points}.`,
  ],
  scrubbed: [
    () => `Mission scrubbed. Shred your notes. New envelopes are on the way.`,
    () => `HQ called this one off. No points, no hard feelings.`,
    () => `Abort, abort. This round doesn't count. Stand by for a fresh briefing.`,
    () => `Scrubbed. Burn the evidence and reset, agents.`,
  ],
  paused: [
    () => `Mission paused. We're short on agents.`,
    () => `Hold everything. HQ needs at least three agents online.`,
    () => `Clocks frozen. Waiting for our missing agents to check in.`,
    () => `Pause. Someone went dark, and we need them back.`,
  ],
  resumed: [
    () => `We're back. The clock is running.`,
    () => `Contact restored. Resume the mission.`,
    () => `All agents accounted for. Carry on.`,
    () => `And we're live again. Pick up where you left off.`,
  ],
  lobbyReturn: [
    () => `Back to headquarters. New recruits welcome.`,
    () => `Scores wiped, cover stories reset. Ready for another round of lies?`,
    () => `Back at HQ. The host can start the next operation whenever you're ready.`,
  ],
  toggleOn: [
    () => `Narrator online.`,
    () => `Narrator reporting for duty.`,
    () => `Mic check. Narrator is on the case.`,
  ],
} satisfies Record<string, readonly Line[]>;

export type BankName = keyof typeof BANKS;
