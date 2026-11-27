/**
 * The drawing canvas (stages 8.4, 8.6, `SPEC.md` §9, decision 0009): a
 * fixed 4:3 surface that takes pointer input into a `StrokeCapture` and
 * paints the capture's strokes with the shared `renderStrokes`, so what a
 * player sees is what every other phone will draw.
 *
 * - One pointer draws at a time; a second finger is ignored, so a palm or
 *   a pinch never adds a stray stroke.
 * - `touch-action: none` on the canvas (and the draw screen) plus
 *   non-passive touch listeners keep the page from scrolling or zooming
 *   while drawing (8.4); iOS's own `gesturestart` pinch is cancelled by
 *   the draw screen.
 * - Coalesced pointer events are read when the browser offers them, so a
 *   fast stroke keeps its shape.
 * - Painting happens at most once per animation frame, and repaints the
 *   whole list (the renderer is a pure function of the list), so undo and
 *   clear are exact.
 */

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { renderStrokes } from '../../../shared/stroke-render';
import { toGridPoint, type StrokeCapture, type Tool } from '../../game/stroke-capture';

export function DrawCanvas({
  capture,
  tool,
  version,
  onChange,
}: {
  capture: StrokeCapture;
  tool: Tool;
  /** The capture's version as last rendered by the parent; a change (undo, clear) repaints. */
  version: number;
  /** A stroke finished (or was cancelled into the list). */
  onChange: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useRef<number | null>(null);
  const pointer = useRef<{ id: number } | null>(null);

  const paint = useCallback(() => {
    frame.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;
    renderStrokes(ctx, capture.visible, canvas.width, canvas.height);
  }, [capture]);

  const schedule = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Backing store in device pixels, matched to the element's CSS size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      paint();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [paint]);

  useEffect(() => schedule(), [version, schedule]);

  // React attaches touch listeners as passive; these must be able to cancel scrolling on older iOS.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener('touchstart', stop, { passive: false });
    canvas.addEventListener('touchmove', stop, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', stop);
      canvas.removeEventListener('touchmove', stop);
    };
  }, []);

  const finish = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointer.current?.id !== e.pointerId) return;
    pointer.current = null;
    capture.end();
    schedule();
    onChange();
  };

  return (
    <canvas
      ref={canvasRef}
      className="draw-canvas"
      data-testid="draw-canvas"
      role="img"
      aria-label="Your drawing"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (pointer.current !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        pointer.current = { id: e.pointerId };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Without capture the stroke still ends on pointerup or pointercancel.
        }
        capture.begin(tool, toGridPoint(e.clientX, e.clientY, rect));
        schedule();
      }}
      onPointerMove={(e) => {
        const p = pointer.current;
        if (p?.id !== e.pointerId) return;
        // Read the rectangle on every move: a banner, a pause notice or a rotation can move the canvas mid-stroke.
        const rect = e.currentTarget.getBoundingClientRect();
        const native = e.nativeEvent;
        const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
        let added = false;
        for (const ev of events.length > 0 ? events : [native]) added = capture.extend(toGridPoint(ev.clientX, ev.clientY, rect)) || added;
        if (added) schedule();
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    />
  );
}
