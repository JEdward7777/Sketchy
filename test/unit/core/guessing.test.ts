import { describe, expect, it } from 'vitest';
import { nextDeadline, projectPublic } from '../../../src/shared/core';
import { BLIP_GRACE_MS, BRIEFING_BEAT_MS, HOLD_REARM_MS, NARRATION_CAP_MS, RESULTS_BEAT_MS, UNMASK_BEAT_MS } from '../../../src/shared/core/rules';
import { TIMER_PRESETS } from '../../../src/shared/timers';
import { RoomDriver, WORD } from '../../helpers/room';

/**
 * Stage 3.3.4: unmask, the faker's guess, judging, scoring and round
 * results — SPEC §4 phases 5–7, §5; decisions 0003, 0004, 0007 item 6,
 * 0012 items 1 and 6, 0013, 0015 item 3.
 */

const { guessMs: GUESS_MS, voteMs: VOTE_MS } = TIMER_PRESETS.normal;

const phase = (r: RoomDriver) => projectPublic(r.state).phase;
const round = (r: RoomDriver) => projectPublic(r.state).round!;

function slideshow(n = 4, seed = 1) {
  const r = new RoomDriver(seed);
  const ids = r.joinMany(n);
  r.start(ids[0]!);
  r.advance(BRIEFING_BEAT_MS);
  r.drawAll();
  expect(r.phase).toBe('slideshow');
  const agents = r.state.round!.roster.filter((id) => id !== r.faker);
  return { r, ids, host: ids[0]!, agents };
}

/** Everyone votes by `pick` and locks; the unmask beat runs out; the guess is open. */
function guessing(n = 4, seed = 1, pick?: (r: RoomDriver, voter: string) => string) {
  const ctx = slideshow(n, seed);
  ctx.r.voteAll(pick && ((v) => pick(ctx.r, v)));
  expect(ctx.r.phase).toBe('unmask');
  ctx.r.fireNext();
  expect(ctx.r.phase).toBe('guess');
  return ctx;
}

function judging(n = 4, seed = 1) {
  const ctx = guessing(n, seed);
  ctx.r.intent(ctx.r.faker, { type: 'guess:submit', text: 'parasol' });
  expect(ctx.r.phase).toBe('judging');
  return ctx;
}

describe('unmask and the guess (§4 phases 5–6)', () => {
  it('unmask shows the faker for UNMASK_BEAT_MS, then the guess runs for the guess timer', () => {
    const { r } = slideshow(4);
    expect(round(r).faker).toBeNull();
    r.voteAll();
    const t = r.now;
    expect(phase(r)).toEqual({ name: 'unmask', endsAt: t + UNMASK_BEAT_MS });
    expect(round(r).faker).toBe(r.faker);
    r.fireNext();
    expect(phase(r)).toEqual({ name: 'guess', endsAt: t + UNMASK_BEAT_MS + GUESS_MS });
    expect(nextDeadline(r.state)).toBe(t + UNMASK_BEAT_MS + GUESS_MS);
  });

  for (const text of ['  UMBRELLAS! ', 'brolly', 'Umbrella.']) {
    it(`auto-accepts "${text}" (normalization, plural, alt) and scores +2`, () => {
      const { r } = guessing();
      r.intent(r.faker, { type: 'guess:submit', text });
      expect(r.phase).toBe('results');
      expect(round(r).result).toMatchObject({ word: WORD.word, correct: true, verdict: 'auto', faker: { guess: 2 } });
      expect(round(r).guess).toBe(text.trim());
    });
  }

  it('only the faker guesses, once, with a real word, and only while the guess is open', () => {
    const { r, agents } = slideshow(4);
    r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(r.errors()).toEqual(['wrong_phase']);
    r.voteAll();
    r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(r.errors()).toEqual(['wrong_phase']); // unmask beat
    r.fireNext();
    r.intent(agents[0]!, { type: 'guess:submit', text: 'umbrella' });
    expect(r.errors()).toEqual(['not_faker']);
    r.intent(r.faker, { type: 'guess:submit', text: ' ?! ' });
    expect(r.errors()).toEqual(['bad_guess']);
    r.intent(r.faker, { type: 'guess:submit', text: 'parasol' });
    r.intent(r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(r.errors()).toEqual(['wrong_phase']);
    expect(round(r).guess).toBe('parasol');
  });

  it('no guess by the deadline is wrong (§4), an absent faker included (0012 item 1)', () => {
    const { r } = guessing();
    r.offline(r.faker);
    r.fireNext(); // the faker's grace
    expect(r.phase).toBe('guess');
    r.fireNext();
    expect(round(r).result).toMatchObject({ correct: false, verdict: 'none', faker: { guess: 0 } });
    expect(round(r).guess).toBeNull();
  });
});

describe('judging (0013)', () => {
  it('opens for the guess timer from the submission; the faker and late joiners cannot judge; one final tap each', () => {
    const r0 = guessing();
    const t = r0.r.now + 1234;
    r0.r.now = t;
    r0.r.join('Late', 'teal');
    r0.r.intent(r0.r.faker, { type: 'guess:submit', text: 'parasol' });
    const { r, agents } = r0;
    expect(phase(r)).toEqual({ name: 'judging', endsAt: t + GUESS_MS });
    r.intent(r.faker, { type: 'guess:judge', accept: true });
    expect(r.errors()).toEqual(['not_judge']);
    r.intent(r.state.players.at(-1)!.id, { type: 'guess:judge', accept: true });
    expect(r.errors()).toEqual(['not_in_round']);
    r.intent(agents[0]!, { type: 'guess:judge', accept: false });
    r.intent(agents[0]!, { type: 'guess:judge', accept: true });
    expect(r.errors()).toEqual(['already_judged']);
    expect(round(r).judged).toEqual([agents[0]]);
  });

  it('ends once every connected non-faker has judged; a majority reject is wrong', () => {
    const { r, agents } = judging(4);
    r.intent(agents[0]!, { type: 'guess:judge', accept: false });
    r.intent(agents[1]!, { type: 'guess:judge', accept: false });
    expect(r.phase).toBe('judging');
    r.intent(agents[2]!, { type: 'guess:judge', accept: true });
    expect(round(r).result).toMatchObject({ correct: false, verdict: 'judged', accepts: 1, rejects: 2, faker: { guess: 0 } });
  });

  it('a judge past the blip grace is not waited for (0013 item 3)', () => {
    const { r, agents } = judging(4);
    r.offline(agents[2]!);
    r.intent(agents[0]!, { type: 'guess:judge', accept: true });
    r.intent(agents[1]!, { type: 'guess:judge', accept: true });
    expect(r.phase).toBe('judging');
    r.advance(BLIP_GRACE_MS);
    expect(round(r).result).toMatchObject({ correct: true, verdict: 'judged', accepts: 2, rejects: 0 });
  });

  it('a tie at the deadline accepts; whoever judged counts (0013 items 2, 5)', () => {
    const { r, agents } = judging(5);
    r.intent(agents[0]!, { type: 'guess:judge', accept: true });
    r.intent(agents[1]!, { type: 'guess:judge', accept: false });
    r.fireNext();
    expect(round(r).result).toMatchObject({ correct: true, accepts: 1, rejects: 1, faker: { guess: 2 } });
  });

  it('0–0 at the deadline accepts (0013 item 5)', () => {
    const { r } = judging(4);
    r.fireNext();
    expect(round(r).result).toMatchObject({ correct: true, verdict: 'judged', accepts: 0, rejects: 0 });
  });
});

describe('scoring (§5 via scoreRound; 0003, 0007 item 6, 0015 item 3)', () => {
  it('scores a round: agents +1 for catching the faker; faker +1 per agent fooled, +2 guess, +1 framing', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(4);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    r.drawAll();
    const f = r.faker;
    const [a, b, c] = r.state.round!.roster.filter((id) => id !== f);
    // a, b catch the faker; c and the faker vote a: a ties f for most votes, so framing counts.
    const pick: Record<string, string> = { [a!]: f, [b!]: f, [c!]: a!, [f]: a! };
    r.voteAll((v) => pick[v]!);
    r.fireNext();
    r.intent(f, { type: 'guess:submit', text: 'umbrella' });
    const result = round(r).result!;
    expect(result.points).toEqual({ [ids[0]!]: expect.any(Number), ...{ [a!]: 1, [b!]: 1, [c!]: 0, [f]: 1 + 2 + 1 } });
    expect(result.faker).toEqual({ undetected: 1, guess: 2, framing: 1 });
    expect(result.tally).toMatchObject({ [f]: 2, [a!]: 2 });
    const scores = Object.fromEntries(projectPublic(r.state).players.map((p) => [p.id, p.score]));
    expect(scores).toEqual({ [a!]: 1, [b!]: 1, [c!]: 0, [f]: 4 });
    expect(projectPublic(r.state).progress).toEqual({ completed: 1, total: 8 });
  });

  it('a vote selected but not locked when browse runs out counts as cast (§4)', () => {
    const { r, agents } = slideshow(3);
    const [a, b] = agents;
    r.intent(a!, { type: 'vote:set', targetId: r.faker });
    r.intent(b!, { type: 'vote:set', targetId: r.faker });
    r.intent(b!, { type: 'vote:lock' });
    r.fireNext(); // slideshow end
    r.fireNext(); // browse end
    expect(r.phase).toBe('unmask');
    r.fireNext();
    r.fireNext(); // no guess
    expect(round(r).result!.points).toMatchObject({ [a!]: 1, [b!]: 1, [r.faker]: 0 });
  });

  it('an agent disconnected for the whole voting window is excluded; one present for an instant is not (0003 items 1–2, 0007 item 6)', () => {
    const r = new RoomDriver(1);
    const ids = r.joinMany(5);
    r.start(ids[0]!);
    r.advance(BRIEFING_BEAT_MS);
    const agents = r.state.round!.roster.filter((id) => id !== r.faker && id !== ids[0]);
    const [away, blip] = agents;
    r.offline(away!);
    r.advance(BLIP_GRACE_MS); // away is disconnected before the slideshow and stays away
    r.drawAll();
    expect(r.phase).toBe('slideshow');
    r.offline(blip!);
    r.advance(BLIP_GRACE_MS); // blip was connected at the slideshow's start, then dropped: present
    r.voteAll((v) => (v === r.faker ? r.nextCard(v) : r.faker)); // every connected agent catches the faker
    expect(r.phase).toBe('unmask');
    r.fireNext();
    r.fireNext();
    const result = round(r).result!;
    expect(result.points[away!]).toBe(0);
    expect(result.points[blip!]).toBe(0);
    // Fooled: blip only (connected, no vote, 0003 item 1); away counts for neither side (0003 item 2).
    expect(result.faker.undetected).toBe(1);
  });

  it('a faker who drops after drawing and never votes: the round goes on, no framing bonus, no guess (0012 items 1, 6; 0015 item 3)', () => {
    const { r, agents } = slideshow(4);
    r.offline(r.faker);
    r.advance(BLIP_GRACE_MS);
    expect(r.phase).toBe('slideshow');
    r.voteAll((v) => (v === agents[0] ? agents[1]! : agents[0]!)); // nobody catches the faker
    expect(r.phase).toBe('unmask');
    r.fireNext();
    r.fireNext();
    expect(round(r).result!.faker).toEqual({ undetected: 3, guess: 0, framing: 0 });
  });
});

describe('round results and the 0004 continue', () => {
  function results(n = 4, seed = 1) {
    const ctx = guessing(n, seed);
    ctx.r.intent(ctx.r.faker, { type: 'guess:submit', text: 'umbrella' });
    expect(ctx.r.phase).toBe('results');
    return ctx;
  }

  it('auto-continues into the next round after RESULTS_BEAT_MS', () => {
    const { r } = results();
    const t = r.now;
    expect(phase(r)).toEqual({ name: 'results', continueAt: t + RESULTS_BEAT_MS, fillFrom: t, hostSpeaking: false });
    r.fireNext();
    expect(r.now).toBe(t + RESULTS_BEAT_MS);
    expect(r.phase).toBe('dealing');
    expect(r.state.round!.no).toBe(2);
    expect(r.last).toContainEqual({ type: 'clearDrawings', roundNo: 1 });
  });

  it('a host hold and narration push the continue; a non-host cannot (0004 rules 2–3)', () => {
    const { r, host, agents } = results();
    const t = r.now;
    r.intent(agents.find((id) => id !== host)!, { type: 'host:hold' });
    expect(phase(r)).toMatchObject({ continueAt: t + RESULTS_BEAT_MS });
    r.intent(host, { type: 'host:hold' });
    expect(phase(r)).toMatchObject({ fillFrom: t + HOLD_REARM_MS, continueAt: t + HOLD_REARM_MS + RESULTS_BEAT_MS });
    r.intent(host, { type: 'host:narration', speaking: true });
    expect(phase(r)).toMatchObject({ hostSpeaking: true });
    const r2 = results().r;
    r2.intent(host, { type: 'host:narration', speaking: true });
    expect(phase(r2)).toMatchObject({ continueAt: r2.now + NARRATION_CAP_MS + RESULTS_BEAT_MS });
  });

  it('the host going offline past the grace releases the hold (0004 rule 5)', () => {
    const { r, host } = results(5);
    const t = r.now;
    r.intent(host, { type: 'host:hold' });
    r.offline(host);
    r.fireNext(); // host grace
    expect(r.now).toBe(t + BLIP_GRACE_MS);
    expect(phase(r)).toMatchObject({ name: 'results', continueAt: t + BLIP_GRACE_MS + RESULTS_BEAT_MS });
  });

  it('host:next continues exactly once (0004 rules 4, 6)', () => {
    const { r, host, agents } = results();
    const seq = projectPublic(r.state).seq;
    r.intent(agents.find((id) => id !== host)!, { type: 'host:next', seq });
    expect(r.errors()).toEqual(['not_host']);
    r.intent(host, { type: 'host:next', seq });
    expect(r.phase).toBe('dealing');
    const dealt = r.effects.filter((e) => e.type === 'dealWord').length;
    r.intent(host, { type: 'host:next', seq });
    expect(r.errors()).toEqual([]);
    expect(r.phase).toBe('dealing');
    expect(r.effects.filter((e) => e.type === 'dealWord').length).toBe(dealt);
  });

  it('host:next in voting or the guess is refused; nothing else ends those phases early', () => {
    const { r, host } = guessing();
    r.intent(host, { type: 'host:next', seq: projectPublic(r.state).seq });
    expect(r.errors()).toEqual(['wrong_phase']);
  });

  it('the vote timer is the free-browse length (§8)', () => {
    const { r } = slideshow(3);
    r.fireNext();
    expect(phase(r)).toEqual({ name: 'browse', endsAt: r.now + VOTE_MS });
  });
});
