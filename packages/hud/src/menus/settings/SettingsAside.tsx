/**
 * Context card on the right of the settings, one per tab (ui.md §5.15): load estimate (graphics), sound
 * samples (audio), grid per selection (keys), team colour preview with colour-vision simulation
 * (accessibility), string-table note (game & language).
 */
import type { JSX } from 'preact';
import type { UnitCatalog } from '../../data/catalog.ts';
import { mvpUnits, unitText } from '../../data/roster.ts';
import { StrategicIcon, IconSprite } from '../../data/StrategicIcon.tsx';
import { fmtDec, fmtInt } from '../../format/index.ts';
import { orderShort } from '../../hud/card/labels.ts';
import { t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud, useUnitCatalog } from '../../model/index.ts';
import { GRAPHICS_PRESETS, GRAPHICS_PRESETS_ORDER, LOAD_BUDGET, estimateLoad } from '../../model/menus/settings.ts';
import type { FixedPreset, LoadEstimate, SettingsTab, SettingsValues } from '../../model/menus/settings.ts';
import { CVD_COLORS, HOUSE_COLORS, VISION_KINDS, paletteOf, simulateVision, teamColorCss } from '../../model/menus/teams.ts';
import type { TeamColorMode, TeamRelation } from '../../model/menus/teams.ts';
import { orderAtSlot } from '../../model/orders.ts';
import { Button } from '../../ui/Button.tsx';
import { keyLabel } from '../../ui/keys.ts';
import type { KeyboardLayout, SlotCode } from '../../ui/keys.ts';
import { Panel, PanelHead } from '../../ui/Panel.tsx';
import { presetLabel, teamModeLabel } from '../shared/labels.ts';
import { gridCaptions } from './KeyboardView.tsx';

/**
 * Smallest CIEDE2000 distances of the palettes (ui.md §8.2, tools/cvd-check.py, worst of normal / deutan /
 * protan / tritan). Measured values, shown as text in the preview.
 */
export const CVD_MEASURE = { safeMin: 10.0, houseMin: 1.7, slotPairMin: 37, emberMin: 16 } as const;

function LoadRow({ label, value, max, text }: { readonly label: string; readonly value: number; readonly max: number; readonly text: string }): JSX.Element {
  const f = Math.min(1, value / max);
  return (
    <div class="row">
      <span>{label}</span>
      <span class="ff-bar" aria-hidden="true">
        <i style={{ '--v': String(f), '--bar': f > 0.85 ? 'var(--warn)' : 'var(--copper-300)' }} />
      </span>
      <span class="num">{text}</span>
    </div>
  );
}

function GraphicsAside({ values }: { readonly values: SettingsValues }): JSX.Element {
  const load: LoadEstimate = estimateLoad(values);
  const idx = values.preset === 'custom' ? -1 : GRAPHICS_PRESETS_ORDER.indexOf(values.preset);
  const next: FixedPreset | undefined = idx >= 0 ? GRAPHICS_PRESETS_ORDER[idx + 1] : undefined;
  return (
    <Panel as="aside" class="aside-card" component="SettingsAside" testId="settings-aside" panelId="settings-aside">
      <PanelHead title={t('ui.settings.aside.load', { preset: presetLabel(values.preset) })} />
      <div class="body">
        <div class="budget" data-testid="load-estimate">
          <LoadRow label={t('ui.settings.load.gpu')} value={load.gpuMs} max={LOAD_BUDGET.gpuMs} text={t('ui.settings.load.ms', { value: fmtDec(load.gpuMs, 1) })} />
          <LoadRow label={t('ui.settings.load.main')} value={load.mainMs} max={LOAD_BUDGET.mainMs} text={t('ui.settings.load.ms', { value: fmtDec(load.mainMs, 1) })} />
          <LoadRow label={t('ui.settings.load.draws')} value={load.draws} max={LOAD_BUDGET.draws} text={fmtInt(load.draws)} />
          <LoadRow label={t('ui.settings.load.particles')} value={load.particlesK} max={LOAD_BUDGET.particlesK} text={t('ui.settings.load.k', { value: fmtDec(load.particlesK, 1) })} />
        </div>
        <div>{t('ui.settings.load.note')}</div>
        {load.gpuMs > LOAD_BUDGET.gpuMs ? (
          <div class="settings-warn" data-testid="load-over">
            <b>{t('ui.settings.load.over', { budget: fmtInt(LOAD_BUDGET.gpuMs) })}</b>
          </div>
        ) : null}
        {next ? (
          <div data-testid="load-next">
            {t('ui.settings.load.next', { preset: presetLabel(next), gpu: fmtDec(estimateLoad(GRAPHICS_PRESETS[next]).gpuMs, 1) })}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function AudioAside(): JSX.Element {
  const cmd = useCommands();
  return (
    <Panel as="aside" class="aside-card" component="SettingsAside" testId="settings-aside" panelId="settings-aside">
      <PanelHead title={t('ui.settings.aside.probe')} />
      <div class="body">
        <div>{t('ui.settings.probe.text')}</div>
        <div class="card-m__actions">
          <Button size="sm" icon="play" onClick={() => cmd.playSoundSample('signature')} testId="probe-signature">
            {t('ui.settings.probe.signature')}
          </Button>
          <Button size="sm" icon="play" onClick={() => cmd.playSoundSample('weapon')} testId="probe-weapon">
            {t('ui.settings.probe.weapon')}
          </Button>
          <Button size="sm" icon="play" onClick={() => cmd.playSoundSample('alert')} testId="probe-alert">
            {t('ui.settings.probe.alert')}
          </Button>
        </div>
        <div class="ff-lo">{t('ui.settings.probe.voices')}</div>
      </div>
    </Panel>
  );
}

function slotText(cat: UnitCatalog, slot: SlotCode, layout: KeyboardLayout, what: 'factory' | 'builder' | 'order'): string {
  const c = gridCaptions(cat, slot);
  const key = keyLabel(slot, layout);
  if (what === 'order') {
    const def = orderAtSlot(slot);
    return def ? `${key} ${orderShort(def.id)}` : key;
  }
  const name = what === 'factory' ? c.units[0] : c.units[c.units.length - 1];
  return `${key} ${name ?? ''}`.trim();
}

function KeysAside({ layout }: { readonly layout: KeyboardLayout }): JSX.Element {
  const cat = useUnitCatalog();
  const factory = (['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS'] as const).map((s) => slotText(cat, s, layout, 'factory')).join(', ');
  const combat = (['KeyQ', 'KeyA', 'KeyS'] as const).map((s) => slotText(cat, s, layout, 'order')).join(', ');
  return (
    <Panel as="aside" class="aside-card" component="SettingsAside" testId="settings-aside" panelId="settings-aside">
      <PanelHead title={t('ui.settings.aside.grid')} />
      <div class="body">
        <div>
          <b>{t('ui.settings.grid.builder')}</b>{' '}
          {t('ui.settings.grid.builderText', { first: slotText(cat, 'KeyQ', layout, 'builder'), last: slotText(cat, 'KeyV', layout, 'builder') })}
        </div>
        <div>
          <b>{t('ui.settings.grid.factory')}</b> {factory}.
        </div>
        <div>
          <b>{t('ui.settings.grid.combat')}</b> {t('ui.settings.grid.combatText', { list: combat })}
        </div>
        <div>{t('ui.settings.grid.tiers')}</div>
        <div class="ff-lo">{t('ui.settings.grid.rebind')}</div>
      </div>
    </Panel>
  );
}

const VISION_KEY: Readonly<Record<(typeof VISION_KINDS)[number], MsgKey>> = {
  normal: 'ui.settings.vision.normal',
  deutan: 'ui.settings.vision.deutan',
  protan: 'ui.settings.vision.protan',
  tritan: 'ui.settings.vision.tritan',
};

const REL_KEY: Readonly<Record<TeamRelation, MsgKey>> = { self: 'ui.settings.rel.self', ally: 'ui.settings.rel.ally', enemy: 'ui.settings.rel.enemy' };

function AccessAside({ mode }: { readonly mode: TeamColorMode }): JSX.Element {
  const palette = paletteOf(mode);
  const self = teamColorCss(mode, 'team-blau', 0, 'self');
  const enemy = teamColorCss(mode, 'team-rot', 1, 'enemy');
  return (
    <Panel as="aside" class="aside-card" component="SettingsAside" testId="settings-aside" panelId="settings-aside">
      <IconSprite />
      <PanelHead title={t('ui.settings.aside.preview', { mode: teamModeLabel(mode) })} />
      <div class="body">
        <div class={mode === 'relation' ? 'palette palette--3' : 'palette'} data-testid="team-palette" data-mode={mode}>
          {palette.map((c, i) => (
            <div key={c.token} style={{ background: `var(--${c.token})` }}>
              {mode === 'relation' ? t(REL_KEY[(['self', 'ally', 'enemy'] as const)[i] as TeamRelation]) : String(i + 1)}
            </div>
          ))}
        </div>
        <div class="iconrow" data-testid="team-icons">
          {['core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:lnd_t1_engineer', 'core:str_t1_fac_land'].map((id) => (
            <StrategicIcon key={id} typeId={id} color={self} />
          ))}
          <span class="ff-lo">{t('ui.settings.cvd.against')}</span>
          {['core:lnd_t1_tank', 'core:lnd_t1_aa'].map((id) => (
            <StrategicIcon key={`e-${id}`} typeId={id} color={enemy} team="enemy" />
          ))}
        </div>
        <div>
          {mode === 'cvd'
            ? t('ui.settings.cvd.text', {
                cvd: fmtDec(CVD_MEASURE.safeMin, 1),
                house: fmtDec(CVD_MEASURE.houseMin, 1),
                pair: fmtInt(CVD_MEASURE.slotPairMin),
                ember: fmtInt(CVD_MEASURE.emberMin),
              })
            : mode === 'relation'
              ? t('ui.settings.cvd.relationText')
              : t('ui.settings.cvd.houseText', { house: fmtDec(CVD_MEASURE.houseMin, 1) })}
        </div>
        <div class="cvdsim" role="img" aria-label={t('ui.settings.cvd.simulation')} data-testid="cvd-simulation">
          <span />
          <span>{t('ui.settings.cvd.house')}</span>
          <span>{t('ui.settings.cvd.safe')}</span>
          {VISION_KINDS.map((v) => [
            <span key={`l-${v}`}>{t(VISION_KEY[v])}</span>,
            ...[HOUSE_COLORS, CVD_COLORS].map((p, j) => (
              <div key={`${v}-${j}`} class="cvdsim__strip">
                {p.map((c) => (
                  <i key={c.token} style={{ background: simulateVision(c.hex, v) }} />
                ))}
              </div>
            )),
          ])}
        </div>
        <div class="ff-lo">{t('ui.settings.cvd.note')}</div>
      </div>
    </Panel>
  );
}

/** Example unit of the name hint: the T1 tank, else the first MVP unit of the catalog. */
const EXAMPLE_UNIT = 'core:lnd_t1_tank';

function GameAside(): JSX.Element {
  const cat = useUnitCatalog();
  const exampleId = cat.find(EXAMPLE_UNIT)?.id ?? mvpUnits(cat)[0]?.id ?? null;
  const example = (loc: 'de' | 'en'): string =>
    exampleId === null ? '' : `${unitText(cat, exampleId, 'name', loc)} · ${unitText(cat, exampleId, 'role', loc)}`;
  return (
    <Panel as="aside" class="aside-card" component="SettingsAside" testId="settings-aside" panelId="settings-aside">
      <PanelHead title={t('ui.settings.aside.game')} />
      <div class="body">
        <div>{t('ui.settings.game.text')}</div>
        <div data-testid="unit-name-example">
          <b>{example('de')}</b> / <b>{example('en')}</b>
        </div>
      </div>
    </Panel>
  );
}

export function SettingsAside({ tab }: { readonly tab: SettingsTab }): JSX.Element {
  const model = useHud();
  const values = model.menus.settings.values.value;
  if (tab === 'graphics') return <GraphicsAside values={values} />;
  if (tab === 'audio') return <AudioAside />;
  if (tab === 'keys') return <KeysAside layout={model.keyboardLayout.value} />;
  if (tab === 'access') return <AccessAside mode={values.teamColors} />;
  return <GameAside />;
}

