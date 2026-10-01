import { useHud, useCommands } from '../../model/index.ts';
import { t } from '../../i18n/t.ts';
import { fmtBytes } from '../../format/index.ts';
import { Button, Bar, Badge } from '../../ui/index.ts';
import { MenuShell } from '../shared/Shell.tsx';
import { MapPreview } from '../skirmish/SkirmishSetup.tsx';
export function LoadingScreen() {
    const m = useHud(), c = useCommands(), s = m.menus.loading, phases = s.phases.value, map = m.menus.skirmish.maps.value.find(x => x.name === s.mapName.value), file = s.currentFile.value;
    return <MenuShell component="LoadingScreen" title={t('ui.loading.title')} footer={<span>{t('ui.loading.hint')}</span>}><main class="load-content"><section><h2 class="score-title">{s.mapName}</h2><p>{t('ui.skirmish.victory')}: {t(`ui.skirmish.${m.menus.skirmish.rules.value.victory}`)} · {t('ui.skirmish.cap')}: {m.menus.skirmish.rules.value.unitCap}</p><div class="load-houses">{m.menus.skirmish.slots.value.map(x => <p key={x.index}>{x.name} · {t('ui.skirmish.varkan')} <Badge tone="ok">{t('ui.loading.done')}</Badge></p>)}</div></section><section class="load-preview">{map && <MapPreview map={map}/>}</section><section class="load-phases">{phases.map(x => <div key={x.id} class={`load-phase is-${x.state}`}><b>{t(`ui.loading.${x.id}`)}</b><Bar kind="build" value={x.progress} label={t(`ui.loading.${x.id}`)} level={x.state === 'error' ? 'crit' : 'normal'}/><span>{t(`ui.loading.${x.state}`)}</span></div>)}<Bar kind="build" value={phases.reduce((n, x) => n + x.progress, 0) / 5} label={t('ui.loading.total')}/><p>{file?.path} {file && t(`ui.loading.${file.source}`)}</p><p>{fmtBytes(s.bytes.value.loaded)} / {fmtBytes(s.bytes.value.total)}</p>{s.error.value && <div role="alert"><Badge tone="crit">{t('ui.loading.error')}</Badge><p>{s.error}</p><Button onClick={() => c.retryLoading()}>{t('ui.common.retry')}</Button><Button onClick={() => c.backToMenu()}>{t('ui.loading.menu')}</Button></div>}</section></main></MenuShell>;
}
