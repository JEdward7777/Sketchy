/**
 * "Save my drawing" (stage 10.7, decision 0009 item 6): pick a drawing
 * from this round (your own first), see it, and save it as a PNG made on
 * this device with the shared renderer (png-export.ts). Shares where the
 * browser can share files, downloads otherwise.
 *
 * The PNG is encoded when the drawing is picked, not on the tap: a share
 * sheet needs the tap's user activation, which an await on the encoder
 * would spend (Safari refuses `share()` after it).
 */

import { useEffect, useState } from 'react';
import type { PublicState } from '../../../shared/core/views';
import { Button, Panel } from '../../components/ui';
import { cardContent } from '../../game/evidence-model';
import { browserSaveDeps, drawingFileName, drawingPng, savePng, shareTitle, type ExportCanvas } from '../../game/png-export';
import type { Stroke } from '../../../shared/stroke-codec';
import type { RoomSnapshot } from '../../net/connection';
import { DrawingView } from './DrawingView';

/** Debounce before encoding a picked drawing. */
const ENCODE_DELAY_MS = 150;

type Status = 'idle' | 'working' | 'shared' | 'downloaded' | 'cancelled' | 'failed';

const STATUS_TEXT: Record<Status, string> = {
  idle: '',
  working: 'Developing the print…',
  shared: 'Sent. Frame it somewhere nice.',
  downloaded: 'Saved to your downloads.',
  cancelled: 'Share cancelled. Tap again any time.',
  failed: "This device couldn't develop that picture.",
};

export function SaveDrawing({ state, you, snap }: { state: PublicState; you: string; snap: RoomSnapshot }) {
  const round = state.round;
  const [picked, setPicked] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  // The encoded PNG for the strokes it was made from (an identity check, so a stale one is never saved).
  const [png, setPng] = useState<{ strokes: readonly Stroke[]; blob: Blob | null } | null>(null);
  const artists = round?.cards ? round.cards.filter((id) => cardContent(round, id, snap.drawings).kind === 'drawing') : [];
  const chosen = picked !== null && artists.includes(picked) ? picked : artists.includes(you) ? you : (artists[0] ?? null);
  const content = round && chosen !== null ? cardContent(round, chosen, snap.drawings) : null;
  const strokes = content?.kind === 'drawing' ? content.strokes : null;

  useEffect(() => {
    if (!strokes) return;
    let live = true;
    // A short wait first, so flicking through the picker encodes only the drawing it stops on.
    const t = window.setTimeout(() => {
      drawingPng(strokes, () => document.createElement('canvas') as unknown as ExportCanvas).then(
        (blob) => live && setPng({ strokes, blob }),
        () => live && setPng({ strokes, blob: null }),
      );
    }, ENCODE_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [strokes]);

  // Only cards whose strokes this device holds: a went-dark card has nothing to save.
  if (!round || chosen === null || !content) return null;
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? 'Unknown agent';
  const mine = chosen === you;
  const ready = png !== null && png.strokes === strokes ? png : null;

  const save = () => {
    if (!ready) return;
    if (!ready.blob) return setStatus('failed');
    // No await before savePng: it calls share() inside this tap.
    setStatus('working');
    savePng(ready.blob, drawingFileName(name(chosen), round.no), browserSaveDeps(), shareTitle(name(chosen), mine)).then(setStatus, () => setStatus('failed'));
  };

  return (
    <Panel title="Keep a souvenir" testId="save-drawing" className="save-drawing">
      <div className="save-drawing-body">
        <div className="save-drawing-preview" data-testid="save-preview" data-artist={chosen}>
          <DrawingView content={content} artist={name(chosen)} />
        </div>
        <div className="stack">
          {artists.length > 1 ? (
            <label className="field">
              Drawing
              <select className="input" data-testid="save-pick" value={chosen} onChange={(e) => {
                  setPicked(e.target.value);
                  setStatus('idle');
                }}>
                {artists.map((id) => (
                  <option key={id} value={id}>
                    {id === you ? `${name(id)} (you)` : name(id)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button variant="secondary" wide onClick={save} disabled={!ready || status === 'working'} data-testid="save-drawing-btn" data-ready={ready !== null}>
            {!ready ? 'Developing the print…' : mine ? 'Save my drawing' : `Save ${name(chosen)}'s drawing`}
          </Button>
          <p className="muted save-status" data-testid="save-status" data-status={status} aria-live="polite">
            {STATUS_TEXT[status]}
          </p>
        </div>
      </div>
    </Panel>
  );
}
