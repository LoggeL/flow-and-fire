import { EventType } from '@faf/protocol';
import { alertKindIndex } from '@faf/audio';

/** Adapter-only type for UnitDeath's commander flag; no fabricated simulation event. */
export const COMMANDER_DEATH_AUDIO_TYPE = 0xfffe;
/** Audio adapter index. The sim's StorageFull aux remains the authoritative overflow amount. */
export const STORAGE_FULL_ALERT_INDEX = alertKindIndex('alt_storage_full');
export const GAME_AUDIO_EVENT_TYPES: Readonly<Record<number, string>> = Object.freeze({
  [EventType.Shot]: 'weaponFire',
  [EventType.Impact]: 'projectileImpact',
  [EventType.UnitDeath]: 'unitDeath',
  [EventType.BuildComplete]: 'buildComplete',
  [EventType.MassStall]: 'massStall',
  [EventType.EnergyStall]: 'energyStall',
  [EventType.StorageFull]: 'alert',
  [COMMANDER_DEATH_AUDIO_TYPE]: 'commanderDeath',
});
