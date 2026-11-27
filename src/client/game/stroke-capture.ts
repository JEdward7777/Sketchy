/**
 * Stroke capture for the draw screen (stage 8.6, decision 0009): pointer
 * positions become integer points on the shared `GRID_W × GRID_H` grid,
 * the eraser is a stroke in the background color, undo pops the last
 * stroke and clear empties the list. The list it holds is exactly what the
 * canvas shows (it is drawn by the shared `renderStrokes`) and exactly what
 * `draw:done` sends.
 *
 * Framework-free and DOM-free, so the unit leg drives it directly.
 */

import { encodeStrokes, type Point, type Stroke, type WireStroke } from '../../shared/stroke-codec';
import { BRUSH_SIZES, ERASER_COLOR, GRID_H, GRID_W, PALETTE } from '../../shared/stroke-format';
import { gridTransform } from '../../shared/stroke-render';
import { simplifyStroke } from '../../shared/stroke-simplify';

/** The screen rectangle the canvas occupies (a `DOMRect` fits). */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The grid point under a pointer at (`clientX`, `clientY`), using the same
 * fit-and-centre mapping as the renderer (`gridTransform`), so a stroke
 * lands where the finger was even if the element is not exactly 4:3.
 * Rounded to the nearest integer and clamped into the grid: a finger that
 * slides off the edge keeps drawing along it.
 */
export function toGridPoint(clientX: number, clientY: number, rect: Rect): Point {
  const { scale, offsetX, offsetY } = gridTransform(rect.width, rect.height);
  const gx = Math.round((clientX - rect.left - offsetX) / scale);
  const gy = Math.round((clientY - rect.top - offsetY) / scale);
  return [clamp(gx, 0, GRID_W - 1), clamp(gy, 0, GRID_H - 1)];
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

/** The selected tool: an ink color (index into `PALETTE`, never the eraser's) or the eraser, and a brush size. */
export interface Tool {
  readonly eraser: boolean;
  readonly color: number;
  readonly size: number;
}

/** Ink colors: every palette index except the background (0009 item 1). */
export const INK_COLORS: readonly number[] = PALETTE.map((_, i) => i).filter((i) => i !== ERASER_COLOR);

export const DEFAULT_TOOL: Tool = { eraser: false, color: INK_COLORS[0]!, size: 1 };

/** The stroke color a tool draws in: the eraser is the background color (0009 item 1). */
export function strokeColor(tool: Tool): number {
  return tool.eraser ? ERASER_COLOR : tool.color;
}

function validTool(tool: Tool): boolean {
  return Number.isInteger(tool.size) && tool.size >= 0 && tool.size < BRUSH_SIZES.length && INK_COLORS.includes(tool.color);
}

interface Active {
  readonly color: number;
  readonly size: number;
  readonly points: Point[];
}

export class StrokeCapture {
  private list: Stroke[];
  private active: Active | null = null;
  /** Bumps on every change, so the canvas knows to repaint. */
  version = 0;

  constructor(initial: readonly Stroke[] = []) {
    this.list = initial.slice();
  }

  /** Finished strokes, in drawing order. */
  get strokes(): readonly Stroke[] {
    return this.list;
  }

  get drawing(): boolean {
    return this.active !== null;
  }

  /** What the canvas shows: the finished strokes plus the one in progress. */
  get visible(): readonly Stroke[] {
    return this.active ? [...this.list, { color: this.active.color, size: this.active.size, points: this.active.points }] : this.list;
  }

  /** A finger (or pen, or mouse) went down: start a stroke with one point, which alone is a dot. */
  begin(tool: Tool, p: Point): void {
    if (!validTool(tool)) throw new RangeError('unknown tool');
    if (this.active) this.end();
    this.active = { color: strokeColor(tool), size: tool.size, points: [p] };
    this.version++;
  }

  /** The pointer moved. A point equal to the previous one adds nothing; returns whether it was added. */
  extend(p: Point): boolean {
    const a = this.active;
    if (!a) return false;
    const last = a.points[a.points.length - 1]!;
    if (last[0] === p[0] && last[1] === p[1]) return false;
    a.points.push(p);
    this.version++;
    return true;
  }

  /**
   * The pointer lifted (or was cancelled: what was drawn stays). The stroke
   * is simplified (`simplifyStroke`, which only drops points within half a
   * grid unit of the result, 0009 item 1) and appended.
   */
  end(): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.list = [...this.list, simplifyStroke({ color: a.color, size: a.size, points: a.points })];
    this.version++;
  }

  /** Undo: drops the stroke in progress if there is one, otherwise the last finished stroke. */
  undo(): void {
    if (this.active) this.active = null;
    else if (this.list.length > 0) this.list = this.list.slice(0, -1);
    else return;
    this.version++;
  }

  /** Clear: nothing left, nothing to undo (§9 puts it behind a confirmation). */
  clear(): void {
    if (!this.active && this.list.length === 0) return;
    this.active = null;
    this.list = [];
    this.version++;
  }

  /** The `draw:done` payload: the finished strokes, plus any stroke in progress (a timeout mid-stroke keeps it). */
  wire(): WireStroke[] {
    this.end();
    return encodeStrokes(this.list);
  }
}
