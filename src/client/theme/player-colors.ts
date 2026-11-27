/**
 * Player color ids (`PLAYER_COLORS`, src/shared/core/rules.ts) to theme
 * tokens. The hex values live in tokens.css (stage 4.9.1) so dark mode or
 * the phase-12 art pass can retune them in one place.
 */

import { PLAYER_COLORS, type PlayerColor } from '../../shared/core/rules';

export const PLAYER_COLOR_LABELS: Readonly<Record<PlayerColor, string>> = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', lime: 'Lime', green: 'Green', teal: 'Teal',
  sky: 'Sky', blue: 'Blue', purple: 'Purple', pink: 'Pink', brown: 'Brown', slate: 'Slate',
};

export function isPlayerColor(color: string): color is PlayerColor {
  return (PLAYER_COLORS as readonly string[]).includes(color);
}

/** The CSS custom property for a color id; unknown ids fall back to the offline grey. */
export function playerColorVar(color: string): string {
  return isPlayerColor(color) ? `var(--player-${color})` : 'var(--offline)';
}

export function playerColorLabel(color: string): string {
  return isPlayerColor(color) ? PLAYER_COLOR_LABELS[color] : color;
}
