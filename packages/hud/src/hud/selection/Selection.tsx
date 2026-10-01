import { computed, effect } from '@preact/signals';
import { useMemo, useLayoutEffect, useRef } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { singleStructureKey, factoryStructureKey, orderChainKey, hpLevel, nextFocusType } from '../../model/index.ts';
import { clickModsFromEvent } from '../../commands/mods.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { iconOf, iconMaskClass } from '../../data/icons.ts';
import { unitText } from '../../data/roster.ts';
import { fmtInt, fmtDec, fmtPct } from '../../format/index.ts';
import { t, tn } from '../../i18n/t.ts';
import { Panel, PanelHead, Num, Bar, Key, Button } from '../../ui/index.ts';
import '../../styles/hud.css';
import './selection.css';
export function OrderQueue() {
    const m = useHud(), c = useCommands();
    const shape = useMemo(() => computed(() => orderChainKey(m.selection.single.value?.orders ?? [])), [m]);
    void shape.value;
    const orders = m.selection.single.peek()?.orders ?? [];
    return <div class="qlist" data-component="OrderQueue" data-testid="order-queue"><div class="qlist__h">{t('ui.selection.orders.title')} <Key>{'⇧'}</Key></div>{orders.slice(0, 6).map((o, i) => <button class={`qi ${i === 0 ? 'is-now' : ''}`} key={i} onClick={() => c.jumpToOrder(i)} onContextMenu={(e) => { e.preventDefault(); c.removeOrder(i); }} aria-label={t('ui.selection.orders.entry', { i: i + 1, label: t(`ui.selection.order.${o.kind}`) })}><span class="n">{i + 1}</span>{o.typeId ? <StrategicIcon typeId={o.typeId}/> : <span>›</span>}<span>{t(`ui.selection.order.${o.kind}`)}{o.typeId ? ` · ${unitText(o.typeId, 'short', m.locale.value)}` : ''}</span>{o.progress !== undefined && <Num value={computed(() => m.selection.single.value?.orders[i]?.progress ?? 0)} format={fmtPct}/>}</button>)}{orders.length === 0 && <span>{t('ui.selection.orders.empty')}</span>}{orders.length > 6 && <span>{tn('ui.selection.orders.more', orders.length - 6)}</span>}</div>;
}
export function UnitDetail() {
    const m = useHud();
    const shape = useMemo(() => computed(() => singleStructureKey(m.selection.single.value)), [m]);
    void shape.value;
    const d = m.selection.single.peek();
    const hot = useMemo(() => ({ hp: computed(() => m.selection.single.value?.hp ?? 0), max: computed(() => m.selection.single.value?.hpMax ?? 1), fraction: computed(() => { const x = m.selection.single.value; return x ? x.hp / x.hpMax : 0; }), shield: computed(() => { const x = m.selection.single.value?.shield; return x ? x.hp / x.hpMax : 0; }), vet: computed(() => m.selection.single.value?.vet.progress ?? 0), tap: computed(() => { const x = m.selection.single.value?.tapshot; return x ? x.stored / x.threshold : 0; }) }), [m]);
    if (!d)
        return null;
    return <div class="sel__body sel__body--single" data-component="UnitDetail" data-testid="unit-detail"><div class="portrait"><StrategicIcon typeId={d.typeId}/><span class="portrait__vet">{'◆'.repeat(d.vet.level)}</span></div><div class="uinfo"><div class="uinfo__name"><b>{unitText(d.typeId, 'name', m.locale.value)}</b></div><span>{unitText(d.typeId, 'role', m.locale.value)}</span><div class="meter"><span>{t('ui.selection.meter.hp')}</span><Bar kind="hp" value={hot.fraction}/><span><Num value={hot.hp}/> / <Num value={hot.max}/></span></div>{d.shield && <div class="meter"><span>{t('ui.selection.meter.shield')}</span><Bar kind="shield" value={hot.shield}/><Num value={hot.shield} format={fmtPct}/></div>}<div class="meter"><span>{t('ui.selection.meter.vet')}</span><Bar kind="build" value={hot.vet}/><Num value={hot.vet} format={fmtPct}/></div>{d.tapshot && <div class="meter"><span>{t('ui.selection.meter.tapshot')}</span><Bar kind="energy" value={hot.tap}/><Num value={hot.tap} format={fmtPct}/></div>}<div class="stats">{(['dps', 'range', 'speed', 'vision', 'buildPower', 'regen'] as const).map((stat) => <span key={stat}>{t(`ui.selection.stat.${stat === 'buildPower' ? 'bp' : stat}`)} <b>{fmtDec(d.stats[stat], 1)}</b></span>)}</div></div><OrderQueue /></div>;
}
export function SelectionGroups() {
    const m = useHud(), c = useCommands(), root = useRef<HTMLDivElement>(null), multi = m.selection.multi.value;
    useLayoutEffect(() => effect(() => {
        const stats = m.selection.multiStats.value, focus = m.selection.focusTypeId.value;
        root.current?.querySelectorAll<HTMLButtonElement>('.tile[data-type]').forEach((el, i) => {
            el.style.setProperty('--v', String(stats?.groupHp[i] ?? 1));
            el.style.setProperty('--vet', JSON.stringify('◆'.repeat(stats?.groupVet[i] ?? 0)));
            el.classList.toggle('is-focus', el.dataset.type === focus);
            const text = el.querySelector('.tile__dmg');
            const value = (stats?.groupDamaged[i] ?? 0) > 0 ? t('ui.selection.tileDamaged', { n: stats!.groupDamaged[i]! }) : '';
            if (text && text.textContent !== value)
                text.textContent = value;
        });
    }), [m, multi]);
    return <div class="tiles" ref={root} data-component="SelectionGroups" data-testid="selection-groups" onKeyDown={(e) => { if (e.key === 'Tab' && multi) {
        const next = nextFocusType(multi.groups, m.selection.focusTypeId.peek(), e.shiftKey);
        if (next) {
            e.preventDefault();
            c.focusType(next);
        }
    } }}>{multi?.groups.slice(0, 24).map((g) => <button class="tile" key={g.typeId} data-type={g.typeId} aria-label={t('ui.selection.tile', { name: unitText(g.typeId, 'name', m.locale.value), n: g.count })} onClick={(e) => { if (e.shiftKey)
        c.deselectType(g.typeId);
    else if (e.ctrlKey || e.metaKey)
        c.selectDamagedOfType(g.typeId);
    else
        c.selectType(g.typeId); }}><StrategicIcon typeId={g.typeId}/><span class="tile__n">{g.count}</span><span class="tile__dmg"/></button>)}{(multi?.groups.length ?? 0) > 24 && <button class="tile is-more" disabled><span>+{multi!.groups.length - 24}</span></button>}</div>;
}
export function SelectionUnits() {
    const m = useHud(), c = useCommands(), root = useRef<HTMLDivElement>(null), multi = m.selection.multi.value;
    useLayoutEffect(() => effect(() => {
        const stats = m.selection.multiStats.value;
        root.current?.querySelectorAll<HTMLButtonElement>('.unit').forEach((el, i) => { const hp = stats?.unitHp[i] ?? 1; el.style.setProperty('--v', String(hp)); el.classList.toggle('is-warn', hpLevel(hp) === 'warn'); el.classList.toggle('is-crit', hpLevel(hp) === 'crit'); });
    }), [m, multi]);
    return <div class="units" ref={root} data-component="SelectionUnits" data-testid="selection-units">{multi?.units.slice(0, 60).map((u) => <button class={`unit ${iconMaskClass(iconOf(u.typeId) ?? '')}`} key={u.handle} aria-label={t('ui.selection.unit', { name: unitText(u.typeId, 'name', m.locale.value) })} onClick={(e) => c.selectUnit(u.handle, clickModsFromEvent(e))} onContextMenu={(e) => { e.preventDefault(); c.selectUnit(u.handle, clickModsFromEvent(e)); }}/>)}</div>;
}
function FactoryRemaining() {
    const m = useHud();
    const text = useMemo(() => computed(() => {
        const seconds = m.factory.remainingS.value;
        return seconds === null ? t('ui.factory.remainingUnavailable') : t('ui.factory.remaining', { value: fmtDec(seconds, 1) });
    }), [m]);
    return <span class="num ff-numbox" data-testid="factory-remaining">{text}</span>;
}
export function FactoryQueue() {
    const m = useHud(), c = useCommands(), q = m.factory.queue.value;
    return <div class={`fq ${q?.paused ? 'is-paused' : ''}`} data-component="FactoryQueue" data-testid="factory-queue"><div class="qlist__h">{t('ui.factory.queue')}{q?.paused && <b>{t('ui.factory.paused')}</b>}</div>{q?.current ? <div class="fq__now"><StrategicIcon typeId={q.current.typeId}/><div><b>{unitText(q.current.typeId, 'name', m.locale.value)}</b><Bar kind="build" value={m.factory.progress}/><FactoryRemaining/></div><Num value={m.factory.progress} format={fmtPct}/></div> : <div>{t('ui.factory.idle')}</div>}<div class="fq__list">{q?.blocks.slice(0, 10).map((b, i) => <button class={`fqi ${q.repeat ? 'is-loop' : ''}`} key={i} aria-label={t('ui.factory.block', { name: unitText(b.typeId, 'name', m.locale.value), n: b.count })} onClick={(e) => c.queueAdd(b.typeId, e.shiftKey ? 5 : 1, e.ctrlKey || e.metaKey)} onContextMenu={(e) => { e.preventDefault(); c.queueRemove(b.typeId, e.shiftKey ? 5 : 1); }}><StrategicIcon typeId={b.typeId}/><b>{b.count}</b></button>)}{(q?.blocks.length ?? 0) > 10 && <span>+{q!.blocks.length - 10}</span>}{!q?.blocks.length && <span>{t('ui.factory.empty')}</span>}</div><div class="fq__ctl"><Button size="sm" class={q?.repeat ? 'is-on' : ''} onClick={() => c.toggleRepeat()}>{t('ui.factory.ctl.repeat')}</Button><Button size="sm" class={q?.paused ? 'is-on' : ''} onClick={() => c.togglePauseProduction()}>{t('ui.factory.ctl.pause')}</Button><Button size="sm" onClick={() => c.armRally()}>{t('ui.factory.ctl.rally')}</Button><Button size="sm" onClick={() => c.clearQueue()}>{t('ui.factory.ctl.clear')}</Button></div></div>;
}
export function FactoryDetail() {
    const m = useHud();
    const shape = useMemo(() => computed(() => factoryStructureKey(m.factory.detail.value)), [m]);
    void shape.value;
    const d = m.factory.detail.peek();
    const hp = useMemo(() => computed(() => { const x = m.factory.detail.value; return x ? x.hp / x.hpMax : 0; }), [m]);
    if (!d)
        return null;
    return <div class="sel__body sel__body--factory" data-component="FactoryDetail" data-testid="factory-detail"><div class="portrait"><StrategicIcon typeId={d.typeId}/></div><div class="uinfo"><div class="uinfo__name"><b>{d.factoryCount > 1 ? tn('ui.factory.count', d.factoryCount) : unitText(d.typeId, 'name', m.locale.value)}</b></div><Bar kind="hp" value={hp}/><div>{t('ui.factory.bp')} {d.bpOwn} + {d.bpAssist} = {d.bpOwn + d.bpAssist}</div><div>{t('ui.factory.helpers')}: {d.helpers.map((x) => `${unitText(x.typeId, 'short', m.locale.value)} ×${x.count}`).join(', ')}</div><div>{t('ui.factory.adjacency')}: {fmtPct(d.adjacencyPct / 100)}</div><div>{t('ui.factory.rally')}: {t(`ui.factory.rally.${d.rally}`)}</div></div><FactoryQueue /></div>;
}
export function SelectionPanel() {
    const m = useHud(), kind = m.selection.kind.value;
    const sums = useMemo(() => computed(() => { const s = m.selection.multiStats.value; return s ? `${t('ui.selection.sum.dps')} ${fmtInt(s.sumDps)} · ${t('ui.selection.sum.mass')} ${fmtInt(s.sumMass)} · ${t('ui.selection.sum.hp')} ${fmtDec(s.avgHpPct, 0)}% · ${t('ui.selection.sum.speed')} ${fmtDec(s.slowestSpeed, 1)}` : ''; }), [m]);
    return <Panel component="SelectionPanel" testId="selection-panel" panelId="selection" class="sel"><PanelHead title={t('ui.selection.title')} end={m.selection.groupLabel.value ?? undefined}/>{kind === 'none' ? <div class="sel__body"><b>{t('ui.selection.help.title')}</b><span>{t('ui.selection.help.click')}</span><span><Key>{'H'}</Key> {t('ui.selection.help.commander')} · <Key>{'.'}</Key> {t('ui.selection.help.idle')} · <Key>{'Ctrl+A'}</Key> {t('ui.selection.help.all')}</span></div> : kind === 'single' ? <UnitDetail /> : kind === 'factory' ? <FactoryDetail /> : <div class="sel__body sel__body--multi"><SelectionGroups /><SelectionUnits /><div class="sumrow">{sums}</div></div>}</Panel>;
}
