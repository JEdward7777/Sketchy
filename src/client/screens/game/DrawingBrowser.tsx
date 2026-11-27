/**
 * A compact look back through the round's drawings during the guess and
 * judging (review round 1 of phase 10; `SPEC.md` §1, §4: the faker guesses
 * the word from everyone's drawings). Prev / Next and the arrow keys flip
 * through `round.cards`; voting is over, so a card is a picture, never a
 * button. The final vote chips stay under each drawing. Public data only.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import type { PublicPlayer, PublicRound } from '../../../shared/core/views';
import { Button } from '../../components/ui';
import { cardContent, stepCard, votesFor } from '../../game/evidence-model';
import type { DrawingBuffer } from '../../net/drawing-buffer';
import { playerColorVar } from '../../theme/player-colors';
import { DrawingView } from './DrawingView';
import { Badge, VoteChips } from './EvidenceParts';

export function DrawingBrowser({
  round,
  players,
  you,
  drawings,
  title,
}: {
  round: PublicRound;
  players: readonly PublicPlayer[];
  you: string;
  drawings: DrawingBuffer | null;
  title: string;
}) {
  const cards = round.cards ?? [];
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, cards.length - 1));
  const step = (d: number) => setIndex((i) => stepCard(i, d, cards.length));

  // Arrow keys flip too, except while typing (the faker's guess field), with a modifier, or when something else took the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      if (e.key === 'ArrowLeft') setIndex((i) => stepCard(i, -1, cards.length));
      else if (e.key === 'ArrowRight') setIndex((i) => stepCard(i, 1, cards.length));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cards.length]);

  const artist = cards[at];
  if (artist === undefined) return null;
  const p = players.find((q) => q.id === artist);
  const name = p?.name ?? 'Unknown agent';
  return (
    <section className="drawing-browser" data-testid="drawing-browser" aria-label={title}>
      <div className="browse-nav">
        <Button variant="ghost" className="btn-small browse-btn" onClick={() => step(-1)} aria-label="Previous drawing" data-testid="review-prev">
          ‹ Prev
        </Button>
        <span className="browse-pos" aria-live="polite" data-testid="review-pos">
          Exhibit {at + 1} of {cards.length}
        </span>
        <Button variant="ghost" className="btn-small browse-btn" onClick={() => step(1)} aria-label="Next drawing" data-testid="review-next">
          Next ›
        </Button>
      </div>
      <article
        className="evidence-card review-card"
        data-testid="review-card"
        data-artist={artist}
        data-content={cardContent(round, artist, drawings).kind}
        style={{ '--artist': playerColorVar(p?.color ?? '') } as CSSProperties}
      >
        <header className="evidence-tag">
          <Badge player={p} size={30} />
          <span className="evidence-name">{name}</span>
          {artist === you ? <span className="tag tag-you">you</span> : null}
        </header>
        <div className="evidence-pic">
          <DrawingView content={cardContent(round, artist, drawings)} artist={name} />
        </div>
        {/* Under the picture, as on the evidence cards: the chips wrap there and never squeeze the name. */}
        <footer className="evidence-foot">
          <VoteChips chips={votesFor(round, artist)} players={players} you={you} />
        </footer>
      </article>
    </section>
  );
}
