/**
 * Skirmish setup (ui.md §5.15, A3; markup after docs/design/ui-mockups/skirmish.html). Three columns:
 * map list with thumbnails, description and AI profile · large preview with resource points and numbered
 * starts (click swaps the start) · houses (slot, name, faction, colour, team; AI level + AIx switch and
 * slider ×1.0–×2.0) and rules (victory condition, unit cap, start speed, fog, team colour mode with preview).
 * Footer: check status, validation problems, "Zurück", "Gefecht starten" (ember, Enter). Every change goes
 * out as updateSkirmish(patch); invalid configurations block the start.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fmtDec, fmtInt } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud } from '../../model/index.ts';
import {
  AIX_MAX,
  AIX_MIN,
  AI_DIFFICULTIES,
  FOG_MODES,
  SEED_MAX,
  SKIRMISH_TEAMS,
  START_SPEEDS,
  UNIT_CAPS,
  VICTORY_CONDITIONS,
  canStartSkirmish,
  clampAix,
  compassOf,
  mapKm,
  parseSeed,
  skirmishConfig,
  swapStart,
  validateSkirmish,
} from '../../model/menus/skirmish.ts';
import type {
  AiDifficulty,
  FogMode,
  SkirmishMap,
  SkirmishProblem,
  SkirmishRules,
  SkirmishSlot,
  SkirmishValidation,
  TeamColorMode,
  VictoryCondition,
} from '../../model/menus/skirmish.ts';
import { HOUSE_COLORS, TEAM_COLOR_MODES, teamColorCss } from '../../model/menus/teams.ts';
import type { TeamRelation } from '../../model/menus/teams.ts';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { Input } from '../../ui/Input.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { Panel, PanelHead } from '../../ui/Panel.tsx';
import { Range } from '../../ui/Range.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Select } from '../../ui/Select.tsx';
import { Switch } from '../../ui/Switch.tsx';
import { focusSibling } from '../../ui/Tab.tsx';
import { isFieldTarget, useInitialFocus } from '../shared/focus.ts';
import {
  aiLevelLabel,
  colorName,
  compassLabel,
  dataText,
  factorText,
  houseLabel,
  teamModeLabel,
  victoryHint,
  victoryLabel,
} from '../shared/labels.ts';
import { MapPreview, MapThumb, MenuBackground } from '../shared/MapCanvas.tsx';
import type { StartMarker } from '../shared/MapCanvas.tsx';

const PROBLEM_KEY: Readonly<Record<SkirmishProblem['code'], MsgKey>> = {
  mapMissing: 'ui.skirmish.problem.mapMissing',
  mapUnavailable: 'ui.skirmish.problem.mapUnavailable',
  noHuman: 'ui.skirmish.problem.noHuman',
  sameColor: 'ui.skirmish.problem.sameColor',
  sameStart: 'ui.skirmish.problem.sameStart',
  startOutOfRange: 'ui.skirmish.problem.startOutOfRange',
  sameTeam: 'ui.skirmish.problem.sameTeam',
  aixRange: 'ui.skirmish.problem.aixRange',
  unitCap: 'ui.skirmish.problem.unitCap',
  seed: 'ui.skirmish.problem.seed',
};

const PROFILE: Readonly<Record<AiDifficulty, { readonly reaction: MsgKey; readonly micro: MsgKey; readonly expect: MsgKey }>> = {
  easy: { reaction: 'ui.skirmish.profile.easy.reaction', micro: 'ui.skirmish.profile.easy.micro', expect: 'ui.skirmish.profile.easy.expect' },
  normal: { reaction: 'ui.skirmish.profile.normal.reaction', micro: 'ui.skirmish.profile.normal.micro', expect: 'ui.skirmish.profile.normal.expect' },
  hard: { reaction: 'ui.skirmish.profile.hard.reaction', micro: 'ui.skirmish.profile.hard.micro', expect: 'ui.skirmish.profile.hard.expect' },
};

const FOG_KEY: Readonly<Record<FogMode, MsgKey>> = { explore: 'ui.skirmish.fog.explore', revealed: 'ui.skirmish.fog.revealed' };

/** Relation of a slot to the local (first human) house. */
function relationOf(slots: readonly SkirmishSlot[], i: number): TeamRelation {
  const me = slots.find((s) => s.controller === 'human');
  const s = slots[i];
  if (!s || !me || s === me) return 'self';
  return s.team === me.team ? 'ally' : 'enemy';
}

/** CSS colour of slot i in the lobby's team colour mode. */
export function slotColor(slots: readonly SkirmishSlot[], i: number, mode: TeamColorMode): string {
  const s = slots[i];
  return teamColorCss(mode, s?.color ?? 'team-blau', i, relationOf(slots, i));
}

function MapList({ maps, selected, onSelect }: { readonly maps: readonly SkirmishMap[]; readonly selected: string; readonly onSelect: (id: string) => void }): JSX.Element {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (focusSibling(e.currentTarget as HTMLElement, '.mapitem', document.activeElement, e.key)) e.preventDefault();
  };
  return (
    <Panel component="MapList" testId="map-list" panelId="sk-maps" label={t('ui.skirmish.mapList')}>
      <PanelHead title={t('ui.skirmish.maps')} end={fmtInt(maps.length)} />
      <div class="maplist" role="listbox" aria-label={t('ui.skirmish.mapList')} onKeyDown={onKeyDown}>
        {maps.map((m) => {
          const note = m.available ? undefined : dataText(m.note ?? 'ui.skirmish.mapLocked');
          const title = m.available ? undefined : m.note === 'ui.skirmish.mapNote.m8' ? t('ui.skirmish.mapNote.m8.title') : note;
          return (
            <button
              key={m.id}
              type="button"
              role="option"
              class={cx('mapitem', m.id === selected && 'is-selected', !m.available && 'is-disabled')}
              aria-selected={m.id === selected}
              aria-disabled={!m.available || undefined}
              title={title}
              onClick={() => {
                if (m.available && m.id !== selected) onSelect(m.id);
              }}
              data-testid={`map-${m.id}`}
            >
              <MapThumb spec={m.preview} />
              <div>
                <b>{m.name}</b>
                <small>
                  {m.available
                    ? t('ui.skirmish.mapMeta', { size: fmtInt(m.sizeWu), km: mapKm(m.sizeWu), starts: m.starts, mex: m.massSpots })
                    : note}
                </small>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function AiProfile({ slot }: { readonly slot: SkirmishSlot | undefined }): JSX.Element {
  const ai = slot?.ai ?? null;
  return (
    <Panel component="AiProfile" testId="ai-profile" panelId="sk-profile">
      <PanelHead
        title={ai ? t('ui.skirmish.profile.title', { level: aiLevelLabel(ai.difficulty) }) : t('ui.skirmish.profile.title', { level: '–' })}
        end={ai ? (ai.aix ? t('ui.skirmish.profile.aix', { factor: fmtDec(ai.aixFactor, 1) }) : t('ui.skirmish.profile.noAix')) : undefined}
      />
      <div class="card-m__body sk-desc">
        {ai ? (
          <div class="sk-profile">
            <span class="ff-lo">{t('ui.skirmish.profile.reaction')}</span>
            <span>{t(PROFILE[ai.difficulty].reaction)}</span>
            <span class="ff-lo">{t('ui.skirmish.profile.micro')}</span>
            <span>{t(PROFILE[ai.difficulty].micro)}</span>
            <span class="ff-lo">{t('ui.skirmish.profile.cheat')}</span>
            <span>{t('ui.skirmish.profile.cheatValue')}</span>
            <span class="ff-lo">{t('ui.skirmish.profile.expect')}</span>
            <span>{t(PROFILE[ai.difficulty].expect)}</span>
          </div>
        ) : (
          <span>{t('ui.skirmish.profile.none')}</span>
        )}
      </div>
    </Panel>
  );
}

interface ColorPickerProps {
  readonly slot: SkirmishSlot;
  readonly slots: readonly SkirmishSlot[];
  readonly css: string;
  readonly onPick: (token: string) => void;
}

/** Swatch button with a small radio grid of the eight house colours (taken colours are marked). */
function ColorPicker({ slot, slots, css, onPick }: ColorPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) grid.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      if (focusSibling(e.currentTarget as HTMLElement, '[role="radio"]', document.activeElement, e.key)) e.preventDefault();
    }
  };
  const house = slot.name;
  return (
    <div class="sk-picker">
      <button
        ref={button}
        type="button"
        class="swatch"
        style={{ '--team': css }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('ui.skirmish.slot.color', { house, color: colorName(slot.color) })}
        title={t('ui.skirmish.slot.color', { house, color: colorName(slot.color) })}
        onClick={() => setOpen(!open)}
        data-testid={`slot-${slot.index}-color`}
        data-color={slot.color}
      />
      {open ? (
        <div ref={grid} class="sk-swatches" role="radiogroup" aria-label={t('ui.skirmish.slot.colors', { house })} onKeyDown={onKeyDown} data-testid={`slot-${slot.index}-colors`}>
          {HOUSE_COLORS.map((c) => {
            const taken = slots.some((o) => o !== slot && o.color === c.token);
            return (
              <button
                key={c.token}
                type="button"
                role="radio"
                aria-checked={c.token === slot.color}
                tabIndex={c.token === slot.color ? 0 : -1}
                class={cx(taken && 'is-taken')}
                style={{ '--team': `var(--${c.token})` }}
                aria-label={colorName(c.token)}
                title={colorName(c.token)}
                onClick={() => {
                  onPick(c.token);
                  close(true);
                }}
                data-testid={`color-${c.token}`}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface SlotRowProps {
  readonly slot: SkirmishSlot;
  readonly i: number;
  readonly slots: readonly SkirmishSlot[];
  readonly map: SkirmishMap | undefined;
  readonly mode: TeamColorMode;
  readonly invalid: boolean;
  readonly onChange: (next: SkirmishSlot) => void;
}

function SlotRow({ slot, i, slots, map, mode, invalid, onChange }: SlotRowProps): JSX.Element {
  const pos = map?.startPositions[slot.start];
  const region = pos ? compassLabel(compassOf(pos[0], pos[1])) : '–';
  const css = slotColor(slots, i, mode);
  const house = slot.name;
  const ai = slot.ai;
  return (
    <div
      class={cx('slot', ai && 'slot--ai', invalid && 'is-invalid')}
      style={{ '--team': css }}
      data-testid={`slot-${slot.index}`}
      data-controller={slot.controller}
      aria-invalid={invalid || undefined}
    >
      <span class="slot__n" title={t('ui.skirmish.slot.start', { n: slot.start + 1, region })}>
        {slot.start + 1}
      </span>
      <div class="slot__who">
        <b>{houseLabel(house)}</b>
        <small>
          <LineIcon name={slot.controller === 'human' ? 'user' : 'cpu'} />
          {t(slot.controller === 'human' ? 'ui.skirmish.slot.you' : 'ui.skirmish.slot.ai')} · {t('ui.skirmish.slot.start', { n: slot.start + 1, region })}
        </small>
      </div>
      <Select
        label={t('ui.skirmish.slot.faction', { house })}
        value={slot.faction}
        options={[{ value: 'varkan', label: t('ui.skirmish.faction.varkan') }]}
        onChange={(faction) => onChange({ ...slot, faction })}
        testId={`slot-${slot.index}-faction`}
      />
      <ColorPicker slot={slot} slots={slots} css={css} onPick={(color) => onChange({ ...slot, color })} />
      <Select
        label={t('ui.skirmish.slot.team', { house })}
        value={String(slot.team)}
        options={SKIRMISH_TEAMS.map((n) => ({ value: String(n), label: t('ui.skirmish.team', { n }) }))}
        onChange={(v) => onChange({ ...slot, team: Number(v) })}
        testId={`slot-${slot.index}-team`}
      />
      {ai ? (
        <div class="slot__ai">
          <span>{t('ui.skirmish.slot.level')}</span>
          <Segmented
            label={t('ui.skirmish.slot.levelOf', { house })}
            value={ai.difficulty}
            options={AI_DIFFICULTIES.map((d) => ({ value: d, label: aiLevelLabel(d) }))}
            onChange={(difficulty) => onChange({ ...slot, ai: { ...ai, difficulty } })}
            testId={`slot-${slot.index}-level`}
          />
          <div class={cx('aix', !ai.aix && 'is-off')} title={t('ui.skirmish.aix.title')}>
            <Switch
              on={ai.aix}
              label={t('ui.skirmish.aix.switch', { house })}
              onChange={(aix) => onChange({ ...slot, ai: { ...ai, aix } })}
              testId={`slot-${slot.index}-aix`}
            />
            <span>{t('ui.skirmish.aix')}</span>
            <Range
              value={Math.round(ai.aixFactor * 10)}
              min={AIX_MIN * 10}
              max={AIX_MAX * 10}
              step={1}
              disabled={!ai.aix}
              label={t('ui.skirmish.aix.factor', { house })}
              valueText={factorText(ai.aixFactor)}
              onChange={(v) => onChange({ ...slot, ai: { ...ai, aixFactor: clampAix(v / 10) } })}
              testId={`slot-${slot.index}-aix-factor`}
            />
            <b class="num" data-testid={`slot-${slot.index}-aix-value`}>
              {factorText(ai.aixFactor)}
            </b>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RulesPanel({ rules, onChange }: { readonly rules: SkirmishRules; readonly onChange: (next: SkirmishRules) => void }): JSX.Element {
  const selfCss = teamColorCss(rules.teamColors, 'team-blau', 0, 'self');
  const enemyCss = teamColorCss(rules.teamColors, 'team-rot', 1, 'enemy');
  return (
    <Panel component="SkirmishRules" testId="skirmish-rules" panelId="sk-rules" label={t('ui.skirmish.rules')}>
      <PanelHead title={t('ui.skirmish.rules')} />
      <div class="opts">
        <div class="ff-field wide">
          <span class="ff-label">{t('ui.skirmish.victory')}</span>
          <Segmented<VictoryCondition>
            label={t('ui.skirmish.victory')}
            value={rules.victory}
            options={VICTORY_CONDITIONS.map((v) => ({ value: v, label: victoryLabel(v) }))}
            onChange={(victory) => onChange({ ...rules, victory })}
            testId="rule-victory"
          />
          <span class="hintline" data-testid="rule-victory-hint">
            {victoryHint(rules.victory)}
          </span>
        </div>
        <label class="ff-field">
          <span class="ff-label">{t('ui.skirmish.unitCap')}</span>
          <Select
            label={t('ui.skirmish.unitCap')}
            value={String(rules.unitCap)}
            options={UNIT_CAPS.map((c) => ({ value: String(c), label: fmtInt(c) }))}
            onChange={(v) => onChange({ ...rules, unitCap: Number(v) })}
            testId="rule-unit-cap"
          />
        </label>
        <label class="ff-field">
          <span class="ff-label">{t('ui.skirmish.startSpeed')}</span>
          <Select
            label={t('ui.skirmish.startSpeed')}
            value={String(rules.startSpeed)}
            options={START_SPEEDS.map((s) => ({ value: String(s), label: t('ui.skirmish.speed', { value: fmtDec(s, 1) }) }))}
            onChange={(v) => onChange({ ...rules, startSpeed: Number(v) })}
            testId="rule-speed"
          />
        </label>
        <label class="ff-field">
          <span class="ff-label">{t('ui.skirmish.fog')}</span>
          <Select<FogMode>
            label={t('ui.skirmish.fog')}
            value={rules.fog}
            options={FOG_MODES.map((f) => ({ value: f, label: t(FOG_KEY[f]) }))}
            onChange={(fog) => onChange({ ...rules, fog })}
            testId="rule-fog"
          />
        </label>
        <label class="ff-field">
          <span class="ff-label">{t('ui.skirmish.teamColors')}</span>
          <Select<TeamColorMode>
            label={t('ui.skirmish.teamColors')}
            value={rules.teamColors}
            options={TEAM_COLOR_MODES.map((m) => ({ value: m, label: teamModeLabel(m) }))}
            onChange={(teamColors) => onChange({ ...rules, teamColors })}
            testId="rule-team-colors"
          />
          <span class="sk-teamprev" role="img" aria-label={t('ui.skirmish.teams.preview')} data-testid="rule-team-preview">
            <i style={{ '--team': selfCss }} />
            <i style={{ '--team': enemyCss }} />
          </span>
        </label>
      </div>
    </Panel>
  );
}

function CheckStatus({ check, problems }: { readonly check: SkirmishValidation; readonly problems: readonly SkirmishProblem[] }): JSX.Element {
  const checkText =
    check.state === 'ok'
      ? t('ui.skirmish.check.ok', { simId: check.simId })
      : check.state === 'checking'
        ? t('ui.skirmish.check.checking')
        : t('ui.skirmish.check.error', { message: dataText(check.message ?? '') });
  return (
    <div class="startbar" data-testid="skirmish-check">
      <span
        class={cx('check', check.state === 'error' && 'is-error', check.state === 'checking' && 'is-pending')}
        data-state={check.state}
        data-testid="skirmish-check-state"
      >
        <LineIcon name={check.state === 'ok' ? 'ok' : check.state === 'error' ? 'crit' : 'timer'} />
        {checkText}
      </span>
      {problems.length > 0 ? (
        <ul class="sk-problems" role="alert" aria-label={t('ui.skirmish.problems')} data-testid="skirmish-problems">
          {problems.map((p) => (
            <li key={p.code} data-code={p.code}>
              <LineIcon name="crit" />
              {t(PROBLEM_KEY[p.code])}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function SkirmishSetup(): JSX.Element {
  const model = useHud();
  const cmd = useCommands();
  const s = model.menus.skirmish;
  const maps = s.maps.value;
  const mapId = s.selectedMap.value;
  const slots = s.slots.value;
  const rules = s.rules.value;
  const check = s.validation.value;
  const map = maps.find((m) => m.id === mapId);
  const config = skirmishConfig(s);
  const problems = validateSkirmish(config, maps);
  const startOk = canStartSkirmish(problems, check);
  const invalidSlots = new Set(problems.flatMap((p) => p.slots));
  const mode = rules.teamColors;
  const [seedText, setSeedText] = useState(String(rules.seed));
  const [seedBad, setSeedBad] = useState(false);
  useEffect(() => {
    setSeedText(String(rules.seed));
    setSeedBad(false);
  }, [rules.seed]);
  const startRef = useRef<HTMLButtonElement>(null);
  useInitialFocus(startRef);

  const setSlot = (i: number, next: SkirmishSlot): void => cmd.updateSkirmish({ slots: slots.map((o, j) => (j === i ? next : o)) });
  const start = (): void => {
    if (startOk) cmd.startSkirmish(skirmishConfig(s));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cmd.navigate('main');
    } else if (e.key === 'Enter' && !isFieldTarget(e.target) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      start();
    }
  };

  const markers: StartMarker[] = (map?.startPositions ?? []).map(([x, y], index) => {
    const holder = slots.findIndex((sl) => sl.start === index);
    const sl = slots[holder];
    const label = sl
      ? t(sl.controller === 'human' ? 'ui.skirmish.start.self' : 'ui.skirmish.start.ai', { n: index + 1, house: sl.name })
      : t('ui.skirmish.start.free', { n: index + 1 });
    return { index, x, y, color: sl ? slotColor(slots, holder, mode) : null, label };
  });
  const humanIndex = Math.max(0, slots.findIndex((sl) => sl.controller === 'human'));
  const aiSlot = slots.find((sl) => sl.ai !== null);
  const [a, b] = [slots[0]?.start ?? 0, slots[1]?.start ?? 0];

  return (
    <div class="menu-page" data-component="SkirmishSetup" data-testid="skirmish-setup" data-teams-preview={mode} onKeyDown={onKeyDown}>
      <MenuBackground seed={41} view={[0.1, 0.3, 0.9, 0.7]} />
      <div class="menu-root">
        <div class="menu-top">
          <Button variant="ghost" size="icon" icon="exit" label={t('ui.skirmish.back')} onClick={() => cmd.navigate('main')} testId="skirmish-back-icon" />
          <h1>{t('ui.skirmish.title')}</h1>
          <span class="crumb">{t('ui.skirmish.crumb')}</span>
          <div class="sp">
            <span class="hintline">{t('ui.skirmish.seed')}</span>
            <Input
              class={cx('num sk-seed', seedBad && 'is-invalid')}
              value={seedText}
              label={t('ui.skirmish.seed')}
              invalid={seedBad}
              maxLength={10}
              onInput={(v) => {
                setSeedText(v);
                const seed = parseSeed(v);
                setSeedBad(seed === null);
                if (seed !== null && seed !== rules.seed) cmd.updateSkirmish({ rules: { ...rules, seed } });
              }}
              testId="skirmish-seed"
            />
            {seedBad ? (
              <span class="ff-sr" role="alert">
                {t('ui.skirmish.seedInvalid', { max: fmtInt(SEED_MAX) })}
              </span>
            ) : null}
            <Button size="sm" icon="dice" label={t('ui.skirmish.reroll')} onClick={() => cmd.rerollSeed()} testId="skirmish-reroll" />
          </div>
        </div>

        <div class="lobby">
          <section class="col">
            <MapList maps={maps} selected={mapId} onSelect={(id) => cmd.updateSkirmish({ mapId: id })} />
            <Panel component="MapDescription" testId="map-description" panelId="sk-desc">
              <PanelHead title={t('ui.skirmish.description')} />
              <div class="card-m__body sk-desc">
                <span data-testid="map-description-text">{map ? dataText(map.description) : ''}</span>
                <div class="hintline">{t('ui.skirmish.waterHint')}</div>
              </div>
            </Panel>
            <AiProfile slot={aiSlot} />
          </section>

          <section class="preview">
            <MapPreview
              spec={map?.preview ?? null}
              resources={map?.resources ?? []}
              markers={markers}
              onPick={(start) => {
                const next = swapStart(slots, start, humanIndex);
                if (next !== slots) cmd.updateSkirmish({ slots: next });
              }}
              label={t('ui.skirmish.preview', { map: map?.name ?? '' })}
              testId="skirmish-preview"
            />
            <div class="mapfacts" data-testid="map-facts">
              <span>
                <b class="num">{fmtInt(map?.sizeWu ?? 0)}</b> {t('ui.skirmish.facts.edge')}
              </span>
              <span>
                <b class="num">{fmtInt(map?.massSpots ?? 0)}</b> {t('ui.skirmish.facts.mass')}
              </span>
              <span>
                <b class="num">{fmtInt(map?.hydroSpots ?? 0)}</b> {t('ui.skirmish.facts.hydro')}
              </span>
              <span>
                <b>{t('ui.skirmish.facts.mode')}</b> {t('ui.skirmish.facts.starts', { a: a + 1, b: b + 1 })}
              </span>
            </div>
          </section>

          <section class="col">
            <Panel component="SkirmishHouses" testId="skirmish-houses" panelId="sk-houses" label={t('ui.skirmish.houses')}>
              <PanelHead title={t('ui.skirmish.houses')} end={t('ui.skirmish.housesMeta', { n: slots.length })} />
              <div class="slots">
                {slots.map((sl, i) => (
                  <SlotRow key={sl.index} slot={sl} i={i} slots={slots} map={map} mode={mode} invalid={invalidSlots.has(i)} onChange={(next) => setSlot(i, next)} />
                ))}
                <button type="button" class="slot is-empty" disabled title={t('ui.skirmish.slot.add')} data-testid="slot-add">
                  <span class="slot__n">+</span>
                  <span>{t('ui.skirmish.slot.add')}</span>
                </button>
              </div>
            </Panel>
            <RulesPanel rules={rules} onChange={(next) => cmd.updateSkirmish({ rules: next })} />
          </section>
        </div>

        <div class="menu-foot sk-foot">
          <CheckStatus check={check} problems={problems} />
          <div class="sp">
            <Button onClick={() => cmd.navigate('main')} testId="skirmish-back">
              {t('ui.skirmish.backButton')}
            </Button>
            <button
              ref={startRef}
              type="button"
              class={cx('ff-btn ff-btn--primary ff-btn--lg', !startOk && 'is-disabled')}
              aria-disabled={!startOk || undefined}
              onClick={start}
              data-testid="skirmish-start"
            >
              <LineIcon name="play" />
              {t('ui.skirmish.start')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
