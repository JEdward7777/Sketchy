/**
 * The draw phase (stages 8.4–8.7, `SPEC.md` §4 phase 2, §9): the category
 * and countdown on top, the canvas, the tools, and the envelope kept
 * within reach (8.3.2). Done sends `draw:done`; at the deadline the
 * drawing goes by itself (inside the room's submit grace). Once sent, or
 * once public state lists this player as done, the waiting screen shows
 * who else has finished.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicState } from '../../../shared/core/views';
import { PlayerChip } from '../../components/PlayerChip';
import { Notice, Panel } from '../../components/ui';
import { serverClock } from '../../game/countdown';
import { autoSubmitDue, dropDraft, loadDraft, resendDue, saveDraft, sentAgain, type PendingDraw } from '../../game/draw-model';
import { DEFAULT_TOOL, StrokeCapture, type Tool } from '../../game/stroke-capture';
import { useServerNow } from '../../game/use-now';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import type { KeyValueStorage } from '../../net/token-store';
import { ClaimHost, RejoinRequests } from '../RoomParts';
import { useFlash } from '../use-flash';
import { DrawCanvas } from './DrawCanvas';
import { DrawTools } from './DrawTools';
import { Envelope } from './Envelope';
import { CategoryBadge, Countdown, OnDeck } from './RoundParts';

function sessionStore(): KeyValueStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Refusals that mean the drawing did not land and can be sent again. */
const RETRYABLE = new Set(['too_large', 'bad_strokes', 'bad_message']);

/** No page scroll, overscroll bounce or iOS pinch while the canvas is up (8.4). */
function useDrawLock(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('draw-lock');
    const noGesture = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', noGesture);
    return () => {
      root.classList.remove('draw-lock');
      document.removeEventListener('gesturestart', noGesture);
    };
  }, []);
}

export function DrawPhase({ state, you, snap, conn }: { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection }) {
  const phase = state.phase;
  const roundNo = state.round?.no ?? 0;
  const seated = state.round?.roster.includes(you) ?? false;
  const doneInState = state.round?.done.includes(you) ?? false;
  const round = snap.round && snap.round.no === roundNo ? snap.round : null;

  const storage = useRef(sessionStore()).current;
  const [capture] = useState(() => new StrokeCapture(loadDraft(storage, state.code, roundNo)));
  const [tool, setTool] = useState<Tool>(DEFAULT_TOOL);
  const [version, setVersion] = useState(capture.version);
  /** Sent (or tried) and not yet listed in `round.done`: the waiting screen shows "sending". */
  const [pending, setPending] = useState<PendingDraw | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const errorAtSend = useRef<number>(0);
  const now = useServerNow(snap.clock, 250);
  const flash = useFlash(snap.error);

  const changed = () => {
    setVersion(capture.version);
    setRefused(null);
    saveDraft(storage, state.code, roundNo, capture.strokes);
  };

  /** Send the drawing; true when the socket took it. `connection.send` refuses while not open. */
  const transmit = (): boolean => {
    errorAtSend.current = snap.error?.n ?? 0;
    return conn.send({ type: 'draw:done', strokes: capture.wire() });
  };

  const submit = () => {
    if (pending || doneInState) return;
    const ok = transmit();
    setPending({ at: Date.now(), socket: ok ? snap.opens : -1, tries: 0 });
    setRefused(null);
    setVersion(capture.version);
  };

  // A refusal puts the canvas back so the player can fix it; `wrong_phase` means the draw closed; `already_done` is a resend that the room had after all.
  useEffect(() => {
    const e = snap.error;
    if (!pending || !e || e.n <= errorAtSend.current) return;
    if (RETRYABLE.has(e.code)) {
      setPending(null);
      setRefused(e.code === 'too_large' ? 'That masterpiece is too big to send. Undo a few strokes and try again.' : 'HQ could not read that drawing. Try Done again.');
    }
  }, [snap.error, pending]);

  useEffect(() => {
    if (doneInState) dropDraft(storage, state.code, roundNo);
  }, [doneInState, storage, state.code, roundNo]);

  const inDraw = phase.name === 'draw';
  const endsAt = inDraw ? phase.endsAt : 0;
  useEffect(() => {
    if (!inDraw || !seated || doneInState) return;
    if (pending) {
      // Not confirmed: resend on a new socket, or after a while on this one.
      if (snap.status === 'open' && resendDue(pending, Date.now(), snap.opens, conn.bufferedAmount()) && transmit()) {
        setPending(sentAgain(pending, Date.now(), snap.opens));
      }
      return;
    }
    // Time's up: send whatever is on the canvas, once (the pending resend takes it from there).
    if (refused === null && autoSubmitDue(serverClock(Date.now(), snap.clock), endsAt, state.paused, snap.clock !== null)) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, snap.status, snap.opens, inDraw, seated, doneInState, pending, refused, endsAt, state.paused]);

  if (phase.name !== 'draw') return null;
  const header = (
    <>
      {flash && !RETRYABLE.has(flash.code) && flash.code !== 'already_done' ? <Notice tone="error">{flash.code === 'wrong_phase' ? 'Too late: the drawing window closed.' : 'Something went sideways. Try that again.'}</Notice> : null}
      <ClaimHost state={state} you={you} conn={conn} />
      <RejoinRequests state={state} you={you} conn={conn} />
      {state.paused ? <Notice tone="warn" testId="paused">Paused: fewer than 3 agents online.</Notice> : null}
    </>
  );

  if (!seated) {
    return (
      <div className="stack round-screen" data-testid="draw-ondeck">
        {header}
        <CategoryBadge category={state.round?.category ?? null} />
        <OnDeck />
      </div>
    );
  }

  if (pending || doneInState) {
    return (
      <div className="stack round-screen" data-testid="draw-waiting" data-filed={doneInState}>
        {header}
        <div className="draw-top">
          <CategoryBadge category={state.round?.category ?? null} />
          <Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="Drawing time left" />
        </div>
        <Panel title={doneInState ? 'Drawing filed' : 'Sending your drawing to HQ…'}>
          <p className="muted" data-testid="draw-waiting-status">
            {doneInState
              ? 'Sit tight, agent. The slideshow starts when everyone is done or the clock runs out.'
              : snap.status === 'open'
                ? 'Waiting for HQ to confirm it arrived.'
                : "Lost contact with HQ. It goes out again as soon as you're back."}
          </p>
          <ul className="player-list" data-testid="done-list">
            {(state.round?.roster ?? []).map((id) => {
              const p = state.players.find((q) => q.id === id);
              if (!p) return null;
              const done = state.round?.done.includes(id) ?? false;
              return (
                <li key={id} data-done={done} data-player={id}>
                  <PlayerChip player={p} isYou={id === you}>
                    <span className={`done-tag ${done ? 'done-yes' : 'done-no'}`}>{done ? 'Filed' : 'Drawing…'}</span>
                  </PlayerChip>
                </li>
              );
            })}
          </ul>
        </Panel>
        {round ? (
          <div className="mini-envelope-row">
            <span className="muted">Need another look?</span>
            <Envelope round={round} size="mini" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <DrawingBoard
      header={header}
      category={state.round?.category ?? null}
      countdown={<Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="Drawing time left" />}
      envelope={round ? <Envelope round={round} size="mini" /> : null}
      capture={capture}
      tool={tool}
      setTool={setTool}
      version={version}
      changed={changed}
      refused={refused}
      submit={() => {
        setRefused(null);
        submit();
      }}
      progress={`${state.round?.done.length ?? 0} of ${state.round?.roster.length ?? 0} filed`}
    />
  );
}

function DrawingBoard({
  header,
  category,
  countdown,
  envelope,
  capture,
  tool,
  setTool,
  version,
  changed,
  refused,
  submit,
  progress,
}: {
  header: ReactNode;
  category: string | null;
  countdown: ReactNode;
  envelope: ReactNode;
  capture: StrokeCapture;
  tool: Tool;
  setTool: (t: Tool) => void;
  version: number;
  changed: () => void;
  refused: string | null;
  submit: () => void;
  progress: string;
}) {
  useDrawLock();
  return (
    <div className="draw-screen" data-testid="draw">
      {header}
      <div className="draw-top">
        <CategoryBadge category={category} />
        <span className="draw-progress muted" data-testid="draw-progress">{progress}</span>
        {countdown}
        {envelope}
      </div>
      {refused ? <Notice tone="error" testId="draw-refused">{refused}</Notice> : null}
      <div className="draw-main">
        <div className="draw-canvas-wrap">
          <div className="draw-canvas-box">
            <DrawCanvas capture={capture} tool={tool} version={version} onChange={changed} />
          </div>
        </div>
        <DrawTools
          tool={tool}
          onTool={setTool}
          canUndo={capture.strokes.length > 0}
          onUndo={() => {
            capture.undo();
            changed();
          }}
          onClear={() => {
            capture.clear();
            changed();
          }}
          onDone={submit}
        />
      </div>
    </div>
  );
}
