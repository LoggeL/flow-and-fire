import { effect } from '@preact/signals';
import type { HudModel } from '../model/index.ts';
import type { MotionSetting } from '../model/menus/settings.ts';
import type { TeamColorMode } from '../model/menus/skirmish.ts';

/** Root-level UI settings (ui.md §4.1 scale, §8.2 team colours, §8.4 reduced motion). */
export interface UiSettings {
  readonly scale: number;
  readonly teams: TeamColorMode;
  readonly reducedMotion: MotionSetting;
}

export const UI_SCALES: readonly number[] = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

/** Auto scale: round₀.₀₅((height / 1080)^0.78), clamped to 0.8–1.5 → 1.0 at 1080p, 1.25 at 1440p. */
export function autoScale(windowHeight: number): number {
  const s = (windowHeight / 1080) ** 0.78;
  return Math.min(1.5, Math.max(0.8, Math.round(s * 20) / 20));
}

/**
 * Applies the settings to the document root: html font-size = 16 px × scale (plus --ui-scale for
 * tokens.css), data-teams, and data-motion ("reduce" = on, "full" = off, absent = follow the system).
 */
export function applyUiSettings(root: HTMLElement, settings: Partial<UiSettings>): void {
  if (settings.scale !== undefined) {
    root.style.setProperty('--ui-scale', String(settings.scale));
    root.style.fontSize = `${16 * settings.scale}px`;
    root.dataset['scale'] = String(settings.scale);
  }
  if (settings.teams !== undefined) root.dataset['teams'] = settings.teams;
  if (settings.reducedMotion !== undefined) {
    if (settings.reducedMotion === 'on') root.dataset['motion'] = 'reduce';
    else if (settings.reducedMotion === 'off') root.dataset['motion'] = 'full';
    else delete root.dataset['motion'];
  }
}

/** Keeps the root in sync with the model's scale/teams/reducedMotion signals; returns the disposer. */
export function bindUiSettings(root: HTMLElement, model: Pick<HudModel, 'scale' | 'teams' | 'reducedMotion'>): () => void {
  return effect(() => {
    applyUiSettings(root, { scale: model.scale.value, teams: model.teams.value, reducedMotion: model.reducedMotion.value });
  });
}
