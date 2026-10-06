/**
 * Settings (ui.md §5.15; P9, C11, P12, parts of P16; markup after docs/design/ui-mockups/settings.html).
 * Vertical tabs Grafik · Audio · Tasten · Barrierefreiheit · Spiel & Sprache (↑/↓ move and select); rows
 * with label + explanation left and the control right (p0 primitives), changed values (≠ default) carry an
 * ember dot; context card per tab on the right. Every change → setSetting(key, value) with the typed value,
 * "Standard wiederherstellen" → resetSettings(), "Fertig"/Esc → closeSettings().
 */
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { fmtInt } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import type { MsgKey } from '../../i18n/tables.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { SETTINGS_TABS, canResetSettings } from '../../model/menus/settings.ts';
import type { GraphicsDetect, SettingKey, SettingsTab, SettingsValues } from '../../model/menus/settings.ts';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { Key } from '../../ui/Key.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import type { LineIconName } from '../../ui/icons.ts';
import type { KeyboardLayout } from '../../ui/keys.ts';
import { Range } from '../../ui/Range.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Select } from '../../ui/Select.tsx';
import { Switch } from '../../ui/Switch.tsx';
import { focusSibling } from '../../ui/Tab.tsx';
import { isFieldTarget } from '../shared/focus.ts';
import { presetLabel } from '../shared/labels.ts';
import { MenuBackground } from '../shared/MapCanvas.tsx';
import { KeyboardView } from './KeyboardView.tsx';
import { SETTINGS_LAYOUT, enumOptions, optionLabel, rangeView, rowHint, rowLabel } from './rows.ts';
import type { RowSpec } from './rows.ts';
import { SettingsAside } from './SettingsAside.tsx';

const TAB_TEXT: Readonly<Record<SettingsTab, { readonly label: MsgKey; readonly icon: LineIconName }>> = {
  graphics: { label: 'ui.settings.tab.graphics', icon: 'layers' },
  audio: { label: 'ui.settings.tab.audio', icon: 'speaker' },
  keys: { label: 'ui.settings.tab.keys', icon: 'keyboard' },
  access: { label: 'ui.settings.tab.access', icon: 'eye' },
  game: { label: 'ui.settings.tab.game', icon: 'globe' },
};

const tabId = (tab: SettingsTab): string => `ffm-settings-tab-${tab}`;
const paneId = (tab: SettingsTab): string => `ffm-settings-pane-${tab}`;

export function settingsTabLabel(tab: SettingsTab): string {
  return t(TAB_TEXT[tab].label);
}

interface RowProps {
  readonly row: RowSpec;
  readonly values: SettingsValues;
  readonly changed: boolean;
  readonly autoScale: number;
  readonly set: <K extends SettingKey>(key: K, value: SettingsValues[K]) => void;
}

function Control({ row, values, autoScale, set }: Omit<RowProps, 'changed'>): JSX.Element {
  const key = row.key;
  const label = rowLabel(key);
  const value = values[key];
  const testId = `setting-${key}`;
  const disabled = row.locked === true;
  if (row.control === 'switch') {
    // A locked switch keeps its on/off look (the hint says why it cannot change) and ignores clicks.
    return <Switch on={value === true} label={label} onChange={disabled ? undefined : (on) => set(key, on as never)} testId={testId} />;
  }
  if (row.control === 'range') {
    const r = rangeView(key);
    const v = value as number;
    return (
      <>
        <Range
          value={r.toUi(v)}
          min={r.min}
          max={r.max}
          step={r.step}
          label={label}
          valueText={r.text(v)}
          disabled={disabled}
          onChange={(n) => set(key, r.fromUi(n) as never)}
          testId={testId}
        />
        <span class="val num" data-testid={`${testId}-value`}>
          {r.text(v)}
        </span>
      </>
    );
  }
  const opts = enumOptions(key);
  if (row.control === 'seg') {
    return (
      <Segmented<string | number>
        label={label}
        value={value as string | number}
        disabled={disabled}
        options={opts.map((o) => ({
          value: o,
          label: optionLabel(key, o, autoScale),
          // "Eigen" is a result, not a choice: only shown as selected when the values match no preset.
          disabled: key === 'preset' && o === 'custom' && value !== 'custom',
        }))}
        onChange={(v) => set(key, v as never)}
        testId={testId}
      />
    );
  }
  return (
    <Select
      label={label}
      value={String(value)}
      disabled={disabled}
      options={opts.map((o) => ({ value: String(o), label: optionLabel(key, o, autoScale) }))}
      onChange={(s) => {
        const o = opts.find((x) => String(x) === s);
        if (o !== undefined) set(key, o as never);
      }}
      testId={testId}
    />
  );
}

function Row(props: RowProps): JSX.Element {
  const { row, changed } = props;
  return (
    <div class={cx('srow', changed && 'is-changed', row.locked && 'is-locked')} data-testid={`row-${row.key}`} data-changed={changed ? '' : undefined}>
      <div class="srow__l">
        <b>
          {rowLabel(row.key)}
          {changed ? <span class="ff-sr">{` (${t('ui.settings.changed')})`}</span> : null}
        </b>
        <small>{rowHint(row.key)}</small>
      </div>
      <div class="srow__c">
        <Control row={row} values={props.values} autoScale={props.autoScale} set={props.set} />
      </div>
    </div>
  );
}

function DetectBox({ detect }: { readonly detect: GraphicsDetect }): JSX.Element {
  const cmd = useCommands();
  const running = detect.state === 'running';
  const api = [detect.api, ...detect.extensions].join(', ');
  return (
    <div class="detect" data-testid="graphics-detect" data-state={detect.state}>
      <LineIcon name="cpu" />
      <div class="detect__text" aria-live="polite">
        <b>{t('ui.settings.detect.title', { preset: presetLabel(detect.recommended) })}</b>
        <br />
        {running
          ? t('ui.settings.detect.running')
          : detect.fps !== null
            ? t('ui.settings.detect.line', { gpu: detect.gpu, fps: fmtInt(detect.fps), api })
            : t('ui.settings.detect.noRun', { gpu: detect.gpu, api })}
      </div>
      <Button size="sm" disabled={running} onClick={() => cmd.runGraphicsBenchmark()} testId="graphics-rerun">
        {t('ui.settings.detect.rerun')}
      </Button>
    </div>
  );
}

function KeysExtras({ layout, scheme }: { readonly layout: KeyboardLayout; readonly scheme: SettingsValues['keyScheme'] }): JSX.Element {
  return (
    <>
      {scheme === 'wasd' ? (
        <div class="settings-note" role="note" data-testid="wasd-warning">
          <LineIcon name="warn" />
          <span>{t('ui.settings.wasdWarn')}</span>
        </div>
      ) : null}
      <div class="legend">
        <span>
          <i class="is-grid" />
          {t('ui.settings.legend.grid')}
        </span>
        <span>
          <i class="is-cam" />
          {t('ui.settings.legend.cam')}
        </span>
        <span>
          <i class="is-sys" />
          {t('ui.settings.legend.sys')}
        </span>
        <span class="ff-lo">{t('ui.settings.legend.note', { layout: t(`ui.settings.layout.${layout}`) })}</span>
      </div>
      <KeyboardView layout={layout} scheme={scheme} />
      <table class="ktable" data-testid="key-combos">
        <caption class="ff-sr">{t('ui.settings.combo.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('ui.settings.combo.action')}</th>
            <th scope="col">{t('ui.settings.combo.key')}</th>
            <th scope="col">{t('ui.settings.combo.note')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t('ui.settings.combo.orders')}</td>
            <td>
              <Key code="AltLeft" layout={layout} />+<Key>{t('ui.settings.combo.ordersKey')}</Key>
            </td>
            <td>{t('ui.settings.combo.ordersNote')}</td>
          </tr>
          <tr>
            <td>{t('ui.settings.combo.groups')}</td>
            <td>
              <Key code="AltLeft" layout={layout} />+<Key code="Digit1" layout={layout} /> · <Key code="ShiftLeft" layout={layout} />
              <Key code="AltLeft" layout={layout} />+<Key code="Digit1" layout={layout} />
            </td>
            <td>{t('ui.settings.combo.groupsNote')}</td>
          </tr>
          <tr>
            <td>{t('ui.settings.combo.selfDestruct')}</td>
            <td>
              <Key code="ControlLeft" layout={layout} />+<Key code="Delete" layout={layout} />
            </td>
            <td>{t('ui.settings.combo.selfDestructNote')}</td>
          </tr>
          <tr>
            <td>{t('ui.settings.combo.alert')}</td>
            <td>
              <Key>{t('ui.settings.kb.spaceKey')}</Key>
            </td>
            <td>{t('ui.settings.combo.alertNote')}</td>
          </tr>
        </tbody>
      </table>
      <div class="settings-rebind">
        <Button icon="lock" disabled testId="settings-rebind">
          {t('ui.settings.rebind')}
        </Button>
        <span class="tag">{t('ui.settings.rebind.tag')}</span>
        <span>{t('ui.settings.rebind.title')}</span>
      </div>
    </>
  );
}

export function Settings(): JSX.Element {
  const model = useHud();
  const cmd = useCommands();
  const s = model.menus.settings;
  const tab = s.tab.value;
  const values = s.values.value;
  const dirty = s.dirty.value;
  const autoScale = s.autoScale.value;
  const tabsRef = useRef<HTMLDivElement>(null);

  const set = <K extends SettingKey>(key: K, value: SettingsValues[K]): void => cmd.setSetting(key, value);

  const onTabsKey = (e: KeyboardEvent): void => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const next = focusSibling(e.currentTarget as HTMLElement, '[role="tab"]', document.activeElement, e.key);
    if (!next) return;
    e.preventDefault();
    const id = next.dataset['tab'] as SettingsTab | undefined;
    if (id && id !== tab) cmd.setSettingsTab(id);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.key !== 'Escape') return;
    if (isFieldTarget(e.target)) return;
    e.preventDefault();
    cmd.closeSettings();
  };

  return (
    <div class="menu-page" data-component="Settings" data-testid="settings" data-tab={tab} onKeyDown={onKeyDown}>
      <MenuBackground seed={5} />
      <div class="menu-root">
        <div class="menu-top">
          <Button variant="ghost" size="icon" icon="exit" label={t('ui.settings.back')} onClick={() => cmd.closeSettings()} testId="settings-back" />
          <h1>{t('ui.settings.title')}</h1>
          <span class="crumb" data-testid="settings-crumb">
            {settingsTabLabel(tab)}
          </span>
          <div class="sp">
            <span class="hintline">
              {t('ui.settings.hint.apply')} · <Key code="Escape" layout={model.keyboardLayout.value} /> {t('ui.settings.hint.back')}
            </span>
          </div>
        </div>

        <div class="settings">
          <div ref={tabsRef} class="vtabs" role="tablist" aria-orientation="vertical" aria-label={t('ui.settings.tabs')} onKeyDown={onTabsKey}>
            {SETTINGS_TABS.map((id) => (
              <button
                key={id}
                id={tabId(id)}
                type="button"
                role="tab"
                class={cx('vtab', id === tab && 'is-selected')}
                aria-selected={id === tab}
                aria-controls={paneId(id)}
                tabIndex={id === tab ? 0 : -1}
                onClick={() => id !== tab && cmd.setSettingsTab(id)}
                data-tab={id}
                data-testid={`settings-tab-${id}`}
              >
                <LineIcon name={TAB_TEXT[id].icon} />
                <span data-fit="">{t(TAB_TEXT[id].label)}</span>
              </button>
            ))}
          </div>

          <section class="srows settings-pane" id={paneId(tab)} role="tabpanel" aria-labelledby={tabId(tab)} data-testid={`settings-pane-${tab}`}>
            {tab === 'graphics' ? <DetectBox detect={s.detect.value} /> : null}
            {SETTINGS_LAYOUT[tab].map((g) => (
              <div key={g.title} role="group" aria-label={t(g.title)} class="settings-pane">
                <div class="sgroup">{t(g.title)}</div>
                {g.rows.map((row) => (
                  <Row key={row.key} row={row} values={values} changed={dirty.includes(row.key)} autoScale={autoScale} set={set} />
                ))}
              </div>
            ))}
            {tab === 'keys' ? <KeysExtras layout={model.keyboardLayout.value} scheme={values.keyScheme} /> : null}
          </section>

          <SettingsAside tab={tab} />
        </div>

        <div class="menu-foot">
          <span>{t('ui.settings.foot')}</span>
          <div class="sp">
            <Button disabled={!canResetSettings(values, s.defaults.value)} onClick={() => cmd.resetSettings()} testId="settings-reset">
              {t('ui.settings.reset')}
            </Button>
            <Button variant="primary" onClick={() => cmd.closeSettings()} testId="settings-done">
              {t('ui.settings.done')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
