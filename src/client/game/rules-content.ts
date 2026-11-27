/**
 * The words of the ⓘ rules sheet (stage 12.2, `SPEC.md` §11) that must
 * track the spec: the §5 scoring table (test/unit/client/narrator.test.ts
 * compares it with SPEC.md) and the round's phases (§4).
 */

/** `SPEC.md` §5, row for row. */
export const SCORING_ROWS: readonly (readonly [who: string, earns: string])[] = [
  ['Real player', '+1 for voting for the faker'],
  ['Faker', '+1 for each real player who did not vote for them'],
  ['Faker', '+2 for a correct word guess'],
  ['Faker', '+1 if the player the faker voted for received the most votes (a tie for most counts)'],
];

export const PHASES: readonly (readonly [string, string])[] = [
  ['Briefing', 'Press and hold the envelope to read your orders: the category and the secret word, or the news that you are the faker. Let go and it seals again.'],
  ['Draw', 'Everyone draws the word at the same time. The faker bluffs from the category. Tap Done when you are finished.'],
  ['Evidence', 'A slideshow shows every drawing twice. Voting is already open.'],
  ['Free browse', 'Flip through the drawings and vote for your suspect. Change your mind until you lock in.'],
  ['Unmask', 'Everyone sees who voted for whom, and the faker is revealed.'],
  ['Faker’s guess', 'The faker guesses the word. A match counts at once (capitals, spaces, punctuation and plurals don’t matter, and some words accept an alternative); otherwise everyone else votes on whether it counts, and a tie goes to the faker.'],
  ['Results', 'Points for the round and the running scoreboard. After the last round: the podium.'],
];
