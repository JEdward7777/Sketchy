/**
 * "Save my drawing" (stage 10.7, decision 0009 item 6): a drawing's
 * strokes painted by the shared `renderStrokes` into an offscreen canvas,
 * encoded as PNG on the player's own device, then shared (Web Share API
 * with a file, where the browser can) or downloaded. Nothing goes to the
 * server. The browser pieces are injected, so the unit leg drives every
 * branch without a DOM.
 */

import type { Stroke } from '../../shared/stroke-codec';
import { renderStrokes, type DrawContext } from '../../shared/stroke-render';
import { GRID_H, GRID_W } from '../../shared/stroke-format';

/** The exported picture's width in pixels; the height keeps the grid's 4:3. Big enough to print, small enough to share. */
export const EXPORT_WIDTH = 1600;

export function exportSize(width = EXPORT_WIDTH): { w: number; h: number } {
  return { w: width, h: Math.round((width * GRID_H) / GRID_W) };
}

/** `sketchy-ava-round-3.png`: the artist's name made filename-safe, never empty. */
export function drawingFileName(artist: string, roundNo: number): string {
  const slug = artist
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `sketchy-${slug || 'agent'}-round-${roundNo}.png`;
}

/** The slice of a canvas the export needs; `HTMLCanvasElement` satisfies it. */
export interface ExportCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): DrawContext | null;
  toBlob(cb: (blob: Blob | null) => void, type: string): void;
}

/** Paint `strokes` at export size and encode a PNG. Rejects when the device cannot (no 2D context, encoder failure). */
export function drawingPng(strokes: readonly Stroke[], makeCanvas: () => ExportCanvas, width = EXPORT_WIDTH): Promise<Blob> {
  const { w, h } = exportSize(width);
  const canvas = makeCanvas();
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no 2d context'));
  renderStrokes(ctx, strokes, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // Free the backing store now (about w × h × 4 bytes): mobile browsers cap total canvas memory.
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
}

/** How the file leaves the app. */
export interface SaveDeps {
  /** `navigator.canShare`, if the browser has it. */
  readonly canShare?: ((data: { files: File[] }) => boolean) | undefined;
  /** `navigator.share`, if the browser has it. */
  readonly share?: ((data: { files: File[]; title?: string }) => Promise<void>) | undefined;
  readonly makeFile: (blob: Blob, name: string) => File;
  /** Starts a download of `blob` as `name` (an `<a download>` click). */
  readonly download: (blob: Blob, name: string) => void;
}

export type SaveOutcome = 'shared' | 'downloaded' | 'cancelled';

/** The share sheet's title: "My Sketchy drawing", or "Bea's Sketchy drawing". */
export function shareTitle(artist: string, mine: boolean): string {
  return mine ? 'My Sketchy drawing' : `${artist}'s Sketchy drawing`;
}

/**
 * Share the PNG where the browser can share files (phones: straight to
 * Photos or a chat), otherwise download it. A share the player dismisses
 * is not an error; a share that fails for any other reason falls back to
 * the download, so the player always gets the file.
 *
 * `share()` needs the tap's user activation, so it is called before this
 * function first awaits anything: the caller must pass a blob already
 * made (SaveDrawing encodes it when the drawing is picked, not on the tap).
 */
export async function savePng(blob: Blob, name: string, deps: SaveDeps, title = 'My Sketchy drawing'): Promise<SaveOutcome> {
  if (deps.share && deps.canShare) {
    const file = deps.makeFile(blob, name);
    let shareable = false;
    try {
      shareable = deps.canShare({ files: [file] });
    } catch {
      shareable = false;
    }
    if (shareable) {
      try {
        await deps.share({ files: [file], title });
        return 'shared';
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      }
    }
  }
  deps.download(blob, name);
  return 'downloaded';
}

/** The browser's share and download, for the screen. */
export function browserSaveDeps(): SaveDeps {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    canShare: nav?.canShare ? (d) => nav.canShare(d) : undefined,
    share: nav?.share ? (d) => nav.share(d) : undefined,
    makeFile: (blob, name) => new File([blob], name, { type: 'image/png' }),
    download: (blob, name) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked later, not at once: some browsers start reading the URL only after the click returns.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  };
}
