import { computed } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { storageFill, topConsumers, consumerRequest, consumerServed, isBottleneck, secondsToEmpty, secondsToFull } from '../../model/eco.ts';
import type { ResourceKind } from '../../model/eco.ts';
import { ALERT_DEFS, visibleAlerts, olderAlertCount, isAlertStale, isAlertFlashing } from '../../model/alerts.ts';
import type { AlertItem } from '../../model/alerts.ts';
import { capLevel, bannerKind } from '../../model/status.ts';
import type { UnitTooltipTarget } from '../../model/tooltip.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { findUnit, unitText } from '../../data/roster.ts';
import { fmtInt, fmtDec, fmtSigned, fmtPct, fmtTime } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import { Panel, PanelHead, Bar, Num, ResourceGlyph, LevelSymbol, Button, TooltipFrame, Key } from '../../ui/index.ts';
import { keyLabel } from '../../ui/keys.ts';
import { resourceLabel, consumerLabel, priorityLabel, alertTitle, alertMeta, incomeSourceLabel, unitName } from './labels.ts';
import './top.css';
export function ResourceMeter({ resource }: {
    readonly resource: ResourceKind;
}) {
    const model = useHud(), commands = useCommands(), r = model.eco[resource];
    const status = r.status.value;
    const fill = useMemo(() => computed(() => storageFill(r.stored.value, r.capacity.value)), [r]);
    const notice = useMemo(() => computed(() => r.status.value === 'stall' ? t('ui.eco.meter.stall', { pct: fmtPct(r.flow.value) }) : r.status.value === 'overflow' ? t('ui.eco.meter.overflow') : r.status.value === 'stallSoon' ? t('ui.eco.meter.emptyIn', { n: Math.ceil(secondsToEmpty(r.stored.value, r.net.value)) }) : ''), [r]);
    return <button type="button" data-component="ResourceMeter" data-testid={`resource-${resource}`} data-panel={`resource-${resource}`} class={`ff-panel res res--${resource} is-${status === 'stallSoon' ? 'stall-soon' : status}`} aria-label={resourceLabel(resource, model.locale.value)} aria-expanded={model.eco.detailsOpen.value} onClick={() => commands.toggleFlowDetails()} onMouseEnter={() => { model.tooltip.target.value = { kind: 'resource', resource }; model.tooltip.anchor.value = { kind: 'point', x: 12, y: 80 }; }} onMouseLeave={() => { model.tooltip.target.value = null; }}>
    <span class="res__glyph"><ResourceGlyph kind={resource}/></span>
    <span class="res__store"><Num value={r.stored} ch={5}/><small> / <Num value={r.capacity}/></small></span>
    <span class={`res__net ${status === 'stallSoon' ? 'is-soon' : ''}`}><Num value={r.net} format={fmtSigned} ch={6}/></span>
    <Bar kind={resource} value={fill} level={status === 'stall' ? 'crit' : 'normal'} class="res__bar"/>
    <span class="res__flow"><span class="in"><Num value={r.income} format={fmtSigned}/></span><span class="out"><Num value={r.demand} format={(v) => fmtSigned(-v)}/></span><span class="eff">{t('ui.eco.meter.flow')} <Num value={r.flow} format={fmtPct}/></span></span>
    {status !== 'normal' && <span class={`ff-badge ff-badge--${status === 'stall' ? 'crit' : 'warn'}`}>{notice}</span>}
  </button>;
}
export function ResourceBar() { return <><div class="eco" data-component="ResourceBar" data-testid="resource-bar"><ResourceMeter resource="mass"/><ResourceMeter resource="energy"/></div><FlowDetails /></>; }
export function FlowDetails() {
    const m = useHud(), c = useCommands();
    if (!m.eco.detailsOpen.value)
        return null;
    return <Panel component="FlowDetails" panelId="flow" testId="flow-details" class="flow"><PanelHead title={t('ui.eco.details.title')}/><div class="flow__body">{(['mass', 'energy'] as const).map((res) => <div class="flow__col" key={res}><div class="flow__head"><span>{resourceLabel(res, m.locale.value)}</span><span>{t('ui.eco.details.gotWant')}</span></div>{topConsumers(m.eco.consumers.value, res).map((item) => <div class={`flow__row ${item.paused ? 'is-paused' : ''} ${isBottleneck(item, res) ? 'is-bottleneck' : ''}`} key={item.id}><StrategicIcon typeId={item.typeId}/><span class="flow__name">{consumerLabel(item, m.locale.value)}</span><span class="flow__got num">{fmtDec(consumerServed(item, res), 1)}</span><span class="want num">{fmtDec(consumerRequest(item, res), 1)}</span>{m.eco.interactive.value ? <button class="flow__pause" aria-label={t(item.paused ? 'ui.eco.details.resume' : 'ui.eco.details.pause', { name: unitName(item.typeId, m.locale.value) })} onClick={() => c.pauseConsumer(item.id, !item.paused)}>{item.paused ? '▶' : 'Ⅱ'}</button> : <span />}</div>)}{topConsumers(m.eco.consumers.value, res).length === 0 && <span>{t('ui.eco.details.empty')}</span>}</div>)}</div><div class="flow__foot">{t('ui.eco.details.priority')} {priorityLabel(m.eco.stallPriority.value, m.locale.value)}{!m.eco.interactive.value && <span>{t('ui.eco.details.readOnly')}</span>}</div></Panel>;
}
export function MatchStatus() {
    const { match: m } = useHud(), c = useCommands();
    return <Panel component="MatchStatus" testId="match-status" panelId="status" class="status"><div class="status__inner"><div class="stat stat--timer"><Num value={m.timeS} format={fmtTime} ch={8}/></div><div class={`stat stat--speed ${m.speed.value !== 1 ? 'is-changed' : ''}`}><button class="stat__step" aria-label={t('ui.status.slower')} onClick={() => c.changeSpeed(-1)}>−</button><b>{t('ui.status.speedValue', { value: fmtDec(m.speed.value, 1) })}</b><button class="stat__step" aria-label={t('ui.status.faster')} onClick={() => c.changeSpeed(1)}>+</button></div><div class={`stat stat--cap is-${capLevel(m.units.value, m.unitCap.value)}`} aria-label={t('ui.status.units', { units: m.units.value, cap: m.unitCap.value })}><Num value={m.units}/> / <Num value={m.unitCap}/></div>{m.replay.value && m.scores.value && <div class="stat">{fmtInt(m.scores.value.self)} : {fmtInt(m.scores.value.enemy)}</div>}<button class="status__menu" aria-label={t('ui.status.menu')} onClick={() => c.openGameMenu()}>☰</button></div></Panel>;
}
export function PauseBanner() {
    const { match: m } = useHud(), c = useCommands();
    const kind = bannerKind(m.pause.value, m.speed.value, m.simLag.value, m.contextLost.value);
    if (!kind)
        return null;
    const key = kind === 'simLag' ? 'lag' : kind;
    return <Panel component="PauseBanner" testId="pause-banner" panelId="banner" class={`banner banner--${kind}`}><div class="banner__title">{t(`ui.status.banner.${key}`, { value: fmtDec(m.simLag.value ?? m.speed.value, 1) })}</div>{(kind === 'pause' || kind === 'background') && <Button size="sm" variant="ghost" onClick={() => c.togglePause()}>{t('ui.status.banner.resume')} <Key>{'P'}</Key></Button>}</Panel>;
}
export function Alert({ item, newest = false }: {
    readonly item: AlertItem;
    readonly newest?: boolean;
}) {
    const m = useHud(), c = useCommands(), level = ALERT_DEFS[item.type].level;
    return <div data-component="Alert" data-testid={`alert-${item.id}`} class={`ff-alert ff-alert--${level} ${isAlertStale(item, m.match.timeS.value) ? 'is-stale' : ''} ${isAlertFlashing(item, m.match.timeS.value) && m.reducedMotion.value !== 'on' ? 'is-new' : ''}`} role="status" aria-live={level === 'crit' ? 'assertive' : 'polite'}><span class="ff-alert__ico"><LevelSymbol level={level}/></span><div><div class="ff-alert__title">{alertTitle(item, m.locale.value)}</div><div class="ff-alert__meta">{alertMeta(item, m.match.timeS.value, m.locale.value)}</div></div><button class="ff-alert__jump" aria-label={t('ui.alerts.jump')} onClick={() => { if (ALERT_DEFS[item.type].jump === 'flowDetails' && !m.eco.detailsOpen.peek())
        c.toggleFlowDetails(); c.jumpToAlert(item.id); }}>{newest ? '␣' : '↗'}</button></div>;
}
export function AlertFeed() {
    const m = useHud(), c = useCommands(), older = olderAlertCount(m.alerts.items.value, m.alerts.historyCount.value);
    return <div class="alerts" data-component="AlertFeed" data-testid="alert-feed" data-panel="alerts">{visibleAlerts(m.alerts.items.value).map((a, i) => <Alert key={a.id} item={a} newest={i === 0}/>)}{older > 0 && <button class="alerts__more" onClick={() => c.cycleAlerts()}>{t('ui.alerts.more', { n: older })}</button>}</div>;
}
export function UnitTooltip({ typeId, builderBp, buildCost, slot, locked, disabledReason, mode }: Omit<UnitTooltipTarget, 'kind'>) {
    const m = useHud(), u = findUnit(typeId);
    if (!u)
        return null;
    const costs = buildCost ?? u.economy, bp = builderBp ?? 0, duration = bp > 0 ? Math.max(.001, costs.buildTime / bp) : Infinity, mass = costs.mass / duration, energy = costs.energy / duration;
    const stats = [['hp', u.health.max], ['dps', u.weapons.dps], ['range', u.weapons.range], ['speed', u.speed], ['buildPower', u.economy.buildPower], ['vision', u.vision]] as const;
    const adjacency = unitText(typeId, 'adjacency', m.locale.value);
    return <TooltipFrame testId="unit-tooltip" icon={<StrategicIcon typeId={typeId}/>} name={unitText(typeId, 'name', m.locale.value)} role={unitText(typeId, 'role', m.locale.value)} keyHint={slot ? keyLabel(slot, m.keyboardLayout.value) : undefined} cost={builderBp === undefined ? undefined : { mass: fmtInt(costs.mass), energy: fmtInt(costs.energy), flow: t('ui.tooltip.flow', { mass: fmtDec(mass, 1), energy: fmtDec(energy, 1) }), flowWarn: mass > m.eco.mass.net.value || energy > m.eco.energy.net.value }} stats={stats.map(([key, value]) => ({ label: t(`ui.tooltip.stat.${key}`), value: fmtDec(value, 1) }))} body={unitText(typeId, 'desc', m.locale.value)} adjacency={adjacency ? { label: t('ui.tooltip.adjacency'), text: adjacency } : undefined} foot={disabledReason ? t('ui.tooltip.disabled', { reason: disabledReason }) : locked ? t(`ui.card.lock.${locked.reason}`, { tier: locked.tier, builder: '', factory: '' }) : t(mode === 'factory' ? 'ui.tooltip.foot.many' : 'ui.tooltip.foot.place')}/>;
}
export function ResourceTooltip({ resource }: {
    readonly resource: ResourceKind;
}) {
    const m = useHud(), r = m.eco[resource], n = r.net.value;
    const eta = n < 0 ? t('ui.tooltip.resource.emptyIn', { n: Math.ceil(secondsToEmpty(r.stored.value, n)) }) : n > 0 ? t('ui.tooltip.resource.fullIn', { n: Math.ceil(secondsToFull(r.stored.value, r.capacity.value, n)) }) : t('ui.tooltip.resource.steady');
    return <TooltipFrame testId="resource-tooltip" name={resourceLabel(resource, m.locale.value)} role={t('ui.tooltip.resource.role')} icon={<ResourceGlyph kind={resource}/>} stats={[{ label: t('ui.tooltip.resource.storage'), value: `${fmtInt(r.stored.value)} / ${fmtInt(r.capacity.value)}` }, { label: t('ui.tooltip.resource.net'), value: fmtSigned(n) }, { label: t('ui.tooltip.resource.flow'), value: fmtPct(r.flow.value) }]} body={<div><div>{eta}</div><div class="tip-res__h">{t('ui.tooltip.resource.bySource')}</div>{r.incomeBySource.value.map((x) => <div class="tip-res__row" key={x.source}>{incomeSourceLabel(x.source, m.locale.value)}<b>{fmtSigned(x.perSec)}</b></div>)}<div class="tip-res__h">{t('ui.tooltip.resource.byBuilding')}</div>{r.storageByBuilding.value.map((x) => <div key={x.typeId}>{unitName(x.typeId, m.locale.value)} ×{x.count}: {fmtInt(x.capacity)}</div>)}</div>} foot={t('ui.tooltip.resource.hint')}/>;
}
