/**
 * Drawing tools (stage 8.5, `SPEC.md` §9): the eight ink colors, three
 * brush sizes, the eraser (a stroke in the background color, 0009 item 1),
 * undo, clear behind a confirmation, and Done. Every control is at least
 * the `--tap` size.
 */

import { useEffect, useRef, useState } from 'react';
import { BRUSH_SIZES, PALETTE } from '../../../shared/stroke-format';
import { Button } from '../../components/ui';
import { INK_COLORS, type Tool } from '../../game/stroke-capture';
import { PALETTE_LABELS, SIZE_LABELS } from '../../game/tool-labels';

export function DrawTools({
  tool,
  onTool,
  canUndo,
  onUndo,
  onClear,
  onDone,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // After Keep or Shred, focus goes back to Clear (or Undo, Clear being disabled once shredded), not to the page.
  const clearRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !confirming) {
      const target = clearRef.current && !clearRef.current.disabled ? clearRef.current : undoRef.current;
      target?.focus();
    }
    wasConfirming.current = confirming;
  }, [confirming]);
  const maxSize = BRUSH_SIZES[BRUSH_SIZES.length - 1]!;

  if (confirming) {
    return (
      <div className="draw-tools draw-confirm" data-testid="clear-confirm" role="alertdialog" aria-label="Clear the drawing?">
        <p className="draw-confirm-text">Shred the whole drawing? There's no undo for this one.</p>
        <div className="row draw-confirm-row">
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(false);
              onClear();
            }}
            data-testid="clear-yes"
          >
            Shred it
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)} data-testid="clear-no" autoFocus>
            Keep it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="draw-tools" data-testid="draw-tools">
      <div className="swatches" role="radiogroup" aria-label="Ink color">
        {INK_COLORS.map((c) => {
          const on = !tool.eraser && tool.color === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={PALETTE_LABELS[c]}
              className="swatch"
              data-testid={`color-${c}`}
              style={{ background: PALETTE[c] }}
              onClick={() => onTool({ ...tool, eraser: false, color: c })}
            />
          );
        })}
      </div>
      <div className="row tool-row">
        <div className="sizes" role="radiogroup" aria-label="Brush size">
          {BRUSH_SIZES.map((px, i) => (
            <button
              key={px}
              type="button"
              role="radio"
              aria-checked={tool.size === i}
              aria-label={SIZE_LABELS[i]}
              className="size-btn"
              data-testid={`size-${i}`}
              onClick={() => onTool({ ...tool, size: i })}
            >
              <span className="size-dot" style={{ width: `${(px / maxSize) * 1.6 + 0.3}rem`, height: `${(px / maxSize) * 1.6 + 0.3}rem` }} />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tool-btn"
          aria-pressed={tool.eraser}
          data-testid="eraser"
          onClick={() => onTool({ ...tool, eraser: !tool.eraser })}
        >
          <EraserIcon /> Eraser
        </button>
      </div>
      <div className="row tool-row">
        <Button ref={undoRef} variant="ghost" onClick={onUndo} disabled={!canUndo} data-testid="undo">
          Undo
        </Button>
        <Button ref={clearRef} variant="ghost" onClick={() => setConfirming(true)} disabled={!canUndo} data-testid="clear">
          Clear
        </Button>
        <Button className="draw-done" onClick={onDone} data-testid="draw-done">
          Done
        </Button>
      </div>
    </div>
  );
}

function EraserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15.5 3.5l5 5-9.5 9.5H6l-3-3z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M10 9l5 5M6 18h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
