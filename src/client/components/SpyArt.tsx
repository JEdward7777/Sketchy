/**
 * Spy motifs for the art pass (stage 12.3, `SPEC.md` §12): fingerprints,
 * a magnifying glass, a disguise, a wax seal, a sealed envelope and the
 * landing's dossier. Original inline SVG, no external assets. Colors come
 * from classes in art.css (theme tokens), so both themes work; every piece
 * is decoration and hidden from screen readers.
 */

import type { ReactNode } from 'react';

function Art({ viewBox, className, children }: { viewBox: string; className?: string; children: ReactNode }) {
  return (
    <svg className={['art', className ?? ''].filter(Boolean).join(' ')} viewBox={viewBox} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Ridges of a fingerprint, open arcs on a 64-unit grid, in `currentColor`. */
export const FINGERPRINT_RIDGES = (
  <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M17 13a26 26 0 0 1 30 0" />
    <path d="M11 39c-1-2-1-4-1-7a22 22 0 0 1 44 0c0 2 0 4-1 6" />
    <path d="M19 51c-3-5-4-11-4-17a17 17 0 0 1 34 0c0 5-1 9-2 13" />
    <path d="M26 56c-3-6-4-12-4-20a10 10 0 0 1 20 0c0 7-1 13-3 18" />
    <path d="M33 58c-2-7-3-14-3-22a2.5 2.5 0 0 1 5 0c0 7-1 14-2 19" />
  </g>
);

export function Fingerprint({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 64 64" className={className}>
      {FINGERPRINT_RIDGES}
    </Art>
  );
}

export function Magnifier({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 64 64" className={className}>
      <path className="art-handle" d="M41 41 57 57" strokeWidth="9" strokeLinecap="round" />
      <circle className="art-lens" cx="27" cy="27" r="18" strokeWidth="5" />
      <path className="art-glint" d="M17 24a11 11 0 0 1 8-9" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </Art>
  );
}

/** Glasses, nose and mustache: the classic disguise (§12). */
export function Disguise({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 120 72" className={className}>
      <g className="art-ink-stroke" fill="none" strokeWidth="5" strokeLinecap="round">
        <path d="M14 14c6-5 16-6 24-2M82 12c8-4 18-3 24 2" />
        <path d="M50 30c3-3 17-3 20 0" />
      </g>
      <circle className="art-glass" cx="34" cy="32" r="15" strokeWidth="5" />
      <circle className="art-glass" cx="86" cy="32" r="15" strokeWidth="5" />
      <path className="art-nose" d="M60 30c-5 9-9 16-9 22 0 4 4 6 9 6s9-2 9-6c0-6-4-13-9-22z" strokeWidth="4" />
      <path
        className="art-mustache"
        d="M60 59c-4-5-12-7-19-3-5 3-9 3-13 0 2 9 12 13 21 10 5-2 9-4 11-6 2 2 6 4 11 6 9 3 19-1 21-10-4 3-8 3-13 0-7-4-15-2-19 3z"
      />
    </Art>
  );
}

/** A red wax seal pressed with a fingerprint. */
export function WaxSeal({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 64 64" className={className}>
      <path
        className="art-wax"
        d="M32 2l6 4 7-1 4 6 7 2 1 7 5 5-2 7 2 7-5 5-1 7-7 2-4 6-7-1-6 4-6-4-7 1-4-6-7-2-1-7-5-5 2-7-2-7 5-5 1-7 7-2 4-6 7 1z"
      />
      <circle className="art-wax-ring" cx="32" cy="32" r="20" strokeWidth="2.5" fill="none" />
      <g transform="translate(19 19) scale(0.41)" className="art-wax-print">
        {FINGERPRINT_RIDGES}
      </g>
    </Art>
  );
}

/** A sealed manila envelope with its stamp: the display's briefing (it holds nothing; displays never get a briefing). */
export function SealedEnvelope({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 240 160" className={className}>
      <rect className="art-env-back" x="4" y="4" width="232" height="152" rx="12" strokeWidth="5" />
      <path className="art-env-pocket" d="M6 52 120 112 234 52V144a10 10 0 0 1-10 10H16A10 10 0 0 1 6 144z" />
      <path className="art-env-flap" d="M8 8h224L120 98z" strokeWidth="4" strokeLinejoin="round" />
      <g transform="translate(100 70) scale(0.625)">
        <path
          className="art-wax"
          d="M32 2l6 4 7-1 4 6 7 2 1 7 5 5-2 7 2 7-5 5-1 7-7 2-4 6-7-1-6 4-6-4-7 1-4-6-7-2-1-7-5-5 2-7-2-7 5-5 1-7 7-2 4-6 7 1z"
        />
        <g transform="translate(19 19) scale(0.41)" className="art-wax-print">
          {FINGERPRINT_RIDGES}
        </g>
      </g>
      <g transform="rotate(-7 120 132)">
        <rect className="art-stamp-box" x="62" y="114" width="116" height="30" rx="4" strokeWidth="4" />
        <text className="art-stamp-text" x="120" y="136" textAnchor="middle" textLength="100" lengthAdjust="spacingAndGlyphs">
          TOP SECRET
        </text>
      </g>
    </Art>
  );
}

/** The landing's dossier: a folder with a stamped file, a fingerprint, and a magnifier over it. */
export function DossierHero({ className }: { className?: string }) {
  return (
    <Art viewBox="0 0 320 170" className={className}>
      <path className="art-folder-back" d="M40 30h70l12 12h138a10 10 0 0 1 10 10v100a10 10 0 0 1-10 10H40a10 10 0 0 1-10-10V40a10 10 0 0 1 10-10z" strokeWidth="5" />
      <rect className="art-paper" x="52" y="20" width="190" height="120" rx="6" strokeWidth="4" transform="rotate(-4 147 80)" />
      <g className="art-paper-lines" strokeWidth="4" strokeLinecap="round" transform="rotate(-4 147 80)">
        <path d="M70 46h90M70 62h120M70 78h70" />
      </g>
      <g transform="rotate(-10 120 104)">
        <rect className="art-stamp-box" x="70" y="88" width="104" height="30" rx="4" strokeWidth="4" />
        <text className="art-stamp-text" x="122" y="110" textAnchor="middle" textLength="90" lengthAdjust="spacingAndGlyphs">
          CLASSIFIED
        </text>
      </g>
      <path className="art-folder-front" d="M30 70h250a8 8 0 0 1 8 9l-8 74a10 10 0 0 1-10 9H40a10 10 0 0 1-10-10z" strokeWidth="5" />
      <g className="art-print-on-folder" transform="translate(56 92) scale(0.9)">
        {FINGERPRINT_RIDGES}
      </g>
      <g transform="translate(196 58) rotate(8 40 40)">
        <path className="art-handle" d="M62 62 92 92" strokeWidth="13" strokeLinecap="round" />
        <circle className="art-lens" cx="40" cy="40" r="30" strokeWidth="7" />
        <path className="art-glint" d="M24 36a18 18 0 0 1 13-14" strokeWidth="5" strokeLinecap="round" fill="none" />
      </g>
    </Art>
  );
}

/** The short-landscape room tools button's glyph: a briefcase (stage 12.3, O-18/O-20). */
export function ToolsGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18M12 11v3" />
    </svg>
  );
}
