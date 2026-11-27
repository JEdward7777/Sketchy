/**
 * Round results and the final podium (stages 10.4–10.7, `SPEC.md` §4
 * phase 7 and "Final results", §5, decisions 0004, 0007 item 4, 0014,
 * 0026 item 2).
 *
 * - Round results: the verdict, the word (from `round.result.word`, the
 *   only place it is public, 0026 item 5), the faker's points by §5 row,
 *   and the running scoreboard. The host gets the 0004 auto-continue
 *   (phase 8's button, same hold semantics); everyone else sees when the
 *   next round starts.
 * - Final results: the podium with shared places, everyone below it, and
 *   the host's Play again (`host:next` with the shown `seq`, 0026 item 2).
 * - Both offer "Save my drawing" (SaveDrawing.tsx).
 */

import { useState, type CSSProperties } from 'react';
import { Button, Notice, Panel } from '../../components/ui';
import { podium, resultsContinueLabel, verdictOf, winnerLine, type PodiumEntry } from '../../game/results-model';
import { useHostHold } from '../../game/use-now';
import { playerColorVar } from '../../theme/player-colors';
import { AutoContinueButton } from './AutoContinue';
import { Badge } from './EvidenceParts';
import { AgentTag, FakerStamp, HostTools, RoundNotices, Scoreboard, type ScreenProps } from './ResultsParts';
import { Countdown } from './RoundParts';
import { SaveDrawing } from './SaveDrawing';

export function RoundResults(props: ScreenProps) {
  const { state, you, snap, conn } = props;
  const phase = state.phase;
  const round = state.round;
  const isHost = state.hostId === you;
  useHostHold(isHost && phase.name === 'results' && !state.paused, () => conn.send({ type: 'host:hold' }));
  if (phase.name !== 'results' || !round?.result) return null;
  const result = round.result;
  const v = verdictOf(result);
  const label = resultsContinueLabel(state.progress);
  const fakerPts = result.faker;
  return (
    <div className="stack round-screen" data-testid="results" data-phase="results">
      <RoundNotices {...props} />
      <section className="verdict" data-testid="verdict" data-kind={v.kind}>
        <span className="verdict-stamp">{v.kind === 'auto' || v.kind === 'accepted' ? 'Cracked' : 'Foiled'}</span>
        <h2 className="round-title">{v.title}</h2>
        {round.guess !== null ? (
          <p className="verdict-guess">
            Guess: <q data-testid="results-guess">{round.guess}</q>
          </p>
        ) : null}
        <p className="muted">{v.detail}</p>
      </section>
      <section className="word-reveal" data-testid="word-reveal">
        <span className="word-reveal-label">The secret word was</span>
        <strong className="word-reveal-word" data-testid="results-word">{result.word}</strong>
      </section>
      <div className="results-layout">
        <div className="stack">
          <FakerStamp round={round} players={state.players} you={you} />
          <ul className="faker-points" data-testid="faker-points" aria-label="The faker's points this round">
            <li>Undetected by {fakerPts.undetected} {fakerPts.undetected === 1 ? 'agent' : 'agents'} <strong>+{fakerPts.undetected}</strong></li>
            <li>Guessed the word <strong>+{fakerPts.guess}</strong></li>
            <li>Framed the top suspect <strong>+{fakerPts.framing}</strong></li>
          </ul>
        </div>
        <Scoreboard state={state} you={you} points={result.points} />
      </div>
      <SaveDrawing state={state} you={you} snap={snap} />
      <div data-testid="results-footer">
        {isHost ? (
          <AutoContinueButton
            phase={phase}
            seq={state.seq}
            paused={state.paused}
            clock={snap.clock}
            opens={snap.opens}
            label={label}
            onContinue={(seq) => conn.send({ type: 'host:next', seq })}
          />
        ) : (
          <div className="row center-row">
            <span className="muted">{label === 'Final results' ? 'Final results in' : 'Next round in'}</span>
            <Countdown deadline={phase.continueAt} paused={state.paused} clock={snap.clock} label={`${label} in`} testId="results-countdown" />
          </div>
        )}
      </div>
      <HostTools {...props} />
    </div>
  );
}

function PodiumStep({ entries, place, state, you }: { entries: readonly PodiumEntry[]; place: number } & Pick<ScreenProps, 'state' | 'you'>) {
  return (
    <li className="podium-step" data-testid="podium-step" data-place={place} data-count={entries.length}>
      <div className="podium-agents">
        {entries.map((e) => {
          const p = state.players.find((q) => q.id === e.id);
          return (
            <div key={e.id} className="podium-agent" data-testid="podium-agent" data-player={e.id} data-place={e.place} data-score={e.score} style={{ '--artist': playerColorVar(p?.color ?? '') } as CSSProperties}>
              <Badge player={p} size={place === 1 ? 64 : 48} />
              <span className="podium-name">{p?.name ?? 'Unknown agent'}</span>
              {e.id === you ? <span className="tag tag-you">you</span> : null}
              <span className="podium-score">{e.score} pts</span>
            </div>
          );
        })}
      </div>
      <div className="podium-block" aria-label={entries.length > 0 ? entries[0]!.label : `No ${place === 2 ? 'second' : 'third'} place`}>
        <span className="podium-place">{place}</span>
      </div>
    </li>
  );
}

export function FinalResults(props: ScreenProps) {
  const { state, you, snap, conn } = props;
  const phase = state.phase;
  // The seq and socket a Play again went out on: a send lost with a dropped socket re-arms on the next one.
  const [sent, setSent] = useState<{ seq: number; opens: number } | null>(null);
  if (phase.name !== 'final') return null;
  const isHost = state.hostId === you;
  const p = podium(phase.standings);
  return (
    <div className="stack round-screen" data-testid="final" data-phase="final">
      <RoundNotices {...props} />
      <div className="round-head">
        <span className="verdict-stamp">Case closed</span>
        <h2 className="round-title" data-testid="winner-line">{winnerLine(phase.standings, state.players)}</h2>
      </div>
      <ol className="podium" data-testid="podium" aria-label="Podium">
        {p.steps.map((entries, i) => (
          <PodiumStep key={i} entries={entries} place={i + 1} state={state} you={you} />
        ))}
      </ol>
      {p.rest.length > 0 ? (
        <Panel title="The rest of the agency" testId="standings-rest">
          <ol className="score-list">
            {p.rest.map((e) => (
              <li key={e.id} className="score-row score-row-plain" data-testid="standing" data-player={e.id} data-place={e.place}>
                <span className="score-place">{e.place}</span>
                <AgentTag players={state.players} id={e.id} you={you}>
                  {e.label.startsWith('Tied') ? <span className="tag">tied</span> : null}
                </AgentTag>
                <span className="score-total">{e.score}</span>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
      <SaveDrawing state={state} you={you} snap={snap} />
      {isHost ? (
        <Button
          wide
          disabled={sent !== null && sent.seq === state.seq && sent.opens === snap.opens}
          onClick={() => {
            if (conn.send({ type: 'host:next', seq: state.seq })) setSent({ seq: state.seq, opens: snap.opens });
          }}
          data-testid="play-again"
        >
          Play again
        </Button>
      ) : (
        <Notice testId="waiting-host">Waiting for the host to start a new mission. Same agents, scores back to zero.</Notice>
      )}
      <HostTools {...props} />
    </div>
  );
}
