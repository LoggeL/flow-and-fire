import { useHud, useCommands } from '../../model/index.ts';
import { validateSkirmish, swapStart, SKIRMISH_COLORS } from '../../model/menus/skirmish.ts';
import type { SkirmishConfig, SkirmishMap, SkirmishSlot } from '../../model/menus/skirmish.ts';
import { tDynamic as t } from '../../i18n/t.ts';
import { Button, Panel, PanelHead, Select, Range, Switch } from '../../ui/index.ts';
import { fmtDec, fmtInt } from '../../format/index.ts';
import { MenuShell } from '../shared/Shell.tsx';
import type { ComponentChildren } from 'preact';
import './skirmish.css';

const SLOT_COLORS: Readonly<Record<string, string>> = {
  blue: 'var(--team-blau)',
  red: 'var(--team-rot)',
  green: 'var(--team-gruen)',
  orange: 'var(--team-orange)',
};
const slotColor = (color: string) => SLOT_COLORS[color] ?? 'var(--neutral-blip)';

export function MapPreview({ map, onStart, slots, compact = false }: {
  readonly map: SkirmishMap;
  readonly onStart?: (n: number) => void;
  readonly slots?: readonly SkirmishSlot[];
  readonly compact?: boolean;
}) {
  // Relief and overlays come from the actual map records. Loading retains its relation-color fallback.
  const colorAt = (i: number) => slots
    ? slotColor(slots.find(slot => slot.start === i)?.color ?? '')
    : i === 0 ? 'var(--team-self)' : 'var(--team-enemy)';
  const relief = <svg class="map-svg" viewBox="0 0 300 300" role={compact ? undefined : 'img'} aria-hidden={compact ? true : undefined} aria-label={compact ? undefined : map.name}>
    <path d="M0 0H300V300H0Z" fill="#1d2420"/>
    {map.previewUrl && <image href={map.previewUrl} x="0" y="0" width="300" height="300" preserveAspectRatio="xMidYMid meet"/>}
    {!compact && (map.spotPositions ?? []).map((spot, i) => spot.kind === 'mass'
      ? <circle key={i} cx={spot.x * 300} cy={spot.z * 300} r="3.2" fill="var(--res-mass, #a5d942)" stroke="#0b100d" stroke-width="1"/>
      : <path key={i} d={`M${spot.x * 300} ${spot.z * 300 - 5}l5 5-5 5-5-5z`} fill="#3fd6ef" stroke="#0b100d" stroke-width="1"/>)}
    {!compact && !onStart && map.startPositions.map(([x, y], i) => <g key={i}>
      <circle cx={x * 300} cy={y * 300} r="12" fill={colorAt(i)}/>
      <text x={x * 300} y={y * 300 + 4} text-anchor="middle" fill="white">{i + 1}</text>
    </g>)}
  </svg>;
  if (!onStart || compact) return relief;
  return <div class="skirmish-map-relief" data-testid="skirmish-map-preview">
    {relief}
    {map.startPositions.map(([x, y], i) => {
      const occupant = slots?.find(slot => slot.start === i);
      const selected = occupant?.controller === 'human';
      return <button key={i} type="button" class="map-start" aria-label={t('ui.skirmish.startPosition', { n: i + 1 })}
        aria-pressed={selected} data-testid={`skirmish-start-${i}`} data-color={occupant?.color ?? 'unused'}
        data-occupied={Boolean(occupant)} data-slot={occupant?.index} data-selected={selected}
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, '--start-color': colorAt(i) }}
        onClick={() => onStart(i)}>{i + 1}</button>;
    })}
  </div>;
}

export function SkirmishSetup({ logo }: { readonly logo?: ComponentChildren } = {}) {
  const m = useHud(), c = useCommands(), s = m.menus.skirmish;
  const map = s.maps.value.find(x => x.id === s.selectedMap.value);
  const cfg: SkirmishConfig = { mapId: s.selectedMap.value, slots: s.slots.value, rules: s.rules.value };
  const error = validateSkirmish(cfg, s.maps.value) ?? (s.validation.value.state === 'error' ? s.validation.value.message : null);
  const patchSlot = (slot: SkirmishSlot, patch: Partial<SkirmishSlot>) => c.updateSkirmish({ slots: s.slots.value.map(x => x.index === slot.index ? { ...x, ...patch } : x) });
  const ruleSelect = (key: 'victory' | 'fog' | 'teamColors') => {
    const label = t(key === 'teamColors' ? 'ui.skirmish.teams' : `ui.skirmish.${key}`);
    const choices = key === 'victory' ? ['assassination', 'supremacy', 'annihilation'] : key === 'fog' ? ['explore', 'revealed'] : ['house', 'relation', 'cvd'];
    return <label class="skirmish-field" key={key}><span>{label}</span>
      <Select label={label} value={s.rules.value[key]} options={choices.map(value => ({ value, label: t(`ui.skirmish.${value}`) }))}
        onChange={value => c.updateSkirmish({ rules: { ...s.rules.value, [key]: value } })}/>
    </label>;
  };
  return <MenuShell title={t('ui.skirmish.title')} component="SkirmishSetup" language={false} headerAside={logo} footer={<>
    <span class={`skirmish-status${error ? ' is-error' : ''}`} role="status" data-testid="skirmish-status">
      {error ? t(error) : t(s.validation.value.state === 'checking' ? 'ui.skirmish.checking' : 'ui.skirmish.ready')}
    </span>
    <Button variant="primary" testId="skirmish-start" disabled={Boolean(error) || s.validation.value.state !== 'ok'} onClick={() => c.startSkirmish(cfg)}>{t('ui.skirmish.start')}</Button>
  </>}>
    <main class="skirmish-lobby" onKeyDown={(e) => {
      if (e.key === 'Enter' && e.target === e.currentTarget && !error && s.validation.value.state === 'ok') c.startSkirmish(cfg);
    }}>
      <Panel class="skirmish-map-area" testId="skirmish-map-area" label={t('ui.skirmish.maps')}>
        <PanelHead title={t('ui.skirmish.maps')}/>
        {map && <div class="skirmish-selected-map">
          <h2>{map.name}</h2>
          <MapPreview map={map} slots={s.slots.value} onStart={(n) => c.updateSkirmish({ slots: swapStart(s.slots.value, 0, n) })}/>
          <p class="skirmish-map-stats">{t('ui.skirmish.mapStats', { size: fmtInt(map.sizeWu), starts: map.starts, mass: map.massSpots })}</p>
        </div>}
        <div class="skirmish-map-list">
          {s.maps.value.map(x => <button key={x.id} type="button" class={`skirmish-map-item${x.id === cfg.mapId ? ' is-selected' : ''}`}
            data-testid={`skirmish-map-${x.id}`} aria-pressed={x.id === cfg.mapId} disabled={!x.available} onClick={() => c.updateSkirmish({ mapId: x.id })}>
            <MapPreview map={x} compact/>
            <span><b>{x.name}</b><small>{t('ui.skirmish.mapSize', { size: fmtInt(x.sizeWu) })}</small></span>
          </button>)}
        </div>
      </Panel>
      <div class="skirmish-config">
        <Panel class="skirmish-players" testId="skirmish-players" label={t('ui.skirmish.houses')}>
          <PanelHead title={t('ui.skirmish.houses')}/>
          <div class="skirmish-slots">{s.slots.value.map(slot => <div class="skirmish-slot" key={slot.index} data-testid={`skirmish-slot-${slot.index}`} style={{ '--slot-color': slotColor(slot.color) }}>
            <div class="skirmish-slot-identity"><span class="skirmish-slot-number">{slot.index + 1}</span><span class="skirmish-slot-name"><b>{slot.name}</b><small>{t(`ui.skirmish.${slot.faction}`)}</small></span></div>
            <div class="skirmish-slot-fields">
              <label class="skirmish-field"><span>{t('ui.skirmish.color')}</span><Select label={t('ui.skirmish.color')} value={slot.color} options={SKIRMISH_COLORS.map(x => ({ value: x, label: t(`ui.skirmish.${x}`) }))} onChange={color => patchSlot(slot, { color })}/></label>
              <label class="skirmish-field"><span>{t('ui.skirmish.team')}</span><Select label={t('ui.skirmish.team')} value={String(slot.team)} options={s.slots.value.map((_, team) => ({ value: String(team), label: String(team + 1) }))} onChange={v => patchSlot(slot, { team: Number(v) })}/></label>
              {slot.ai && <label class="skirmish-field"><span>{t('ui.skirmish.difficulty')}</span><Select label={t('ui.skirmish.difficulty')} value={slot.ai.difficulty} options={(['easy', 'normal', 'hard'] as const).map(value => ({ value, label: t(`ui.skirmish.${value}`) }))} onChange={difficulty => patchSlot(slot, { ai: { ...slot.ai!, difficulty } })}/></label>}
            </div>
            {slot.ai && <details class="skirmish-details skirmish-ai-options" data-testid={`skirmish-ai-options-${slot.index}`}>
              <summary>{t('ui.skirmish.aiOptions')}</summary>
              <div class="skirmish-details-body">
                <div class="skirmish-bonus-toggle"><span>{t('ui.skirmish.aixLabel')}</span><Switch label={t('ui.skirmish.aixLabel')} on={slot.ai.aix} onChange={aix => patchSlot(slot, { ai: { ...slot.ai!, aix } })}/><span class="skirmish-value">{slot.ai.aix ? `×${fmtDec(slot.ai.aixFactor, 1)}` : t('ui.skirmish.aixOff')}</span></div>
                {slot.ai.aix && <label class="skirmish-field skirmish-range-field"><span>{t('ui.skirmish.aixFactor')}<output>×{fmtDec(slot.ai.aixFactor, 1)}</output></span><Range label={t('ui.skirmish.aixFactor')} value={slot.ai.aixFactor} min={1} max={2} step={.1} onChange={aixFactor => patchSlot(slot, { ai: { ...slot.ai!, aixFactor } })}/></label>}
                <p class="skirmish-profile">{t('ui.skirmish.profileText')}</p>
              </div>
            </details>}
          </div>)}</div>
        </Panel>
        <Panel class="skirmish-rules" label={t('ui.skirmish.rules')}>
          <PanelHead title={t('ui.skirmish.rules')}/>
          <div class="skirmish-essential-options" data-testid="skirmish-essential-options">{ruleSelect('victory')}{ruleSelect('fog')}</div>
          <details class="skirmish-details skirmish-advanced-options" data-testid="skirmish-advanced-options">
            <summary>{t('ui.skirmish.moreOptions')}</summary>
            <div class="skirmish-details-body">
              {ruleSelect('teamColors')}
              <label class="skirmish-field skirmish-range-field"><span>{t('ui.skirmish.cap')}<output>{fmtInt(s.rules.value.unitCap)}</output></span><Range label={t('ui.skirmish.cap')} value={s.rules.value.unitCap} min={50} max={5000} step={50} onChange={unitCap => c.updateSkirmish({ rules: { ...s.rules.value, unitCap } })}/></label>
              <label class="skirmish-field skirmish-range-field"><span>{t('ui.skirmish.speed')}<output>×{fmtDec(s.rules.value.startSpeed, 2)}</output></span><Range label={t('ui.skirmish.speed')} value={s.rules.value.startSpeed} min={.25} max={3} step={.25} onChange={startSpeed => c.updateSkirmish({ rules: { ...s.rules.value, startSpeed } })}/></label>
            </div>
          </details>
        </Panel>
      </div>
    </main>
  </MenuShell>;
}
