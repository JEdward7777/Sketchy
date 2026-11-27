/**
 * The fairness pieces every round screen carries (phase 11, `SPEC.md` §7):
 *
 * - `FairnessNotices`: the 0010 claim-host control, the host's 0024
 *   admit/decline, and the on-deck line for a player not seated this round
 *   (0020 item 4). While paused the first two move onto the pause screen.
 * - `PauseScreen`: below 3 active agents the room freezes (0011); this
 *   covers the frozen screen with who went dark, what it takes to go on,
 *   the 0023/0025 restart wait when new agents stand by, and the host's
 *   End game. The room never pauses from unmask on (0027), so neither does
 *   this.
 *
 * Public state only: nothing here can name the faker or the word.
 */

import { useEffect, useRef } from 'react';
import { PlayerChip } from '../../components/PlayerChip';
import { Button, Notice } from '../../components/ui';
import { formatSeconds, secondsShown } from '../../game/countdown';
import { agentsText, onDeckText, pauseDarkPlayers, pauseView } from '../../game/fairness-model';
import { useServerNow } from '../../game/use-now';
import { canRemove } from '../../lobby/lobby-model';
import { ClaimHost, RejoinRequests } from '../RoomParts';
import { EndGame } from '../HostMenu';
import type { ScreenProps } from './ResultsParts';

export function OnDeck({ text }: { text: string }) {
  return <Notice testId="on-deck">{text}</Notice>;
}

/** Claim host, rejoin requests (not while paused: the pause screen has them) and the on-deck line. */
export function FairnessNotices({ state, you, conn }: Omit<ScreenProps, 'snap'>) {
  const deck = onDeckText(state, you);
  return (
    <>
      {state.paused ? null : <ClaimHost state={state} you={you} conn={conn} />}
      {state.paused ? null : <RejoinRequests state={state} you={you} conn={conn} />}
      {deck ? <OnDeck text={deck} /> : null}
    </>
  );
}

export function PauseScreen({ state, you, snap, conn }: ScreenProps) {
  const view = pauseView(state);
  const now = useServerNow(snap.clock, 500);
  const title = useRef<HTMLHeadingElement>(null);
  const paused = view !== null;
  // Focus the dialog when it opens, so a screen reader announces it, and give focus back to
  // where it was when the round resumes (the screen underneath is inert only while paused).
  useEffect(() => {
    if (!paused) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    title.current?.focus();
    return () => {
      if (before?.isConnected && before !== document.body) before.focus();
    };
  }, [paused]);
  if (!view) return null;
  const isHost = state.hostId === you;
  const dark = pauseDarkPlayers(state);
  const restartLeft = view.restartAt === null ? null : Math.max(0, view.restartAt - now);

  return (
    <div className="pause-overlay" data-testid="paused" data-kind={view.kind}>
      <section className="pause-card" role="dialog" aria-modal="true" aria-labelledby="pause-title" aria-describedby="pause-why">
        <div className="pause-main">
          <span className="pause-stamp" aria-hidden="true">On hold</span>
          <h2 id="pause-title" className="round-title" tabIndex={-1} ref={title}>
            Mission paused
          </h2>
          <p id="pause-why" className="pause-why" data-testid="pause-why">
            {view.kind === 'round'
              ? `Fewer than 3 agents are online, so HQ froze the clock. Every timer picks up where it stopped once ${agentsText(view.needed)} ${view.needed === 1 ? 'reconnects' : 'reconnect'}.`
              : `Fewer than 3 agents are online. The next round starts once ${agentsText(view.needed)} ${view.needed === 1 ? 'reconnects or joins' : 'reconnect or join'} with room code ${state.code}.`}
          </p>
          {restartLeft !== null ? (
            <p className="pause-restart" data-testid="pause-restart" role="timer">
              {view.waiting === 1 ? 'A new agent is' : 'New agents are'} standing by.{' '}
              {secondsShown(restartLeft) > 0
                ? `If nobody comes back within ${secondsText(restartLeft)}, HQ scrubs this round and deals a fresh one with everyone.`
                : 'If nobody comes back, HQ scrubs this round and deals a fresh one with everyone any moment now.'}
            </p>
          ) : null}
          {isHost ? <EndGame conn={conn} /> : <p className="muted pause-note">The host can end the game from here if nobody is coming back.</p>}
        </div>
        <div className="pause-side">
          {dark.length > 0 ? (
            <div className="stack pause-dark">
              <h3 className="pause-sub">Gone dark</h3>
              <ul className="player-list" data-testid="pause-dark">
                {dark.map((p) => (
                  <li key={p.id}>
                    {/* The heading already says they went dark: no status tag on these chips. */}
                    <PlayerChip player={p} isHost={p.id === state.hostId} isYou={p.id === you} statusTag={false}>
                      {isHost && canRemove(p) ? (
                        <Button variant="danger" className="btn-small" onClick={() => conn.send({ type: 'host:remove', playerId: p.id })} aria-label={`Remove ${p.name}`}>
                          Remove
                        </Button>
                      ) : null}
                    </PlayerChip>
                  </li>
                ))}
              </ul>
              {isHost ? <p className="muted pause-note">Removing an agent keeps their score; they can come back later.</p> : null}
            </div>
          ) : null}
          <ClaimHost state={state} you={you} conn={conn} />
          <RejoinRequests state={state} you={you} conn={conn} />
        </div>
      </section>
    </div>
  );
}

/** "1 second", "23 seconds"; `m:ss` from a minute up. */
function secondsText(ms: number): string {
  const s = secondsShown(ms);
  if (s >= 60) return formatSeconds(ms);
  return s === 1 ? '1 second' : `${s} seconds`;
}
