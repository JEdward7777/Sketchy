import { describe, expect, it, vi } from 'vitest';
import { EXPORT_WIDTH, drawingFileName, drawingPng, exportSize, savePng, shareTitle, type ExportCanvas, type SaveDeps } from '../../../src/client/game/png-export';
import type { Stroke } from '../../../src/shared/stroke-codec';
import { BACKGROUND_COLOR, GRID_H, GRID_W } from '../../../src/shared/stroke-format';

/** A canvas that records what the shared renderer does to it and "encodes" a blob. */
function fakeCanvas(opts: { ctx?: boolean; blob?: boolean } = {}) {
  const calls: string[] = [];
  const ctx = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 0,
    lineCap: '' as unknown,
    lineJoin: '' as unknown,
    fillRect: (x: number, y: number, w: number, h: number) => calls.push(`fillRect ${x},${y},${w},${h} ${String(ctx.fillStyle)}`),
    beginPath: () => calls.push('beginPath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    arc: () => calls.push('arc'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
  };
  const canvas: ExportCanvas & { type?: string } = {
    width: 0,
    height: 0,
    getContext: () => (opts.ctx === false ? null : ctx),
    toBlob(cb, type) {
      canvas.type = type;
      cb(opts.blob === false ? null : new Blob(['png'], { type }));
    },
  };
  return { canvas, calls };
}

const LINE: Stroke = { color: 0, size: 1, points: [[10, 10], [200, 150]] };

describe('Save my drawing: PNG export (10.7)', () => {
  it('exports at 4:3, the grid aspect', () => {
    expect(exportSize()).toEqual({ w: EXPORT_WIDTH, h: Math.round((EXPORT_WIDTH * GRID_H) / GRID_W) });
    expect(exportSize(400).w / exportSize(400).h).toBeCloseTo(GRID_W / GRID_H, 2);
  });

  it('paints with the shared renderer at export size and encodes image/png', async () => {
    const { canvas, calls } = fakeCanvas();
    let sizeAtEncode: number[] = [];
    const encode = canvas.toBlob.bind(canvas);
    canvas.toBlob = (cb, type) => {
      sizeAtEncode = [canvas.width, canvas.height];
      encode(cb, type);
    };
    const blob = await drawingPng([LINE], () => canvas);
    const { w, h } = exportSize();
    expect(sizeAtEncode).toEqual([w, h]);
    // The backing store is freed once encoded (mobile canvas memory caps).
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
    expect(calls[0]).toBe(`fillRect 0,0,${w},${h} ${BACKGROUND_COLOR}`);
    expect(calls).toContain('stroke');
    expect(canvas.type).toBe('image/png');
    expect(blob.type).toBe('image/png');
  });

  it('a blank drawing is the background alone', async () => {
    const { canvas, calls } = fakeCanvas();
    await drawingPng([], () => canvas, 400);
    expect(calls).toEqual([`fillRect 0,0,400,300 ${BACKGROUND_COLOR}`]);
  });

  it('rejects without a 2D context or when encoding fails', async () => {
    await expect(drawingPng([LINE], () => fakeCanvas({ ctx: false }).canvas)).rejects.toThrow();
    await expect(drawingPng([LINE], () => fakeCanvas({ blob: false }).canvas)).rejects.toThrow();
  });

  it('names the file after the artist and round, filename-safe', () => {
    expect(drawingFileName('Ava', 3)).toBe('sketchy-ava-round-3.png');
    expect(drawingFileName('Dee Longfellow-Smith', 12)).toBe('sketchy-dee-longfellow-smith-round-12.png');
    expect(drawingFileName('Zoë / Q*', 1)).toBe('sketchy-zoe-q-round-1.png');
    expect(drawingFileName('🕵️', 1)).toBe('sketchy-agent-round-1.png');
  });
});

describe('Save my drawing: share or download (10.7)', () => {
  const blob = new Blob(['png'], { type: 'image/png' });
  const base = (over: Partial<SaveDeps> = {}): SaveDeps & { download: ReturnType<typeof vi.fn> } => ({
    makeFile: (b, n) => new File([b], n, { type: 'image/png' }),
    download: vi.fn(),
    ...over,
  }) as SaveDeps & { download: ReturnType<typeof vi.fn> };

  it('downloads when the browser has no Web Share', async () => {
    const deps = base();
    expect(await savePng(blob, 'x.png', deps)).toBe('downloaded');
    expect(deps.download).toHaveBeenCalledWith(blob, 'x.png');
  });

  it('downloads when the browser cannot share files', async () => {
    const share = vi.fn(async () => {});
    const deps = base({ share, canShare: () => false });
    expect(await savePng(blob, 'x.png', deps)).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
  });

  it('shares the file where it can, and does not also download', async () => {
    const share = vi.fn(async (_: { files: File[]; title?: string }) => {});
    const deps = base({ share, canShare: () => true });
    const done = savePng(blob, 'x.png', deps, shareTitle('Bea', false));
    // share() is called synchronously inside the tap, before savePng awaits anything (user activation).
    expect(share).toHaveBeenCalledTimes(1);
    expect(await done).toBe('shared');
    expect(share.mock.calls[0]![0].files[0]!.name).toBe('x.png');
    expect(share.mock.calls[0]![0].title).toBe("Bea's Sketchy drawing");
    expect(shareTitle('Bea', true)).toBe('My Sketchy drawing');
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('a dismissed share is no error and no download; a failed one falls back to the download', async () => {
    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' });
    const d1 = base({ share: async () => Promise.reject(abort), canShare: () => true });
    expect(await savePng(blob, 'x.png', d1)).toBe('cancelled');
    expect(d1.download).not.toHaveBeenCalled();
    const d2 = base({ share: async () => Promise.reject(new Error('NotAllowedError')), canShare: () => true });
    expect(await savePng(blob, 'x.png', d2)).toBe('downloaded');
    const d3 = base({ share: async () => {}, canShare: () => { throw new TypeError('bad'); } });
    expect(await savePng(blob, 'x.png', d3)).toBe('downloaded');
  });
});
