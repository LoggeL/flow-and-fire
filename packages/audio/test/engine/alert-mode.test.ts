import { describe, expect, it } from 'vitest';
import { makeEngineRig, unlockByGesture } from './rig.ts';

describe('alert output policy (fake graph, no hardware destination)', () => {
  it('gong replaces the alert sound while preserving its kind, location and jump target', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    r.engine.setAlertMode('gong');
    r.engine.alert({ kind: 'alt_base_attacked', x: 10, z: 20 });
    r.engine.update();
    expect(r.engine.alertHistory()[0]).toMatchObject({ kind: 'alt_base_attacked', soundId: 'common:alt_gong', x: 10, z: 20 });
    expect(r.engine.stats().voicesByCategory.alert).toBe(1);
    expect(r.engine.jumpToLastAlert()).toBe(true);
    expect(r.jumps).toEqual([{ x: 10, z: 20 }]);
    await r.engine.dispose();
  });

  it('off stops the current alert and preserves notices and acknowledgement playback', async () => {
    const r = makeEngineRig();
    await unlockByGesture(r);
    r.engine.alert({ kind: 'alt_commander_danger', x: 0, z: 0 });
    r.engine.update();
    expect(r.engine.alerts?.busy).toBe(true);
    r.engine.setAlertMode('off');
    expect(r.engine.alerts?.busy).toBe(false);
    r.engine.alert({ kind: 'alt_enemy_air', x: 10, z: 20 });
    r.engine.update();
    expect(r.engine.alertHistory()[0]?.kind).toBe('alt_enemy_air');
    expect(r.engine.alerts?.stats.voiced).toBe(1);
    expect(r.engine.playUi('ack_pip_direct')).not.toBeNull();
    expect(r.engine.settings.get().alerts).toBeGreaterThan(0);
    await r.engine.dispose();
  });
});
