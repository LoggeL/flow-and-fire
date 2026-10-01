import { useHud, useCommands } from '../../model/index.ts';
import { SELECTION_FILTERS } from '../../model/strip.ts';
import { modsFromEvent } from '../../commands/mods.ts';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { t, tn } from '../../i18n/t.ts';
import '../../styles/hud.css';
export function SelectionFilter() {
    const c = useCommands();
    return <div class="filters" data-component="SelectionFilter" data-testid="selection-filter">{SELECTION_FILTERS.map((f, i) => <button class="ff-order" key={f.kind} aria-label={t('ui.strip.filter.label', { name: t(`ui.strip.filter.${f.kind}`), key: f.code })} onClick={(e) => c.filter(f.kind, e.shiftKey)}><span class="ff-order__key">{f.code}</span><LineIcon name={(['f_land', 'f_air', 'f_fac', 'f_eng'] as const)[i] ?? 'move'}/></button>)}<IdleButton /></div>;
}
export function IdleButton() {
    const m = useHud(), c = useCommands(), count = m.strip.idleEngineers.value;
    return <div class="idle" data-component="IdleButton" data-testid="idle-button"><button class="ff-order" aria-label={t('ui.strip.idle.label')} onClick={(e) => c.selectIdleEngineer(e.shiftKey)} onContextMenu={(e) => { e.preventDefault(); c.selectIdleFactory(); }}><LineIcon name="f_eng"/></button>{count > 0 && <span class="idle__n">{count}</span>}</div>;
}
export function ControlGroups() {
    const m = useHud(), c = useCommands();
    return <div class="groups" data-component="ControlGroups" data-testid="control-groups" data-panel="groups">{m.strip.groups.value.map((g, i) => <button class={`grp ${g.count === 0 ? 'is-empty' : ''} ${m.strip.activeGroup.value === i ? 'is-active' : ''}`} key={i} aria-label={t(g.count ? 'ui.strip.group.filled' : 'ui.strip.group.empty', { key: (i + 1) % 10, units: tn('ui.common.units', g.count) })} onClick={(e) => c.recallGroup(i, modsFromEvent(e))} onContextMenu={(e) => { e.preventDefault(); c.saveGroup(i, e.shiftKey); }}><span class="grp__k">{(i + 1) % 10}</span>{g.iconTypeId && <StrategicIcon typeId={g.iconTypeId}/>}{g.count > 0 && <span class="grp__n">{g.count}</span>}</button>)}</div>;
}
