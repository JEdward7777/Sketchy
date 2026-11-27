/**
 * The host's continue (stage 8.9, decision 0004, after confess_n_guess's
 * `AutoContinueButton`): a Continue button that fills from the room's
 * `fillFrom` to `continueAt` and continues when full. The room holds the
 * deadline (rule 5); this only draws it. Tapping it continues at once with
 * the `seq` it was shown in (rules 4 and 6). Every other tap on the host's
 * screen is a hold (`useHostHold`), except the envelope (0017).
 *
 * Phase 10.5 reuses it for round results, whose phase has the same fields.
 */

import { useState } from 'react';
import type { ClockOffset } from '../../../shared/clock-offset';
import { fillFraction, secondsShown, timeLeft, type Paused } from '../../game/countdown';
import { useServerNow } from '../../game/use-now';

export interface AutoPhase {
  readonly continueAt: number;
  readonly fillFrom: number;
  readonly hostSpeaking: boolean;
}

export function AutoContinueButton({
  phase,
  seq,
  paused,
  clock,
  label = 'Continue',
  onContinue,
}: {
  phase: AutoPhase;
  seq: number;
  paused: Paused | null;
  clock: ClockOffset | null;
  label?: string;
  /** Sends the continue; true when the socket took it (a tap while reconnecting can be tried again). */
  onContinue: (seq: number) => boolean;
}) {
  const now = useServerNow(clock, 100);
  // One tap per phase: the room ignores a repeat anyway (rule 6), but the button should not look live.
  const [tappedSeq, setTappedSeq] = useState<number | null>(null);
  const frac = fillFraction(phase.fillFrom, phase.continueAt, now, paused);
  const left = timeLeft(phase.continueAt, now, paused);
  const filling = !paused && !phase.hostSpeaking && now >= phase.fillFrom;

  let status: string;
  if (paused) status = 'Paused.';
  else if (phase.hostSpeaking) status = 'Waiting for the narrator to finish.';
  else if (!filling) status = `On hold while you're busy: it starts filling in ${secondsShown(phase.fillFrom - now)} s.`;
  else status = `Continues by itself in ${secondsShown(left)} s.`;

  return (
    <div className="auto-continue">
      <button
        type="button"
        className="btn btn-primary btn-wide auto-continue-btn"
        data-testid="host-continue"
        data-hold-exempt=""
        data-filling={filling}
        disabled={tappedSeq === seq || paused !== null}
        onClick={() => {
          if (onContinue(seq)) setTappedSeq(seq);
        }}
        aria-describedby="auto-continue-status"
      >
        <span className="auto-continue-fill" style={{ transform: `scaleX(${frac})` }} aria-hidden="true" />
        <span className="auto-continue-label">{label}</span>
      </button>
      <p className="muted auto-continue-status" id="auto-continue-status" data-testid="auto-continue-status">
        {status}
      </p>
    </div>
  );
}
