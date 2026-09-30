/** Wiring of the settings controller to the mixer and to page visibility. */

import type { Mixer } from '../mixer/index.ts';
import { BUS_IDS, type AudioSettings, type SettingsController } from '../types.ts';

/** The mixer surface the bindings need. */
export type SettingsMixer = Pick<Mixer, 'setVolume' | 'setMuted'>;

/** Applies all volumes and the user mute of `s` to the mixer. */
export function applySettingsToMixer(s: Readonly<AudioSettings>, mixer: SettingsMixer, immediate = false): void {
  for (const b of BUS_IDS) mixer.setVolume(b, s[b], immediate);
  mixer.setMuted(s.muted, 'user', immediate);
}

/**
 * Applies the current settings immediately (no ramp: nothing plays yet) and every later change
 * with ramps. Returns the unbind function.
 */
export function bindSettingsToMixer(controller: SettingsController, mixer: SettingsMixer): () => void {
  applySettingsToMixer(controller.get(), mixer, true);
  return controller.subscribe((s) => applySettingsToMixer(s, mixer, false));
}

/** The part of `Document` used by {@link attachVisibilityMute}. */
export interface VisibilityDocument {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Mutes the output (mute source 'hidden', ramped) while the document is hidden and the setting
 * `muteWhenHidden` is on; unmutes when it becomes visible again (a user mute stays in force,
 * it is a separate mute source). Also reacts to toggling `muteWhenHidden` while hidden.
 * Returns the detach function (removes the listener and lifts the 'hidden' mute).
 */
export function attachVisibilityMute(
  doc: VisibilityDocument,
  controller: SettingsController,
  mixer: Pick<Mixer, 'setMuted'>,
): () => void {
  const apply = (): void => {
    mixer.setMuted(doc.visibilityState === 'hidden' && controller.get().muteWhenHidden, 'hidden');
  };
  doc.addEventListener('visibilitychange', apply);
  const unsubscribe = controller.subscribe(apply);
  apply();
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    doc.removeEventListener('visibilitychange', apply);
    unsubscribe();
    mixer.setMuted(false, 'hidden');
  };
}
