import { useHud, useCommands } from '../../model/index.ts';
import { SETTING_RANGES, SETTING_CHOICES, SETTINGS_TABS } from '../../model/menus/settings.ts';
import type { SettingKey, SettingsValues } from '../../model/menus/settings.ts';
import { ORDER_DEFS } from '../../model/orders.ts';
import { tDynamic as t } from '../../i18n/t.ts';
import { Button, Select, Switch, Range, Tabs, Tab, Panel, PanelHead, GRID_ROWS, keyLabel } from '../../ui/index.ts';
import { MenuShell } from '../shared/Shell.tsx';
const GROUPS = { graphics: ['preset', 'renderScale', 'shadowCascades', 'splatLayers', 'particleCap', 'bloom', 'antialias', 'frameCap', 'cameraShake'], audio: ['volMaster', 'volSfx', 'volVoice', 'volUi', 'volMusic', 'volAmbient', 'alertVoice', 'audibleStall', 'audioInBackground'], keys: ['keyScheme'], access: ['uiScale', 'teamColors', 'reducedMotion'], game: ['locale', 'edgePan', 'tooltips', 'pauseInBackground', 'autoSaveReplays'] } as const;
/** Bindings of this build that are not on the command grid (see client ActionMap and HUD handlers). */
const SYSTEM_KEYS = [['P', 'pause'], ['H', 'commander'], ['Esc', 'escape'], ['space', 'alert'], ['1–0', 'groupRecall'], ['Alt+1–0', 'groupSave'], ['ctrl+A', 'selectAll'], ['home', 'resetCamera'], ['alt+enter', 'fullscreen']] as const;
/** Orders without a game implementation yet are not listed as key bindings. */
const UNLISTED_ORDERS: readonly string[] = ['ability', 'formation'];
export function TeamPreview() { const m = useHud(), mode = m.menus.settings.values.value.teamColors; return <div class="team-preview" data-team-preview={mode}>{(mode === 'cvd' ? ['#0072b2', '#d7263d', '#009e73', '#cc79a7'] : mode === 'relation' ? ['#55b8ef', '#ee5555'] : ['#5da5e8', '#df5b4f', '#6ca94d', '#e2ad50']).map((color, i) => <span key={color} style={{ background: color }}>{i + 1}</span>)}</div>; }
/** What each key does: the grid builds, Alt+key gives orders, system keys work everywhere. */
export function KeyReference() {
    const m = useHud(), layout = m.keyboardLayout.value, wasd = m.menus.settings.values.value.keyScheme === 'wasd';
    const orders = ORDER_DEFS.filter(order => order.key !== null && !UNLISTED_ORDERS.includes(order.id));
    const label = (key: string) => key === 'space' ? t('ui.common.key.space') : key === 'ctrl+A' ? `${t('ui.common.key.ctrl')}+A` : key === 'home' ? (m.locale.value === 'en' ? 'Home' : 'Pos1') : key === 'alt+enter' ? `Alt+${t('ui.common.key.enter')}` : key;
    return <div class="key-reference" data-testid="key-reference"><h3>{t('ui.settings.keys.build')}</h3><p>{t('ui.settings.keys.buildText')}</p><div class="setting-keys">{GRID_ROWS.flat().map(code => <kbd key={code}>{keyLabel(code, layout)}</kbd>)}</div>
        <h3>{t('ui.settings.keys.orders')}</h3><dl class="key-list">{orders.map(order => <div key={order.id}><dt><kbd>{`Alt+${keyLabel(order.key!, layout)}`}</kbd></dt><dd>{t(`ui.orders.${order.id}.name`)}</dd></div>)}</dl>
        <h3>{t('ui.settings.keys.system')}</h3><dl class="key-list">{SYSTEM_KEYS.map(([key, action]) => <div key={action}><dt><kbd>{label(key)}</kbd></dt><dd>{t(`ui.settings.keys.${action}`)}</dd></div>)}<div><dt><kbd>{wasd ? 'WASD' : '← ↑ → ↓'}</kbd></dt><dd>{t('ui.settings.keys.pan')}</dd></div></dl>
        <p class="key-note">{t('ui.settings.rebind')}</p></div>;
}
export function Settings() {
    const m = useHud(), c = useCommands(), s = m.menus.settings, values = s.values.value, tab = s.tab.value;
    function control<K extends SettingKey>(key: K) { const label = t(`ui.settings.value.${key}`), value = values[key], range = SETTING_RANGES[key], choices = SETTING_CHOICES[key]; if (range)
        return <><Range label={label} value={value as number} min={range[0]} max={range[1]} step={range[2]} onChange={v => c.setSetting(key, v as SettingsValues[K])}/><span class="val">{value}</span></>; if (choices)
        return <Select label={label} value={String(value)} options={choices.map(v => ({ value: String(v), label: typeof v === 'number' ? String(v) : t(`ui.settings.${v}`) }))} onChange={v => c.setSetting(key, choices.find(option => String(option) === v) as SettingsValues[K])}/>; return <Switch label={label} on={Boolean(value)} onChange={v => c.setSetting(key, v as SettingsValues[K])}/>; }
    return <MenuShell title={t('ui.settings.title')} component="Settings" language={false} footer={<Button onClick={() => c.resetSettings()}>{t('ui.common.reset')}</Button>}><main class="settings"><Tabs class="vtabs" label={t('ui.settings.title')}>{SETTINGS_TABS.map(x => <Tab key={x} class="vtab" selected={tab === x} onSelect={() => { s.tab.value = x; }}>{t(`ui.settings.${x}`)}</Tab>)}</Tabs><section class="srows">{tab === 'graphics' && <div class="detect"><span>{s.gpuName.value ? t('ui.settings.gpu', { name: s.gpuName.value }) : t('ui.settings.gpuUnknown')}<br />{t(s.detectState.value === 'done' ? 'ui.settings.detectDone' : 'ui.settings.detectIdle', { preset: t(`ui.settings.${values.preset}`) })}</span><Button onClick={() => c.requestAutodetect()} disabled={s.detectState.value === 'running'}>{t('ui.settings.detect')}</Button></div>}{GROUPS[tab].map(key => <div key={key} class={`srow ${s.dirty.value.includes(key) ? 'is-changed' : ''}`} data-setting={key}><div class="srow__l"><b>{t(`ui.settings.value.${key}`)}</b><small>{t(`ui.settings.help.${key}`)}</small></div><div class="srow__c">{control(key)}</div></div>)}{tab === 'keys' && <KeyReference/>}</section><Panel class="aside-card"><PanelHead title={t('ui.settings.preview')}/><aside>{tab === 'graphics' ? <p>{t('ui.settings.quality', { n: values.particleCap, layers: values.splatLayers })}</p> : tab === 'audio' ? (s.previewAvailable.value ? <Button onClick={() => c.previewAudio()}>{t('ui.settings.sample')}</Button> : <p>{t('ui.settings.sampleInGame')}</p>) : tab === 'access' ? <TeamPreview /> : tab === 'keys' ? <p>{t('ui.settings.keyHint')}</p> : <p>{t('ui.settings.hint')}</p>}</aside></Panel></main></MenuShell>;
}
