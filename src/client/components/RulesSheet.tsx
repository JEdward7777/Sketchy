/**
 * The ⓘ rules sheet (stage 12.2, `SPEC.md` §11): how to play, the round's
 * phases, the §5 scoring table word for word, and the connection rules in
 * brief. On every screen, the lobby included.
 *
 * Opening it never interrupts the game: it is a local dialog that sends
 * nothing. The button and the dialog are `data-hold-exempt`, so even on
 * the host's briefing or round results a tap on them is not a 0004 "hold".
 * The dialog lives in `<body>` (short landscape screens hide the header),
 * and it closes with Close, Escape or a tap on the backdrop, giving focus
 * back to the ⓘ button, so host controls are never covered for long.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RESTART_WAIT_MS } from '../../shared/core/rules';
import { HOLD_EXEMPT_ATTR } from '../game/hold-throttle';
import { PHASES, SCORING_ROWS } from '../game/rules-content';
import { Button } from './ui';

const exempt = { [HOLD_EXEMPT_ATTR]: '' };

function RulesBody() {
  return (
    <div className="stack rules-body">
      <section className="stack rules-section">
        <h3 className="rules-sub">The mission</h3>
        <p>
          Everyone gets the same secret word and draws it. Everyone except the <strong>faker</strong>, who only sees the
          category and has to draw something believable anyway. Then you study the drawings and vote on who was faking.
          Nobody is eliminated. The faker is picked at random every round, so anyone can be the faker, even twice in a
          row.
        </p>
        <p className="muted">
          The game lasts the number of cycles the host picks times the number of agents at the start. A round that is
          called off doesn't count toward it.
        </p>
      </section>
      <section className="stack rules-section">
        <h3 className="rules-sub">Each round</h3>
        <ol className="rules-phases">
          {PHASES.map(([name, text]) => (
            <li key={name}>
              <strong>{name}.</strong> {text}
            </li>
          ))}
        </ol>
        <p className="muted">
          Votes are public and everyone votes, the faker included. You can't vote for yourself. A vote that isn't locked
          when time runs out still counts.
        </p>
      </section>
      <section className="stack rules-section">
        <h3 className="rules-sub">Scoring</h3>
        <table className="rules-table" data-testid="rules-scoring">
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Earns</th>
            </tr>
          </thead>
          <tbody>
            {SCORING_ROWS.map(([who, earns]) => (
              <tr key={earns}>
                <th scope="row">{who}</th>
                <td>{earns}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          A real player who doesn't vote counts as not voting for the faker. A cancelled round scores nothing.
        </p>
      </section>
      <section className="stack rules-section">
        <h3 className="rules-sub">Losing signal</h3>
        <ul className="rules-list">
          <li>Reload or lose Wi-Fi and you come back as the same agent with the same score.</li>
          <li>On a new phone, scan the code again and pick "Rejoin as…".</li>
          <li>If the faker drops out during the briefing or the draw, the round is scrubbed: no points, and a fresh round starts.</li>
          <li>
            Below 3 agents online, the game pauses until someone comes back or the host ends it. If new agents are standing
            by and nobody returns within {RESTART_WAIT_MS / 1000} seconds, the round is scrubbed and a fresh one starts with everyone.
          </li>
          <li>Once the faker is unmasked, the round plays to the end without pausing.</li>
          <li>New agents wait in the lobby and are dealt in from the next round.</li>
        </ul>
      </section>
    </div>
  );
}

export function RulesButton() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // The header and the pause screen each have one, so the title id must be unique.
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        className="btn-small icon-btn"
        aria-haspopup="dialog"
        aria-label="Rules"
        title="Rules"
        onClick={() => setOpen(true)}
        data-testid="rules-open"
        {...exempt}
      >
        <span aria-hidden="true" className="icon-glyph">
          i
        </span>
      </Button>
      {createPortal(
        <dialog
          ref={dialog}
          className="rules-dialog"
          aria-labelledby={titleId}
          data-testid="rules"
          {...exempt}
          // Escape fires `close` (and `cancel` first); either way the state follows.
          onClose={close}
          onClick={(e) => {
            // A click on the dialog itself is either its padding or the backdrop: close only when outside its box.
            const d = dialog.current;
            if (!d || e.target !== d) return;
            const r = d.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
          }}
        >
          {open ? (
            <div className="stack rules-dialog-body">
              <div className="row rules-dialog-head">
                <h2 id={titleId} className="panel-title">
                  Field manual
                </h2>
                <Button variant="ghost" className="btn-small" onClick={close} data-testid="rules-close" autoFocus>
                  Close
                </Button>
              </div>
              <RulesBody />
            </div>
          ) : null}
        </dialog>,
        document.body,
      )}
    </>
  );
}
