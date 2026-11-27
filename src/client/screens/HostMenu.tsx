/**
 * The host's controls during a game (phase 11, `SPEC.md` §3, §7): a
 * "Host" button in the room header on every game screen, opening a modal
 * with End game (0026 item 3; not on the final results) and the agent list
 * with Remove for anyone who went dark (0019). The header keeps it off the
 * round screens' own layout (the draw screen is exactly one viewport tall)
 * and out of the markup every player must share (8.3.3). Short landscape
 * screens hide the header to fit the canvas or card; the pause screen
 * carries End game and Remove on its own.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PublicState } from '../../shared/core/views';
import { Button } from '../components/ui';
import { hostAttention } from '../game/fairness-model';
import type { RoomConnection } from '../net/connection';
import { PlayerList } from './RoomParts';

/** End game behind one confirm tap (`host:end`, from any phase but the lobby and final results). */
export function EndGame({ conn, onEnded }: { conn: RoomConnection; onEnded?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <div className="row center-row" data-testid="host-end-confirm">
      <span className="muted">End the game for everyone?</span>
      <Button
        variant="danger"
        className="btn-small"
        onClick={() => {
          conn.send({ type: 'host:end' });
          onEnded?.();
        }}
        data-testid="host-end"
      >
        Yes, end it
      </Button>
      <Button variant="ghost" className="btn-small" onClick={() => setConfirm(false)}>
        Keep playing
      </Button>
    </div>
  ) : (
    <Button variant="danger" onClick={() => setConfirm(true)} data-testid="host-end-ask">
      End game
    </Button>
  );
}

export function HostMenu({ state, you, conn }: { state: PublicState; you: string; conn: RoomConnection }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const attention = hostAttention(state);

  // The pause screen takes over (it has End game and Remove itself), so the menu closes under it.
  const paused = state.paused !== null;
  useEffect(() => {
    if (paused) setOpen(false);
  }, [paused]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <Button
        variant="secondary"
        className="btn-small host-menu-btn"
        aria-haspopup="dialog"
        aria-label={attention > 0 ? `Host controls, ${attention} waiting on you` : 'Host controls'}
        onClick={() => setOpen(true)}
        data-testid="host-menu"
      >
        Host
        {attention > 0 ? (
          <span className="host-menu-dot" aria-hidden="true">
            {attention}
          </span>
        ) : null}
      </Button>
      {/* In <body>, not the header: short landscape screens hide the header, which would hide an open dialog too. */}
      {createPortal(
        <dialog
          ref={dialog}
          className="host-dialog"
          aria-labelledby="host-dialog-title"
          data-testid="host-tools"
          onClose={() => setOpen(false)}
          // A tap on the backdrop (outside the card) closes it.
          onClick={(e) => {
            if (e.target === dialog.current) setOpen(false);
          }}
        >
          {open ? (
            <div className="stack host-dialog-body">
              <div className="row host-dialog-head">
                <h2 id="host-dialog-title" className="panel-title">
                  Host controls
                </h2>
                <Button variant="ghost" className="btn-small" onClick={() => setOpen(false)} data-testid="host-menu-close">
                  Close
                </Button>
              </div>
              <PlayerList state={state} you={you} conn={conn} scores />
              <p className="muted">Only an agent who went dark can be removed. They keep their score and can come back.</p>
              {state.phase.name !== 'final' ? <EndGame conn={conn} onEnded={() => setOpen(false)} /> : null}
            </div>
          ) : null}
        </dialog>,
        document.body,
      )}
    </>
  );
}
