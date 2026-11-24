/**
 * The one stroke renderer every phone and the big screen use (stage 2.11,
 * decision 0009 item 2), written against `DrawContext`, a minimal slice of
 * the Canvas 2D API declared here so src/shared needs no DOM types. A
 * browser `CanvasRenderingContext2D` satisfies it (the type check lives in
 * test/unit/stroke-render.test.ts, which compiles with the DOM library).
 *
 * `renderStrokes` always repaints the whole target: it fills the background,
 * then draws every stroke in list order. The picture is therefore a function
 * of the stroke list and target size alone, with no state carried between
 * calls, so undo (`undoStroke`) and clear (`clearStrokes`) in
 * src/shared/stroke-codec.ts are reflected exactly by rendering the new list.
 *
 * The 4:3 grid is scaled uniformly to fit the target and centred; any spare
 * margin (a target that is not 4:3) is background. Round caps and joins
 * extend up to half a brush width past the grid edge, so after the strokes
 * the margin bands are filled with the background again; ink therefore never
 * shows outside the grid's rectangle.
 */

import type { Stroke } from './stroke-codec';
import { BACKGROUND_COLOR, BRUSH_SIZES, GRID_H, GRID_W, PALETTE } from './stroke-format';

/**
 * The Canvas 2D members the renderer uses. Style properties are typed
 * `unknown` so the DOM's wider types (gradients, patterns, string unions)
 * are assignable; the renderer only ever writes strings and numbers.
 */
export interface DrawContext {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: unknown;
  lineJoin: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  stroke(): void;
  fill(): void;
}

/** How grid coordinates map onto a target of `width × height` pixels. */
export interface GridTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function gridTransform(width: number, height: number): GridTransform {
  if (!(width > 0) || !(height > 0)) throw new RangeError(`render target must be positive, got ${width}×${height}`);
  const scale = Math.min(width / GRID_W, height / GRID_H);
  return { scale, offsetX: (width - GRID_W * scale) / 2, offsetY: (height - GRID_H * scale) / 2 };
}

/**
 * Paint `strokes` onto `ctx`, a target of `width × height` pixels. Strokes
 * are assumed valid (decoded by `decodeStrokes`). A stroke whose points are
 * all the same point (a tap: one point, or duplicates the grid quantization
 * and `simplifyPoints` keep) is a filled dot of the brush's diameter, because
 * canvases following the HTML spec prune zero-length subpaths and would
 * stroke nothing. Any other stroke is a round-capped, round-joined polyline.
 */
export function renderStrokes(ctx: DrawContext, strokes: readonly Stroke[], width: number, height: number): void {
  const { scale, offsetX, offsetY } = gridTransform(width, height);
  const X = (x: number) => offsetX + x * scale;
  const Y = (y: number) => offsetY + y * scale;

  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const s of strokes) {
    const color = PALETTE[s.color]!;
    const widthPx = BRUSH_SIZES[s.size]! * scale;
    const [first, ...rest] = s.points;
    if (first === undefined) continue;
    if (rest.every(([x, y]) => x === first[0] && y === first[1])) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X(first[0]), Y(first[1]), widthPx / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx;
    ctx.beginPath();
    ctx.moveTo(X(first[0]), Y(first[1]));
    for (const [x, y] of rest) ctx.lineTo(X(x), Y(y));
    ctx.stroke();
  }

  // Repaint the letterbox margins that strokes may have spilled into. A 4:3
  // target has none, and gets no extra calls.
  if (offsetX > 0 || offsetY > 0) ctx.fillStyle = BACKGROUND_COLOR;
  if (offsetX > 0) {
    ctx.fillRect(0, 0, offsetX, height);
    ctx.fillRect(width - offsetX, 0, offsetX, height);
  }
  if (offsetY > 0) {
    ctx.fillRect(0, 0, width, offsetY);
    ctx.fillRect(0, height - offsetY, width, offsetY);
  }
}
