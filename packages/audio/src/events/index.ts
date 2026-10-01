/**
 * @faf/audio/events — sim event kinds, the event→sound map (data + parser + lookups), the
 * client-driven and deferred sound lists, and map validation against a manifest.
 */

import defaultEventMapJson from './default-event-map.json' with { type: 'json' };
import { parseEventSoundMap, type EventSoundMap } from './sound-map.ts';

export * from './kinds.ts';
export * from './sound-map.ts';
export * from './client-sounds.ts';
export * from './validate.ts';

/** The raw default map (JSON data, e.g. to pass as `CreateAudioEngineOptions.eventMap`). */
export const DEFAULT_EVENT_MAP_JSON: unknown = defaultEventMapJson;

/** The parsed and normalized default map. */
export const DEFAULT_EVENT_SOUND_MAP: EventSoundMap = parseEventSoundMap(defaultEventMapJson);
