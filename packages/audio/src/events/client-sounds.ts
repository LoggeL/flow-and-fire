/**
 * Sounds that are NOT triggered by sim events: they come from the client through the engine API
 * (`playUi`, `play`, `setLoop`). Plus the sounds whose trigger only exists in a later milestone.
 * Together with the event map every manifest sound is assigned to exactly one group
 * (checked by test/events/coverage.test.ts).
 */

/** Engine API the client uses for a sound. */
export type ClientSoundApi = 'playUi' | 'play' | 'setLoop';

export interface ClientSound {
  /** Sound name (without scope; looked up `<faction>:` → `common:`). */
  readonly name: string;
  readonly api: ClientSoundApi;
  /** Who triggers it and how. */
  readonly trigger: string;
  /** Milestone in which the trigger is wired up (SOUNDLIST §3). */
  readonly milestone: string;
}

export interface DeferredSound {
  readonly name: string;
  /** Milestone in which the missing trigger/decision arrives. */
  readonly milestone: string;
  readonly reason: string;
}

/** Sounds driven by the client, not by sim events. */
export const CLIENT_SIDE_SOUNDS: readonly ClientSound[] = [
  // UI and commands (playUi, synchronous start, ≤ 1 frame after the click)
  { name: 'ui_click', api: 'playUi', trigger: 'buttons, menus, build palette', milestone: 'MS5' },
  { name: 'ui_select', api: 'playUi', trigger: 'unit selection changed by the player', milestone: 'MS5' },
  { name: 'ui_cmd_move', api: 'playUi', trigger: 'move order issued (command builder)', milestone: 'MS5' },
  { name: 'ui_cmd_attack', api: 'playUi', trigger: 'attack order issued', milestone: 'MS6' },
  { name: 'ui_cmd_build', api: 'playUi', trigger: 'build order placed', milestone: 'MS6' },
  { name: 'ui_cmd_generic', api: 'playUi', trigger: 'assist / guard / patrol / reclaim order', milestone: 'MS6' },
  { name: 'ui_error', api: 'playUi', trigger: 'invalid placement, resources or target (client-side verdict)', milestone: 'MS6' },
  { name: 'ui_queue_add', api: 'playUi', trigger: 'unit added to a factory queue', milestone: 'MS6' },
  { name: 'ui_queue_remove', api: 'playUi', trigger: 'unit removed from a factory queue', milestone: 'MS6' },
  // Acknowledgement pips: played N times (tech level) 70 ms apart, pitch = role family
  { name: 'ack_pip_direct', api: 'playUi', trigger: 'order ack for direct-fire units and shields', milestone: 'MS5' },
  { name: 'ack_pip_arty', api: 'playUi', trigger: 'order ack for artillery', milestone: 'MS9' },
  { name: 'ack_pip_aa', api: 'playUi', trigger: 'order ack for anti-air', milestone: 'MS9' },
  { name: 'ack_pip_eng', api: 'playUi', trigger: 'order ack for engineers', milestone: 'MS9' },
  { name: 'ack_pip_air', api: 'playUi', trigger: 'order ack for aircraft', milestone: 'MS14' },
  { name: 'ack_command', api: 'playUi', trigger: 'order ack for the commander', milestone: 'MS9' },
  { name: 'ack_structure', api: 'playUi', trigger: 'structure selected', milestone: 'MS9' },
  // Per-army build/reclaim loops (rate/density from the flowing build power in the Eco section)
  { name: 'bld_pour_loop', api: 'setLoop', trigger: "one loop per army ('build:<army>') while build power flows; rate rises with progress", milestone: 'MS5' },
  { name: 'rcl_loop', api: 'setLoop', trigger: "one loop per army ('reclaim:<army>') while reclaim beams are active", milestone: 'MS5' },
  // Movement: loops/steps near the camera, derived from unit records and the render animation
  { name: 'mov_tracks_loop', api: 'setLoop', trigger: 'light tracked units moving near the camera (grouped per cluster)', milestone: 'MS5' },
  { name: 'mov_tracks_heavy_loop', api: 'setLoop', trigger: 'heavy tracked units moving near the camera', milestone: 'MS9' },
  { name: 'mov_bot_heavy_step', api: 'play', trigger: 'foot plant of heavy bots (commander, T3 bot) from the procedural leg animation', milestone: 'MS5' },
  { name: 'mov_bot_step', api: 'play', trigger: 'foot plant of light bots and engineers', milestone: 'MS9' },
  { name: 'mov_air_jet_loop', api: 'setLoop', trigger: 'aircraft near the camera', milestone: 'MS14' },
  { name: 'mov_gunship_loop', api: 'setLoop', trigger: 'gunship near the camera', milestone: 'MS14' },
  { name: 'mov_air_flyby', api: 'play', trigger: 'aircraft passing close to the camera (client detects the pass)', milestone: 'MS14' },
  // Projectiles in flight: keyed loop per visible ProjectileRecord, Doppler via rate
  { name: 'prj_shell_whistle_loop', api: 'setLoop', trigger: 'visible artillery shells in flight (projectile records)', milestone: 'MS9' },
  { name: 'prj_missile_loop', api: 'setLoop', trigger: 'visible missiles in flight', milestone: 'MS9' },
  { name: 'prj_bomb_fall', api: 'play', trigger: 'bomb projectile spawned (falling whistle)', milestone: 'MS14' },
  // Economy ambience at zoom level Z0
  { name: 'eco_flow_hum_loop', api: 'setLoop', trigger: 'flow tone under factories/engineers/power near the camera', milestone: 'MS9' },
  { name: 'eco_pgen_loop', api: 'setLoop', trigger: 'power generators near the camera (Z0 only)', milestone: 'MS14' },
  { name: 'eco_mex_loop', api: 'setLoop', trigger: 'mass extractors near the camera (Z0 only)', milestone: 'MS14' },
  { name: 'eco_hydro_loop', api: 'setLoop', trigger: 'hydrocarbon plants near the camera (Z0 only)', milestone: 'MS14' },
  // Intel ambience
  { name: 'int_radar_ping', api: 'play', trigger: 'own radar sweep near the camera (Z0/Z1, rare)', milestone: 'MS14' },
  // Match flow and music stingers (gameOver ctl message, match start)
  { name: 'sig_sounding', api: 'play', trigger: 'match start: the commander is poured (placeholder until P19)', milestone: 'MS14' },
  { name: 'mus_match_start', api: 'play', trigger: 'match start', milestone: 'MS14' },
  { name: 'mus_victory', api: 'play', trigger: 'gameOver: victory', milestone: 'MS9' },
  { name: 'mus_defeat', api: 'play', trigger: 'gameOver: defeat', milestone: 'MS9' },
  // Map ambience beds
  { name: 'amb_wind_loop', api: 'setLoop', trigger: 'map base bed (always)', milestone: 'MS9' },
  { name: 'amb_magma_loop', api: 'setLoop', trigger: 'maps with lava/volcano props near the camera', milestone: 'MS14' },
  { name: 'amb_water_loop', api: 'setLoop', trigger: 'maps with water, camera near the shore', milestone: 'MS14' },
];

/** Sounds whose trigger or integration decision only comes in a later milestone. */
export const DEFERRED_SOUNDS: readonly DeferredSound[] = [
  {
    name: 'sig_bell_deep',
    milestone: 'MS9',
    reason:
      'Lotbruch bell: until MS9 exp_commander carries its own deep bell (audio.md §6). In MS9 the bell is removed from exp_commander and sig_bell_deep becomes a `then` follow-up of commanderDeath — playing it earlier would double the bell.',
  },
  {
    name: 'mov_hover_loop',
    milestone: 'post-MVP',
    reason: 'No hover unit in the MVP roster (marine/hover are post-MVP); the sound is prepared for later factions.',
  },
];

/** Names of {@link CLIENT_SIDE_SOUNDS}. */
export function clientSideSoundNames(): string[] {
  return CLIENT_SIDE_SOUNDS.map((s) => s.name);
}

/** Names of {@link DEFERRED_SOUNDS}. */
export function deferredSoundNames(): string[] {
  return DEFERRED_SOUNDS.map((s) => s.name);
}
