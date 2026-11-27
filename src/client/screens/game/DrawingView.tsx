/**
 * One evidence card's picture (stage 9.1, decision 0009): the artist's
 * stroke list painted with the shared `renderStrokes` into a canvas whose
 * backing store is the element's size in device pixels, so a drawing is
 * crisp at any size and density. It repaints only when the strokes or the
 * size change. While the drawing is still on its way it shows a
 * "developing" placeholder; a card holder with no drawing gets the
 * "Agent went dark" card (§7).
 */

import { useEffect, useRef } from 'react';
import type { Stroke } from '../../../shared/stroke-codec';
import { renderStrokes } from '../../../shared/stroke-render';
import { SpyIcon } from '../../components/SpyIcon';
import { backingSize, type CardContent } from '../../game/evidence-model';

function StrokeCanvas({ strokes, label }: { strokes: readonly Stroke[]; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // The observer fires once on observe and again on each resize, so each mount paints once.
    const ro = new ResizeObserver(() => {
      const { w, h } = backingSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      } else if (canvas.dataset.painted === 'true') return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderStrokes(ctx, strokes, w, h);
      canvas.dataset.painted = 'true';
    });
    canvas.dataset.painted = 'false';
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [strokes]);
  return <canvas ref={ref} className="evidence-canvas" role="img" aria-label={label} data-testid="evidence-canvas" data-strokes={strokes.length} />;
}

/** The 4:3 picture area of a card: a drawing, the loading placeholder, or the went-dark card. */
export function DrawingView({ content, artist }: { content: CardContent; artist: string }) {
  switch (content.kind) {
    case 'drawing':
      return <StrokeCanvas strokes={content.strokes} label={content.strokes.length > 0 ? `Drawing by ${artist}` : `Blank drawing by ${artist}`} />;
    case 'loading':
      return (
        <div className="evidence-blank evidence-loading" data-testid="evidence-loading" role="img" aria-label={`Drawing by ${artist}, still arriving`}>
          <span className="evidence-blank-text">Developing the film…</span>
        </div>
      );
    case 'dark':
      return (
        <div className="evidence-blank evidence-dark" data-testid="evidence-dark" role="img" aria-label={`Agent ${artist} went dark: no drawing`}>
          <span className="evidence-dark-icon" aria-hidden="true">
            <SpyIcon icon="sunglasses" size={56} />
          </span>
          <span className="evidence-dark-title">Agent went dark</span>
          <span className="evidence-blank-text">No drawing filed.</span>
        </div>
      );
  }
}
