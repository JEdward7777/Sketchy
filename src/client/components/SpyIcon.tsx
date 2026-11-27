/**
 * The eight spy icons (`SPY_ICONS`, `SPEC.md` §2) as original inline SVG:
 * simple strokes on a 24-unit grid in `currentColor`, so a chip colors them.
 * Placeholder-grade line art; the illustrated set is phase 12.
 */

import type { ReactElement } from 'react';
import { SPY_ICONS, type SpyIcon as SpyIconId } from '../../shared/core/rules';

export const SPY_ICON_LABELS: Readonly<Record<SpyIconId, string>> = {
  fedora: 'Fedora',
  sunglasses: 'Sunglasses',
  magnifier: 'Magnifier',
  mustache: 'Mustache',
  trenchcoat: 'Trench coat',
  briefcase: 'Briefcase',
  binoculars: 'Binoculars',
  fingerprint: 'Fingerprint',
};

const SHAPES: Readonly<Record<SpyIconId, ReactElement>> = {
  fedora: (
    <>
      <path d="M2 16.5c4 2.5 16 2.5 20 0" />
      <path d="M5.5 15.5 7.2 7.5c.3-1.3 2.6-1.2 4.8.2 2.2-1.4 4.5-1.5 4.8-.2l1.7 8" />
      <path d="M6.3 12.5h11.4" />
    </>
  ),
  sunglasses: (
    <>
      <path d="M2 9h20" />
      <path d="M3.5 9h7v3a3.5 3.5 0 0 1-7 0z" fill="currentColor" />
      <path d="M13.5 9h7v3a3.5 3.5 0 0 1-7 0z" fill="currentColor" />
    </>
  ),
  magnifier: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="M14.5 14.5 21 21" strokeWidth="3" />
    </>
  ),
  mustache: (
    <path
      d="M12 11c-1.5-2-4.5-2.5-6.5-.5C4.5 11.5 3 12 2 11c.5 3 4 4.5 7 3 1.3-.6 2.3-1.3 3-2 .7.7 1.7 1.4 3 2 3 1.5 6.5 0 7-3-1 1-2.5.5-3.5-.5-2-2-5-1.5-6.5.5z"
      fill="currentColor"
    />
  ),
  trenchcoat: (
    <>
      <path d="M8 3 4 7v14h16V7l-4-4" />
      <path d="m8 3 4 5 4-5" />
      <path d="M12 8v13M4 14h16" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18" />
    </>
  ),
  binoculars: (
    <>
      <circle cx="6.5" cy="16" r="4" />
      <circle cx="17.5" cy="16" r="4" />
      <path d="M4 12.5 5.5 5h3.5l1 7.5M20 12.5 18.5 5H15l-1 7.5M10 13h4" />
    </>
  ),
  fingerprint: (
    <>
      <path d="M5 12a7 7 0 0 1 14 0v1.5" />
      <path d="M8.5 20c.7-1.5 1-3 1-5v-3a2.5 2.5 0 0 1 5 0v2.5c0 2.3-.4 4.3-1.2 6" />
      <path d="M5 15.5c0 1.6.3 3 .9 4.3M18.8 16.5c-.1 1.2-.3 2.3-.7 3.3" />
    </>
  ),
};

function isSpyIcon(icon: string): icon is SpyIconId {
  return (SPY_ICONS as readonly string[]).includes(icon);
}

export function spyIconLabel(icon: string): string {
  return isSpyIcon(icon) ? SPY_ICON_LABELS[icon] : 'Agent';
}

export function SpyIcon({ icon, size = 24, title }: { icon: string; size?: number; title?: string }) {
  const shape = isSpyIcon(icon) ? SHAPES[icon] : <circle cx="12" cy="12" r="7" />;
  return (
    <svg
      className="spy-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {shape}
    </svg>
  );
}
