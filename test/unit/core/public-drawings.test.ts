import { describe, expect, it } from 'vitest';
import { publicDrawings } from '../../../src/shared/core';
import { BRIEFING_BEAT_MS } from '../../../src/shared/core/rules';
import { RoomDriver, STROKES } from '../../helpers/room';

/** Stage 6.5: which drawings the adapter may deliver, and when (decisions 0006, 0030). */

function confirmStores(r: RoomDriver): void {
  for (const e of r.last) if (e.type === 'storeDrawing') r.step({ kind: 'drawingStored', key: e.key });
}

function drawing(n = 4) {
  const r = new RoomDriver();
  const ids = r.joinMany(n);
  r.start(ids[0]!);
  return { r, ids };
}

describe('publicDrawings (stage 6.5)', () => {
  it('is null in the lobby, while dealing, in the briefing and throughout the draw', () => {
    const r = new RoomDriver();
    const ids = r.joinMany(3);
    expect(publicDrawings(r.state)).toBeNull();
    r.intent(ids[0]!, { type: 'host:start' });
    expect(r.phase).toBe('dealing');
    expect(publicDrawings(r.state)).toBeNull();
    r.deal();
    expect(publicDrawings(r.state)).toBeNull();
    r.advance(BRIEFING_BEAT_MS);
    expect(r.phase).toBe('draw');
    r.intent(ids[0]!, { type: 'draw:done', strokes: STROKES });
    confirmStores(r);
    r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    confirmStores(r);
    expect(r.phase).toBe('draw');
    expect(publicDrawings(r.state)).toBeNull();
  });

  it('from the slideshow on: one per card holder who submitted, in card order', () => {
    const { r, ids } = drawing(4);
    r.advance(BRIEFING_BEAT_MS);
    for (const id of ids.slice(0, 3)) {
      r.intent(id, { type: 'draw:done', strokes: STROKES });
      confirmStores(r);
    }
    r.fireNext();
    expect(r.phase).toBe('slideshow');
    const cards = r.state.round!.cards!;
    const pub = publicDrawings(r.state)!;
    expect(pub.roundNo).toBe(1);
    expect(pub.drawings).toEqual(cards.filter((id) => id !== ids[3]).map((id) => ({ playerId: id, key: `1:${id}` })));
    r.fireNext();
    expect(r.phase).toBe('browse');
    expect(publicDrawings(r.state)).toEqual(pub);
  });

  it('is null after a cancel and in the lobby after Play again', () => {
    const { r, ids } = drawing(4);
    r.advance(BRIEFING_BEAT_MS);
    r.intent(ids[1]!, { type: 'draw:done', strokes: STROKES });
    confirmStores(r);
    r.intent(ids[0]!, { type: 'host:end' });
    expect(r.phase).toBe('final');
    // Ended before the slideshow: the drawings never became public.
    expect(publicDrawings(r.state)).toBeNull();
    r.intent(ids[0]!, { type: 'host:next', seq: r.state.phaseSeq });
    expect(r.phase).toBe('lobby');
    expect(publicDrawings(r.state)).toBeNull();
  });
});
