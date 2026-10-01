import { EventType, UnitFlags, type FrameReader } from '@faf/protocol';
import { isAlertExpired, mapRegion, pushAlert, tickAlerts, type AlertItem, type AlertsSection } from '@faf/hud';

export interface AlertSubject {
  readonly typeId: string;
  readonly commander: boolean;
  readonly structure: boolean;
}

/** Presentation of authoritative, viewer-filtered events, with no World access. */
export class FrameHudAlerts {
  private frameTick = -1;
  private eventTick = -1;
  private viewer = -128;
  private army = -128;
  private readonly history: AlertItem[] = [];
  private cycleIndex = 0;
  constructor(private readonly section: AlertsSection,
    private readonly subject: (visual: number) => AlertSubject,
    private readonly mapSizeWu: number) {}

  present(frame: FrameReader, army: number): void {
    if (frame.viewer !== this.viewer || army !== this.army || frame.tick < this.frameTick) {
      this.section.items.value = [];
      this.section.historyCount.value = 0;
      this.section.nextId.value = 1;
      this.history.length = 0;
      this.cycleIndex = 0;
      this.eventTick = -1;
      this.viewer = frame.viewer;
      this.army = army;
    }
    this.frameTick = frame.tick;
    const after = this.eventTick;
    for (let i = 0; i < frame.eventCount; i++) {
      const tick = frame.eventTick(i);
      this.eventTick = Math.max(this.eventTick, tick);
      if (tick <= after) continue;
      const type = frame.eventType(i), atS = tick / 10;
      if (type === EventType.MassStall || type === EventType.EnergyStall || type === EventType.StorageFull) {
        if (army < 0 || frame.eventVisual(i) !== army) continue;
        pushAlert(this.section, {
          type: type === EventType.MassStall ? 'massStall' : type === EventType.EnergyStall ? 'energyStall' : 'storageFull',
          atS, ...(type === EventType.StorageFull ? {} : { flow: frame.eventAux(i) / 65536 }),
        });
        continue;
      }
      if (type !== EventType.BuildComplete && type !== EventType.Impact) continue;
      const handle = frame.eventHandle(i);
      let unit = -1;
      for (let u = 0; u < frame.unitCount; u++) if (frame.unitHandle(u) === handle) { unit = u; break; }
      if (unit < 0 || army < 0 || frame.unitArmy(unit) !== army ||
        (frame.unitFlags(unit) & (UnitFlags.Ghost | UnitFlags.Blip | UnitFlags.Wreck)) !== 0) continue;
      if (type === EventType.Impact && (frame.eventAux(i) !== 1 && frame.eventAux(i) !== 4 ||
        (frame.unitFlags(unit) & UnitFlags.Damaged) === 0)) continue;
      const subject = this.subject(frame.unitVisual(unit));
      const x = frame.eventPos(i, 0) / 4096, z = frame.eventPos(i, 2) / 4096;
      pushAlert(this.section, {
        type: type === EventType.BuildComplete ? 'buildComplete' : subject.commander ? 'commanderDanger' : subject.structure ? 'baseAttacked' : 'unitAttacked',
        atS, subjectTypeId: subject.typeId, location: { x, z }, region: mapRegion(x, z, this.mapSizeWu, this.mapSizeWu),
      });
    }
    for (const item of this.section.items.peek()) if (isAlertExpired(item, frame.tick / 10)) this.history.unshift(item);
    if (this.history.length > 64) this.history.length = 64;
    tickAlerts(this.section, frame.tick / 10);
  }

  find(id: number): AlertItem | undefined {
    return this.section.items.peek().find(item => item.id === id) ?? this.history.find(item => item.id === id);
  }

  cycle(): AlertItem | undefined {
    const items = [...this.section.items.peek().slice(3), ...this.history];
    if (items.length === 0) return this.section.items.peek()[0];
    return items[this.cycleIndex++ % items.length];
  }
}
