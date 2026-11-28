/**
 * The big-screen display's body for each public phase (stage 12.4). It
 * reuses the phone screens' pieces — the evidence card and slideshow, the
 * vote board, the faker stamp, the scoreboard and podium — fed public
 * state and the spectator id, so the TV shows what every phone shows.
 * The word appears only from `round.result.word`, on the results.
 */

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PublicRound, PublicState } from '../../../shared/core/views';
import { PlayerChip } from '../../components/PlayerChip';
import { SealedEnvelope } from '../../components/SpyArt';
import { lockCount } from '../../game/evidence-model';
import { SPECTATOR, drawStatus, gridColumns } from '../../game/display-model';
import { judgeCount, podium, verdictOf } from '../../game/results-model';
import { isLoopbackOrigin, joinUrl } from '../../lobby/join-url';
import type { RoomSnapshot } from '../../net/connection';
import { Slideshow } from '../game/Evidence';
import { Badge, EvidenceCard, SuspectBoard } from '../game/EvidenceParts';
import { AgentTag, FakerStamp, Scoreboard, VoteBoard } from '../game/ResultsParts';
import { PodiumStep } from '../game/Results';

type Props = { state: PublicState; snap: RoomSnapshot };
/** A card's name tag and chips row, and the grid gap, in rem (display.css `.display-grid`). */
const CARD_CHROME_REM = 7.25;
const GRID_GAP_REM = 0.75;
const noVote = () => {};

function Roster({ state }: { state: PublicState }) {
  return (
    <ul className="display-roster" data-testid="display-roster">
      {state.players.map((p) => (
        <li key={p.id}>
          <PlayerChip player={p} isHost={p.id === state.hostId} />
        </li>
      ))}
    </ul>
  );
}

function Lobby({ state }: { state: PublicState }) {
  const url = joinUrl(location.origin, state.code);
  return (
    <div className="display-split display-lobby">
      <section className="display-invite panel">
        <div className="qr display-qr" data-testid="display-qr">
          <QRCodeSVG value={url} size={320} marginSize={0} title={`Join room ${state.code}`} />
        </div>
        <p className="room-code display-room-code">{state.code}</p>
        <p className="join-link">{url}</p>
        {isLoopbackOrigin(location.origin) ? <p className="notice notice-warn">Phones can't reach {new URL(location.origin).hostname}: open the game by this computer's network address.</p> : null}
      </section>
      <section className="display-side">
        <h2 className="display-sub">Agents ({state.players.filter((p) => !p.removed).length})</h2>
        <Roster state={state} />
        <p className="muted">The host starts the mission from their phone.</p>
      </section>
    </div>
  );
}

function Briefing({ state }: { state: PublicState }) {
  return (
    <div className="display-split">
      <div className="display-envelope-stage">
        <SealedEnvelope className="display-envelope" />
      </div>
      <section className="display-side">
        <p className="display-lead">Everyone's envelope holds the secret word. One agent's holds only the category.</p>
        <Roster state={state} />
      </section>
    </div>
  );
}

function Draw({ state }: { state: PublicState }) {
  const status = drawStatus(state);
  const filed = status.filter((s) => s.done).length;
  return (
    <div className="display-stack">
      <p className="display-lead">
        {filed} of {status.length} drawings filed
      </p>
      <ul className="display-agents">
        {status.map((s) => {
          const p = state.players.find((q) => q.id === s.id);
          return (
            <li key={s.id} className="display-agent" data-testid="display-agent" data-player={s.id} data-done={s.done}>
              <Badge player={p} size={72} />
              <span className="display-agent-name">{p?.name ?? 'Agent'}</span>
              <span className={s.done ? 'display-filed stamp-ink' : 'display-drawing'}>{s.done ? 'Filed' : 'Drawing…'}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Every drawing of the round at once, tiled to fill the screen (a contact sheet). */
function DrawingGrid({ round, state, snap }: { round: PublicRound; state: PublicState; snap: RoomSnapshot }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 16, h: 9, rem: 16 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cards = round.cards ?? [];
  // CARD_CHROME_REM and GRID_GAP_REM match display.css (`.display-grid`).
  const cols = gridColumns(cards.length, size.w, size.h, CARD_CHROME_REM * size.rem, GRID_GAP_REM * size.rem);
  const rows = Math.max(1, Math.ceil(cards.length / cols));
  return (
    <div ref={box} className="display-grid" data-testid="display-grid" style={{ '--cols': cols, '--rows': rows } as CSSProperties}>
      {cards.map((id, i) => (
        <EvidenceCard key={id} round={round} artist={id} index={i} players={state.players} you={SPECTATOR} drawings={snap.drawings} onVote={noVote} />
      ))}
    </div>
  );
}

function LockTally({ state, round }: { state: PublicState; round: PublicRound }) {
  const { locked, of } = lockCount(round, (id) => state.players.find((p) => p.id === id)?.connected ?? false);
  return (
    <p className="display-lead" data-testid="display-locks">
      {locked} of {of} agents locked in
    </p>
  );
}

function Evidence({ state, snap, round }: Props & { round: PublicRound }) {
  const phase = state.phase;
  return (
    <div className="display-split display-evidence">
      <div className="display-main">
        {phase.name === 'slideshow' ? (
          <Slideshow state={state} you={SPECTATOR} snap={snap} onVote={noVote} phase={phase} />
        ) : (
          <DrawingGrid round={round} state={state} snap={snap} />
        )}
      </div>
      <aside className="display-side">
        <LockTally state={state} round={round} />
        <SuspectBoard round={round} players={state.players} you={SPECTATOR} onVote={noVote} />
      </aside>
    </div>
  );
}

function Review({ state, snap, round }: Props & { round: PublicRound }) {
  const judging = state.phase.name === 'judging';
  const { judged, of } = judgeCount(round, (id) => state.players.find((p) => p.id === id)?.connected ?? false);
  const faker = state.players.find((p) => p.id === round.faker)?.name ?? 'The faker';
  return (
    <div className="display-split display-evidence">
      <div className="display-main">
        <DrawingGrid round={round} state={state} snap={snap} />
      </div>
      <aside className="display-side">
        {judging ? (
          <>
            <section className="guess-card" aria-label={`${faker}'s guess`}>
              <span className="guess-card-kicker">{faker} guessed</span>
              <q className="guess-card-text" data-testid="display-guess">{round.guess}</q>
            </section>
            <p className="display-lead" data-testid="display-judged">
              {judged} of {of} {of === 1 ? 'agent has' : 'agents have'} judged
            </p>
            <p className="muted">Majority rules; a tie goes to the faker.</p>
          </>
        ) : (
          <p className="display-lead">The faker gets one shot at the secret word. Exact match wins outright; anything else goes to the jury.</p>
        )}
        <FakerStamp round={round} players={state.players} you={SPECTATOR} />
      </aside>
    </div>
  );
}

function Results({ state, round }: { state: PublicState; round: PublicRound }) {
  const result = round.result!;
  const v = verdictOf(result);
  return (
    <div className="display-split">
      <div className="display-stack">
        <section className="verdict" data-kind={v.kind}>
          <span className="verdict-stamp stamp-ink">{v.kind === 'auto' || v.kind === 'accepted' ? 'Cracked' : 'Foiled'}</span>
          {round.guess !== null ? (
            <p className="verdict-guess">
              Guess: <q>{round.guess}</q>
            </p>
          ) : null}
          <p className="muted">{v.detail}</p>
        </section>
        <section className="word-reveal" data-testid="word-reveal">
          <span className="word-reveal-stamp" aria-hidden="true">Declassified</span>
          <span className="word-reveal-label">The secret word was</span>
          <strong className="word-reveal-word" data-testid="results-word">{result.word}</strong>
        </section>
        <FakerStamp round={round} players={state.players} you={SPECTATOR} />
      </div>
      <Scoreboard state={state} you={SPECTATOR} points={result.points} />
    </div>
  );
}

function Final({ state }: { state: PublicState }) {
  if (state.phase.name !== 'final') return null;
  const p = podium(state.phase.standings);
  return (
    <div className="display-split">
      <ol className="podium display-podium" data-testid="podium" aria-label="Podium">
        {p.steps.map((entries, i) => (
          <PodiumStep key={i} entries={entries} place={i + 1} state={state} you={SPECTATOR} />
        ))}
      </ol>
      <section className="panel">
        <h2 className="panel-title">Final standings</h2>
        <ol className="score-list" data-testid="display-standings">
          {state.phase.standings.map((s) => (
            <li key={s.id} className="score-row score-row-plain" data-player={s.id}>
              <span className="score-place">{s.place}</span>
              <AgentTag players={state.players} id={s.id} you={SPECTATOR} />
              <span className="score-total">{s.score}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function DisplayPhase({ state, snap }: Props) {
  const round = state.round;
  let body;
  switch (state.phase.name) {
    case 'lobby':
      body = <Lobby state={state} />;
      break;
    case 'dealing':
    case 'briefing':
      body = <Briefing state={state} />;
      break;
    case 'draw':
      body = <Draw state={state} />;
      break;
    case 'slideshow':
    case 'browse':
      body = round?.cards ? <Evidence state={state} snap={snap} round={round} /> : null;
      break;
    case 'unmask':
      body = round ? (
        // The faker is the hero here: the stamp large on the left, who voted for whom beside it.
        <div className="display-split display-unmask">
          <FakerStamp round={round} players={state.players} you={SPECTATOR} animate />
          <VoteBoard round={round} players={state.players} you={SPECTATOR} />
        </div>
      ) : null;
      break;
    case 'guess':
    case 'judging':
      body = round?.cards ? <Review state={state} snap={snap} round={round} /> : null;
      break;
    case 'results':
      body = round?.result ? <Results state={state} round={round} /> : null;
      break;
    case 'final':
      body = <Final state={state} />;
      break;
    case 'scrubbed':
      body = (
        <section className="scrubbed-card display-center">
          <span className="scrubbed-stamp" aria-hidden="true">Scrubbed</span>
          <p className="display-lead">HQ called this one off. No points change hands, and it won't count toward the game.</p>
        </section>
      );
      break;
  }
  return (
    <div className="display-body" key={`${state.phase.name}-${round?.no ?? 0}`}>
      {body}
    </div>
  );
}
