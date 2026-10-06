import { describe, expect, test } from 'vitest';
import {
  ALERT_EXPIRE_S,
  ALERT_STALE_S,
  alertJumpTarget,
  alertLevel,
  alertLiveMode,
  createAlertsSection,
  isAlertExpired,
  isAlertFlashing,
  isAlertStale,
  mapRegion,
  mergeAlert,
  newestJumpAlertId,
  olderAlertCount,
  pruneAlerts,
  pushAlert,
  resolveAlertJump,
  tickAlerts,
  visibleAlerts,
} from '../../src/model/alerts.ts';
import type { AlertEvent, AlertItem } from '../../src/model/alerts.ts';
import {
  STALL_SOON_S,
  consumerRequest,
  consumerServed,
  isBottleneck,
  netLevel,
  overallFlow,
  pausedCount,
  resourceStatus,
  storageFill,
  topConsumers,
  wholeSecondsToEmpty,
  wholeSecondsToFull,
} from '../../src/model/eco.ts';
import type { FlowConsumer } from '../../src/model/eco.ts';
import { bannerKind, capLevel } from '../../src/model/status.ts';
import { flowDemandExceedsNet, resourceForecast } from '../../src/model/tooltip.ts';

describe('resourceStatus boundaries (ui.md §5.1)', () => {
  test('stall is flow < 1 and wins over every other state', () => {
    expect(resourceStatus(0, 1230, 28, 38.9, 0.72)).toBe('stall');
    // Even a full storage with positive net is a stall while flow < 1.
    expect(resourceStatus(1230, 1230, 50, 10, 0.99)).toBe('stall');
    // Floating noise just under 1 is not a stall.
    expect(resourceStatus(300, 1230, 28, 31.5, 1 - 1e-9)).toBe('normal');
    expect(resourceStatus(300, 1230, 28, 31.5, 1)).toBe('normal');
  });

  test('overflow needs a full storage and a positive net', () => {
    expect(resourceStatus(1230, 1230, 28, 12, 1)).toBe('overflow');
    expect(resourceStatus(1300, 1230, 28, 12, 1)).toBe('overflow');
    expect(resourceStatus(1230, 1230, 12, 12, 1)).toBe('normal'); // net 0
    expect(resourceStatus(1229.9, 1230, 28, 12, 1)).toBe('normal'); // not full
    expect(resourceStatus(0, 0, 28, 12, 1)).toBe('normal'); // no capacity at all
  });

  test('stall soon: net < 0 and empty in strictly less than 10 s', () => {
    // 35 stored at −3.5/s = exactly 10 s → not yet.
    expect(resourceStatus(35, 1230, 28, 31.5, 1)).toBe('normal');
    expect(resourceStatus(34.9, 1230, 28, 31.5, 1)).toBe('stallSoon');
    expect(resourceStatus(0, 1230, 28, 31.5, 1)).toBe('stallSoon');
    expect(resourceStatus(0, 1230, 28, 28, 1)).toBe('normal'); // net 0 never drains
    expect(STALL_SOON_S).toBe(10);
  });

  test('display helpers', () => {
    expect(netLevel(0.05)).toBe('zero');
    expect(netLevel(-0.05)).toBe('zero');
    expect(netLevel(0.051)).toBe('pos');
    expect(netLevel(-3.5)).toBe('neg');
    expect(storageFill(312, 1230)).toBeCloseTo(0.2537, 3);
    expect(storageFill(2000, 1230)).toBe(1);
    expect(storageFill(-5, 1230)).toBe(0);
    expect(storageFill(5, 0)).toBe(0);
    expect(wholeSecondsToEmpty(38, -5.5)).toBe(7);
    expect(wholeSecondsToEmpty(38, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(wholeSecondsToFull(1000, 1230, 23)).toBe(10);
    expect(overallFlow(0.72, 1)).toBe(0.72);
    expect(overallFlow(1.2, 1)).toBe(1);
    expect(overallFlow(-1, 1)).toBe(0);
  });
});

const consumer = (id: number, massReq: number, massGot: number, extra: Partial<FlowConsumer> = {}): FlowConsumer => ({
  id,
  typeId: 'core:str_t1_fac_land',
  kind: 'factory',
  massReq,
  massGot,
  energyReq: 0,
  energyGot: 0,
  paused: false,
  ...extra,
});

describe('flow details derivations', () => {
  test('top consumers: request > 0, sorted by request, stable ties by id, max rows', () => {
    const rows = [consumer(3, 6, 6), consumer(1, 10.9, 10.9), consumer(2, 6, 6), consumer(4, 0, 0), consumer(5, 1, 1), consumer(6, 2, 2), consumer(7, 3, 3)];
    expect(topConsumers(rows, 'mass').map((c) => c.id)).toEqual([1, 2, 3, 7, 6]);
    expect(topConsumers(rows, 'mass', 2).map((c) => c.id)).toEqual([1, 2]);
    expect(topConsumers(rows, 'energy')).toEqual([]);
  });

  test('bottleneck = served below request, never while paused', () => {
    expect(isBottleneck(consumer(1, 10, 7.2), 'mass')).toBe(true);
    expect(isBottleneck(consumer(1, 10, 10), 'mass')).toBe(false);
    expect(isBottleneck(consumer(1, 10, 9.9999), 'mass')).toBe(false); // within tolerance
    expect(isBottleneck(consumer(1, 10, 0, { paused: true }), 'mass')).toBe(false);
    expect(isBottleneck(consumer(1, 0, 0), 'mass')).toBe(false);
    expect(consumerServed(consumer(1, 10, 10, { paused: true }), 'mass')).toBe(0);
    expect(consumerRequest(consumer(1, 10, 10), 'energy')).toBe(0);
    expect(pausedCount([consumer(1, 1, 1, { paused: true }), consumer(2, 1, 1), consumer(3, 1, 0, { paused: true })])).toBe(2);
  });
});

describe('tooltip derivations', () => {
  test('resource forecast', () => {
    expect(resourceForecast(38, 1230, -5.5)).toEqual({ kind: 'emptyIn', seconds: 7 });
    expect(resourceForecast(0, 1230, -5.5)).toEqual({ kind: 'empty', seconds: 0 });
    expect(resourceForecast(1000, 1230, 23)).toEqual({ kind: 'fullIn', seconds: 10 });
    expect(resourceForecast(1230, 1230, 16)).toEqual({ kind: 'full', seconds: 0 });
    expect(resourceForecast(300, 1230, 0.04)).toEqual({ kind: 'steady', seconds: 0 });
    expect(resourceForecast(300, 0, 5)).toEqual({ kind: 'steady', seconds: 0 });
  });

  test('flow demand warning: demand above the net of either resource', () => {
    expect(flowDemandExceedsNet(6, 60, -3.5, 44)).toBe(true);
    expect(flowDemandExceedsNet(6, 60, 16, 44)).toBe(true);
    expect(flowDemandExceedsNet(6, 30, 16, 44)).toBe(false);
    expect(flowDemandExceedsNet(0, 0, -10, -10)).toBe(false);
  });
});

describe('status derivations', () => {
  test('cap level and banner priority', () => {
    expect(capLevel(449, 500)).toBe('normal');
    expect(capLevel(450, 500)).toBe('near');
    expect(capLevel(501, 500)).toBe('reached');
    expect(bannerKind('none', 1, null, false)).toBeNull();
    expect(bannerKind('user', 2, 0.5, true)).toBe('pause');
    expect(bannerKind('background', 2, 0.5, true)).toBe('background');
    expect(bannerKind('none', 2, 0.5, true)).toBe('contextLoss');
    expect(bannerKind('none', 2, 1.5, false)).toBe('simLag');
    expect(bannerKind('none', 1, 1, false)).toBeNull(); // effective = requested: no lag
    expect(bannerKind('none', 2, null, false)).toBe('speed');
    expect(bannerKind('none', 0.5, null, false)).toBe('speed');
  });
});

const ev = (type: AlertEvent['type'], atS: number, extra: Partial<AlertEvent> = {}): AlertEvent => ({ type, atS, ...extra });

describe('alert logic (ui.md §5.11)', () => {
  test('same type within the repeat interval merges (count, newest place, moved to top)', () => {
    const s = createAlertsSection();
    const a = pushAlert(s, ev('unitAttacked', 100, { region: 'center' }));
    const b = pushAlert(s, ev('baseAttacked', 101));
    const c = pushAlert(s, ev('unitAttacked', 110, { region: 'east' })); // 10 s later: still within 10 s
    expect(c).toBe(a);
    const items = s.items.value;
    expect(items.map((x) => x.id)).toEqual([a, b]);
    expect(items[0]).toMatchObject({ count: 2, createdAtS: 100, lastAtS: 110, region: 'east' });
    expect(s.nextId.value).toBe(3);
  });

  test('outside the interval a new alert starts; the interval counts from the last occurrence', () => {
    const s = createAlertsSection();
    pushAlert(s, ev('unitAttacked', 100));
    pushAlert(s, ev('unitAttacked', 108));
    pushAlert(s, ev('unitAttacked', 117)); // 9 s after the last one → merges (chain)
    expect(s.items.value).toHaveLength(1);
    expect(s.items.value[0]?.count).toBe(3);
    const id = pushAlert(s, ev('unitAttacked', 127.5)); // 10.5 s after the last one
    expect(s.items.value).toHaveLength(2);
    expect(s.items.value[0]?.id).toBe(id);
    expect(s.items.value[0]?.count).toBe(1);
    // Different types never merge.
    pushAlert(s, ev('baseAttacked', 128));
    expect(s.items.value).toHaveLength(3);
  });

  test('merge keeps old subject/location when the new event has none', () => {
    const r1 = mergeAlert([], ev('buildComplete', 10, { subjectTypeId: 'core:str_t1_mex', location: { x: 1, z: 2 } }), 7);
    const r2 = mergeAlert(r1.items, ev('buildComplete', 12), 8);
    expect(r2.merged).toBe(true);
    expect(r2.items[0]).toMatchObject({ id: 7, count: 2, subjectTypeId: 'core:str_t1_mex', location: { x: 1, z: 2 } });
  });

  test('stale from 20 s, removed from 60 s into the history', () => {
    const item = mergeAlert([], ev('enemyAir', 100), 1).items[0] as AlertItem;
    expect(isAlertStale(item, 100 + ALERT_STALE_S - 0.1)).toBe(false);
    expect(isAlertStale(item, 100 + ALERT_STALE_S)).toBe(true);
    expect(isAlertExpired(item, 100 + ALERT_EXPIRE_S - 0.1)).toBe(false);
    expect(isAlertExpired(item, 100 + ALERT_EXPIRE_S)).toBe(true);
    const s = createAlertsSection();
    pushAlert(s, ev('enemyAir', 100));
    pushAlert(s, ev('unitAttacked', 130));
    const before = s.items.value;
    expect(pruneAlerts(before, 150).items).toBe(before); // nothing expired: same array
    expect(tickAlerts(s, 160)).toBe(1);
    expect(s.items.value.map((a) => a.type)).toEqual(['unitAttacked']);
    expect(s.historyCount.value).toBe(1);
    expect(tickAlerts(s, 161)).toBe(0);
  });

  test('at most 3 visible, "N ältere" counts hidden and expired alerts', () => {
    const s = createAlertsSection();
    const types = ['commanderDanger', 'baseAttacked', 'unitAttacked', 'enemyAir', 'buildComplete'] as const;
    types.forEach((type, i) => pushAlert(s, ev(type, i)));
    const items = s.items.value;
    expect(visibleAlerts(items).map((a) => a.type)).toEqual(['buildComplete', 'enemyAir', 'unitAttacked']);
    expect(olderAlertCount(items, 0)).toBe(2);
    expect(olderAlertCount(items, 4)).toBe(6);
    expect(olderAlertCount(items.slice(0, 2), 0)).toBe(0);
  });

  test('levels, jump targets, live mode, flash window', () => {
    expect(alertLevel('energyStall')).toBe('crit');
    expect(alertLevel('massStall')).toBe('warn');
    expect(alertJumpTarget('energyStall')).toBe('flowDetails');
    expect(alertJumpTarget('massStall')).toBe('flowDetails');
    expect(alertJumpTarget('storageFull')).toBe('none');
    expect(alertJumpTarget('commanderDanger')).toBe('unit');
    const crit = mergeAlert([], ev('commanderDanger', 10), 1).items[0] as AlertItem;
    const warn = mergeAlert([], ev('unitAttacked', 10), 2).items[0] as AlertItem;
    expect(alertLiveMode([warn])).toBe('polite');
    expect(alertLiveMode([warn, crit])).toBe('assertive');
    expect(isAlertFlashing(crit, 11)).toBe(true);
    expect(isAlertFlashing(crit, 12)).toBe(false);
    expect(isAlertFlashing(warn, 10)).toBe(false);
  });

  test('resolving "Zum Ort": camera target with location, stall alerts open the flow details', () => {
    const s = createAlertsSection();
    const unit = pushAlert(s, ev('unitAttacked', 1, { location: { x: 10, z: 20 } }));
    const stall = pushAlert(s, ev('energyStall', 2, { location: { x: 1, z: 1 } }));
    const full = pushAlert(s, ev('storageFull', 3));
    const items = s.items.value;
    expect(resolveAlertJump(items, unit)).toEqual({ id: unit, target: 'unit', location: { x: 10, z: 20 } });
    expect(resolveAlertJump(items, stall)).toEqual({ id: stall, target: 'flowDetails', location: null });
    expect(resolveAlertJump(items, full)).toBeNull();
    expect(resolveAlertJump(items, 99)).toBeNull();
    // Space skips the newest alert when it has no target.
    expect(newestJumpAlertId(items)).toBe(stall);
    expect(newestJumpAlertId([])).toBeNull();
  });

  test('map regions', () => {
    expect(mapRegion(256, 256, 512, 512)).toBe('center');
    expect(mapRegion(500, 10, 512, 512)).toBe('northEast');
    expect(mapRegion(10, 500, 512, 512)).toBe('southWest');
    expect(mapRegion(256, 500, 512, 512)).toBe('south');
  });
});
