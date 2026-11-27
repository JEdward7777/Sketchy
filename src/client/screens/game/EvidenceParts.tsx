/**
 * Pieces of the evidence screens (stages 9.2–9.5): the card with its
 * artist label, live vote chips, the slideshow progress, the suspects
 * board and the lock-in bar. Votes are public (§4), so everything here is
 * the same for every player apart from "you" markers and the controls a
 * player may use; nothing reads the private view.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import type { PublicPlayer, PublicRound } from '../../../shared/core/views';
import { SpyIcon, spyIconLabel } from '../../components/SpyIcon';
import { Button } from '../../components/ui';
import { SLIDESHOW_PASSES } from '../../../shared/slideshow';
import { canVoteFor, cardContent, lockCount, lockPending, myVote, votesFor, type LockSent, type SlideView, type VoteChip } from '../../game/evidence-model';
import type { DrawingBuffer } from '../../net/drawing-buffer';
import { playerColorLabel, playerColorVar } from '../../theme/player-colors';
import { DrawingView } from './DrawingView';

type Players = readonly PublicPlayer[];

const find = (players: Players, id: string) => players.find((p) => p.id === id);
const nameOf = (players: Players, id: string) => find(players, id)?.name ?? 'Unknown agent';

export function Badge({ player, size }: { player: PublicPlayer | undefined; size: number }) {
  return (
    <span
      className="evidence-badge"
      // Presence on every badge (11.5): CSS greys an agent who went dark or was removed and adds a corner dot.
      data-presence={player ? (player.removed ? 'removed' : player.connected ? 'online' : 'offline') : undefined}
      style={{ background: playerColorVar(player?.color ?? ''), '--badge': `${size}px` } as CSSProperties}
      title={player ? `${playerColorLabel(player.color)}, ${spyIconLabel(player.icon)}` : undefined}
      aria-hidden="true"
    >
      <SpyIcon icon={player?.icon ?? ''} size={Math.round(size * 0.62)} />
    </span>
  );
}

/** "Accused by Ava, you (locked)", or "No votes yet": what the chips say, for screen readers. */
function chipsLabel(chips: readonly VoteChip[], players: Players, you: string): string {
  if (chips.length === 0) return 'No votes yet';
  return `Accused by ${chips.map((c) => `${c.voter === you ? 'you' : nameOf(players, c.voter)}${c.locked ? ' (locked)' : ''}`).join(', ')}`;
}

/** The voters' chips (color and icon, §4); a locked vote wears a seal. */
export function VoteChips({ chips, players, you }: { chips: readonly VoteChip[]; players: Players; you: string }) {
  const label = chipsLabel(chips, players, you);
  if (chips.length === 0) return <span className="vote-chips vote-chips-empty" data-testid="vote-chips" role="img" aria-label={label} />;
  return (
    <span className="vote-chips" data-testid="vote-chips" role="img" aria-label={label}>
      {chips.map((c) => (
        <span key={c.voter} className="vote-chip" data-voter={c.voter} data-locked={c.locked}>
          <Badge player={find(players, c.voter)} size={28} />
          {c.locked ? <span className="vote-chip-seal" aria-hidden="true" /> : null}
        </span>
      ))}
    </span>
  );
}

/** One card: the artist's label on top, the picture (a vote button when this player may accuse them), the chips below. */
export function EvidenceCard({
  round,
  artist,
  index,
  players,
  you,
  drawings,
  onVote,
}: {
  round: PublicRound;
  artist: string;
  index: number;
  players: Players;
  you: string;
  drawings: DrawingBuffer | null;
  onVote: (target: string) => void;
}) {
  const p = find(players, artist);
  const name = nameOf(players, artist);
  const content = cardContent(round, artist, drawings);
  const votable = canVoteFor(round, you, artist);
  const mine = round.votes[you] === artist;
  const picture = <DrawingView content={content} artist={name} />;
  return (
    <article
      className="evidence-card"
      data-testid="evidence-card"
      data-artist={artist}
      data-content={content.kind}
      data-mine={mine}
      style={{ '--artist': playerColorVar(p?.color ?? '') } as CSSProperties}
    >
      <header className="evidence-tag" data-testid="evidence-artist">
        <Badge player={p} size={36} />
        <span className="evidence-name">{name}</span>
        {artist === you ? <span className="tag tag-you">you</span> : null}
        <span className="evidence-exhibit">Exhibit {index + 1}</span>
      </header>
      {votable ? (
        <button
          type="button"
          className="evidence-pic evidence-pic-vote"
          data-testid="evidence-vote"
          aria-pressed={mine}
          aria-label={`Accuse ${name}`}
          onClick={() => onVote(artist)}
        >
          {picture}
        </button>
      ) : (
        <div className="evidence-pic">{picture}</div>
      )}
      <footer className="evidence-foot">
        <VoteChips chips={votesFor(round, artist)} players={players} you={you} />
        {/* Below the drawing, never over it: the label for the tap above. */}
        {votable ? (
          <span className="evidence-pic-hint" data-testid="evidence-hint" data-mine={mine} aria-hidden="true">
            {mine ? 'Your suspect' : 'Tap the drawing to accuse'}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

/**
 * The current segment's fill. Its animation offset is fixed when the slide
 * mounts (keyed by slide and pause), so later re-renders cannot shift it:
 * a running CSS animation already counts the time since then.
 */
function SegmentFill({ within, perSlideMs, running }: { within: number; perSlideMs: number; running: boolean }) {
  const [delay] = useState(() => -within * perSlideMs);
  return (
    <span
      className="slide-seg-fill"
      data-testid="slide-fill"
      style={{ animationDuration: `${perSlideMs}ms`, animationDelay: `${delay}ms`, animationPlayState: running ? 'running' : 'paused' }}
    />
  );
}

/** Slideshow progress (9.2): one segment per slide over both passes, the current one filling for its duration. */
export function SlideProgress({ view, perSlideMs, paused }: { view: SlideView; perSlideMs: number; paused: boolean }) {
  const segments = Array.from({ length: view.total }, (_, i) => i);
  const cards = view.total / SLIDESHOW_PASSES;
  const running = !paused && view.status === 'showing';
  return (
    <div className="slide-progress" data-testid="slide-progress" data-slide={view.slide} data-card={view.card} data-pass={view.pass} data-status={view.status}>
      <p className="slide-progress-text" aria-hidden="true">
        Pass {view.pass + 1} of {SLIDESHOW_PASSES} · Exhibit {view.card + 1} of {cards}
      </p>
      {/* Announced once per pass, not on every slide. */}
      <p className="sr-only" aria-live="polite">
        Evidence pass {view.pass + 1} of {SLIDESHOW_PASSES}
      </p>
      <div className="slide-segments" aria-hidden="true">
        {segments.map((i) => (
          <span key={i} className="slide-seg" data-state={i < view.slide ? 'past' : i === view.slide ? 'now' : 'next'}>
            {i === view.slide ? <SegmentFill key={`${view.slide}-${running}`} within={view.within} perSlideMs={perSlideMs} running={running} /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Every card holder with their votes (9.4): tap one to accuse them. Your own row is shown but never offered. */
export function SuspectBoard({ round, players, you, onVote }: { round: PublicRound; players: Players; you: string; onVote: (target: string) => void }) {
  return (
    <ul className="suspects" data-testid="suspects" aria-label="Suspects">
      {(round.cards ?? []).map((id) => {
        const p = find(players, id);
        const name = nameOf(players, id);
        const votable = canVoteFor(round, you, id);
        const mine = round.votes[you] === id;
        const inner = (
          <>
            <Badge player={p} size={32} />
            <span className="suspect-name">{name}</span>
            {id === you ? <span className="tag tag-you">you</span> : null}
            {p && !p.connected ? <span className="tag tag-offline">offline</span> : null}
            <VoteChips chips={votesFor(round, id)} players={players} you={you} />
          </>
        );
        return (
          <li key={id} data-testid="suspect" data-target={id} data-mine={mine} data-state={p?.removed ? 'removed' : p?.connected === false ? 'offline' : 'online'}>
            {votable ? (
              <button type="button" className="suspect suspect-vote" data-testid="suspect-vote" aria-pressed={mine} aria-label={`Accuse ${name}. ${chipsLabel(votesFor(round, id), players, you)}`} onClick={() => onVote(id)}>
                {inner}
              </button>
            ) : (
              <div className="suspect" data-self={id === you}>
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** How long a sent lock keeps the button disabled without an answer. */
const LOCK_RETRY_MS = 5_000;

/** Lock-in (9.5): pick, then lock; a locked vote is final and shown as such. */
export function LockBar({ round, players, you, errorN, onLock }: { round: PublicRound; players: Players; you: string; errorN: number; onLock: () => boolean }) {
  const me = myVote(round, you);
  const { locked, of } = lockCount(round, (id) => find(players, id)?.connected ?? false);
  // A second tap before the room answers would only earn `vote_locked`.
  const [sent, setSent] = useState<LockSent | null>(null);
  const pending = lockPending(sent, me.locked, errorN);
  useEffect(() => {
    if (!sent) return;
    if (!pending) return setSent(null);
    // A lock lost with a dropped socket never gets an answer: offer the button again.
    const t = window.setTimeout(() => setSent(null), LOCK_RETRY_MS);
    return () => window.clearTimeout(t);
  }, [sent, pending]);
  const tally = (
    <p className="lock-count muted" data-testid="lock-count">
      {locked} of {of} agents locked in
    </p>
  );
  if (!me.canVote) return <div className="lock-bar">{tally}</div>;
  if (me.locked) {
    return (
      <div className="lock-bar" data-testid="lock-bar" data-locked="true">
        <p className="lock-final" data-testid="lock-final">
          <span className="lock-stamp" aria-hidden="true">Locked</span>
          <span>
            Your vote: <strong>{me.target ? nameOf(players, me.target) : '—'}</strong>. Final answer.
          </span>
        </p>
        {tally}
      </div>
    );
  }
  return (
    <div className="lock-bar" data-testid="lock-bar" data-locked="false">
      <p className="lock-pick" data-testid="lock-pick">
        {me.target ? (
          <>
            Accusing <strong>{nameOf(players, me.target)}</strong>. Tap another drawing to change.
          </>
        ) : (
          'Tap a drawing to accuse its artist.'
        )}
      </p>
      <Button
        wide
        onClick={() => {
          if (pending || !onLock()) return;
          setSent({ errorN });
        }}
        disabled={!me.target || pending}
        data-testid="lock-in"
      >
        {me.target ? `Lock in ${nameOf(players, me.target)}` : 'Lock in vote'}
      </Button>
      {tally}
    </div>
  );
}
