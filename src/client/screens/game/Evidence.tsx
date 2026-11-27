/**
 * The evidence screens (phase 9, `SPEC.md` §4 phases 3–4, §8): the synced
 * two-pass slideshow, then free browse with the vote countdown. Voting is
 * open in both: tap a drawing (or a suspect) to accuse its artist, change
 * your mind until you lock in. When every connected player has locked,
 * the room moves to unmask at once, mid-slideshow included (0016); this
 * screen simply follows the public phase.
 *
 * The slide comes from `slideshow.startsAt` and the clock offset
 * (`useSlide`), never from per-slide messages. Nothing here reads the
 * private view, so the screen never shows the word or a role (8.3.3).
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PublicState } from '../../../shared/core/views';
import { Button, Notice } from '../../components/ui';
import { showVoteError, stepCard, swipeStep, voteErrorText } from '../../game/evidence-model';
import { useSlide } from '../../game/use-slide';
import { errorText } from '../../messages';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import { useFlash } from '../use-flash';
import { FairnessNotices } from './Fairness';
import { EvidenceCard, LockBar, SlideProgress, SuspectBoard } from './EvidenceParts';
import { CategoryBadge, Countdown } from './RoundParts';

type Props = { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection };

export function Evidence({ state, you, snap, conn }: Props) {
  const phase = state.phase;
  const round = state.round;
  const flash = useFlash(snap.error);
  if ((phase.name !== 'slideshow' && phase.name !== 'browse') || !round?.cards) return null;
  const vote = (targetId: string) => conn.send({ type: 'vote:set', targetId });
  const lock = () => conn.send({ type: 'vote:lock' });
  const props = { state, you, snap, onVote: vote };

  return (
    <div className="stack round-screen evidence-screen" data-testid="evidence" data-phase={phase.name}>
      <div className="evidence-notices">
        {flash && showVoteError(flash.code, round.locked.includes(you)) ? <Notice tone="error" testId="evidence-error">{voteErrorText(flash.code) ?? errorText(flash.code)}</Notice> : null}
        <FairnessNotices state={state} you={you} conn={conn} />
      </div>
      <div className="draw-top evidence-top">
        <CategoryBadge category={round.category} />
        {phase.name === 'browse' ? (
          <Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="Voting closes in" testId="vote-countdown" />
        ) : null}
      </div>
      <h2 className="round-title evidence-title">{phase.name === 'slideshow' ? "Let's review the evidence" : 'Free browse: who is bluffing?'}</h2>
      <div className="evidence-layout">
        <div className="evidence-main">
          {phase.name === 'slideshow' ? <Slideshow {...props} phase={phase} /> : <Browse {...props} />}
        </div>
        <aside className="evidence-side">
          <LockBar round={round} players={state.players} you={you} errorN={snap.error?.n ?? 0} onLock={lock} />
          <SuspectBoard round={round} players={state.players} you={you} onVote={vote} />
        </aside>
      </div>
    </div>
  );
}

type CardProps = { state: PublicState; you: string; snap: RoomSnapshot; onVote: (id: string) => void };

function Slideshow({ state, you, snap, onVote, phase }: CardProps & { phase: { startsAt: number; perSlideMs: number } }) {
  const round = state.round!;
  const cards = round.cards!;
  const view = useSlide(phase, cards.length, snap.clock, state.paused);
  const artist = cards[view.card];
  return (
    <>
      <SlideProgress view={view} perSlideMs={phase.perSlideMs} paused={state.paused !== null} />
      <div className="evidence-stage" data-testid="slide" data-slide={view.slide} data-card={view.card}>
        {artist ? (
          <div key={view.slide} className="evidence-slide-in">
            <EvidenceCard round={round} artist={artist} index={view.card} players={state.players} you={you} drawings={snap.drawings} onVote={onVote} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function Browse({ state, you, snap, onVote }: CardProps) {
  const round = state.round!;
  const cards = round.cards!;
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, cards.length - 1));
  const step = (delta: number) => setIndex((i) => stepCard(i, delta, cards.length));
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const swiped = useRef(false);

  // Arrow keys flip too (keyboard players), unless a text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);

  const onDown = (e: ReactPointerEvent) => {
    swiped.current = false;
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const d = swipeStep(e.clientX - s.x, e.clientY - s.y);
    if (d !== 0) {
      // A swipe that ends on the drawing is not a tap on it: no vote.
      swiped.current = true;
      step(d);
    }
  };
  const artist = cards[at];
  return (
    <>
      <div className="browse-nav" data-testid="browse-nav">
        <Button variant="ghost" className="btn-small browse-btn" onClick={() => step(-1)} aria-label="Previous drawing" data-testid="browse-prev">
          ‹ Prev
        </Button>
        <span className="browse-pos" data-testid="browse-pos" aria-live="polite">
          Exhibit {at + 1} of {cards.length}
        </span>
        <Button variant="ghost" className="btn-small browse-btn" onClick={() => step(1)} aria-label="Next drawing" data-testid="browse-next">
          Next ›
        </Button>
      </div>
      <div
        className="evidence-stage evidence-swipe"
        data-testid="browse-card"
        data-card={at}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (swipe.current = null)}
        onClickCapture={(e) => {
          if (!swiped.current) return;
          swiped.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {artist ? (
          <div key={at} className="evidence-slide-in">
            <EvidenceCard round={round} artist={artist} index={at} players={state.players} you={you} drawings={snap.drawings} onVote={onVote} />
          </div>
        ) : null}
      </div>
    </>
  );
}
