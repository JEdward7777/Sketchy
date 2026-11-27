/**
 * Names for the drawing tools (stage 8.5), for labels and screen readers.
 * One per `PALETTE` entry and per `BRUSH_SIZES` entry;
 * test/unit/client/stroke-capture.test.ts checks the lengths match.
 */

export const PALETTE_LABELS = ['Eraser', 'Black', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Brown'] as const;

export const SIZE_LABELS = ['Fine', 'Medium', 'Bold'] as const;
