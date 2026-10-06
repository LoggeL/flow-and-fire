import type { JSX } from 'preact';

/**
 * Emblem of the main menu: the Lot (drop, tip down) inside a cast ring with an ember seam, own drawing
 * (port of FF.emblem). Decorative; gradient ids are prefixed so they do not clash with other SVGs.
 */
export function Emblem(): JSX.Element {
  return (
    <div class="emblem" aria-hidden="true" data-component="Emblem" data-testid="emblem">
      <svg viewBox="0 0 400 400" focusable="false">
        <defs>
          <radialGradient id="ffm-emblem-glow" cx="50%" cy="58%" r="50%">
            <stop offset="0" stop-color="#ffd9a0" />
            <stop offset=".35" stop-color="#ff8a2a" />
            <stop offset="1" stop-color="#6a2a08" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="ffm-emblem-iron" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#3b3632" />
            <stop offset="1" stop-color="#151311" />
          </linearGradient>
          <linearGradient id="ffm-emblem-cu" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#d4955f" />
            <stop offset=".6" stop-color="#b06a3b" />
            <stop offset="1" stop-color="#4f8c7a" />
          </linearGradient>
        </defs>
        <circle cx="200" cy="215" r="150" fill="url(#ffm-emblem-glow)" opacity=".35" />
        <path d="M200 30 L352 118 V282 L200 370 L48 282 V118 Z" fill="none" stroke="#2e2b29" stroke-width="22" />
        <path d="M200 30 L352 118 V282 L200 370 L48 282 V118 Z" fill="none" stroke="url(#ffm-emblem-cu)" stroke-width="3" opacity=".8" />
        <circle cx="200" cy="200" r="118" fill="none" stroke="url(#ffm-emblem-iron)" stroke-width="26" />
        <circle cx="200" cy="200" r="118" fill="none" stroke="#ff8a2a" stroke-width="2" stroke-dasharray="3 14" opacity=".75" />
        <path d="M200 318 L138 238 A76 76 0 1 1 262 238 Z" fill="url(#ffm-emblem-iron)" stroke="#0e0d0c" stroke-width="6" stroke-linejoin="round" />
        <path d="M200 300 L152 238 A60 60 0 0 1 176 150" fill="none" stroke="#4e4741" stroke-width="3" />
        <path d="M200 262 v-70" stroke="#ffd9a0" stroke-width="6" stroke-linecap="round" />
        <path d="M200 262 v-70" stroke="#ff8a2a" stroke-width="14" stroke-linecap="round" opacity=".35" />
        <circle cx="200" cy="170" r="12" fill="#ffd9a0" />
        <circle cx="200" cy="170" r="26" fill="#ff8a2a" opacity=".25" />
      </svg>
    </div>
  );
}
