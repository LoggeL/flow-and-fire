import { effect } from '@preact/signals';
import { useRef, useLayoutEffect } from 'preact/hooks';
import { useHud, useCommands } from '../../model/index.ts';
import { Panel, PanelHead } from '../../ui/Panel.tsx';
import { t } from '../../i18n/t.ts';
import { drawCamera, drawDynamics, drawFog, worldPoint } from './draw.ts';
import '../../styles/hud.css';
export const minimapTimings: number[] = [];
export function Minimap() {
    const model = useHud(), m = model.minimap, c = useCommands(), terrain = useRef<HTMLCanvasElement>(null), dynamic = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null);
    const available = m.available.value;
    useLayoutEffect(() => {
        if (!available)
            return;
        const base = terrain.current?.getContext('2d'), dyn = dynamic.current?.getContext('2d'), top = overlay.current?.getContext('2d');
        if (!base || !dyn || !top)
            return;
        const edge = 216;
        let colors = ['#83b9dc', '#d7263d'];
        const colorEffect = effect(() => { const mode = model.teams.value; const css = getComputedStyle(document.documentElement); colors = mode === 'cvd' ? ['#0072b2', '#d7263d', '#e69f00'] : [css.getPropertyValue('--team-self').trim() || '#83b9dc', css.getPropertyValue('--team-enemy').trim() || '#d7263d']; });
        const baseEffect = effect(() => { const src = m.terrain.value, mode = m.mode.value; base.fillStyle = mode === 'tactical' ? '#292c27' : '#29241e'; base.fillRect(0, 0, edge, edge); if (src && mode === 'terrain') {
            const cache = document.createElement('canvas');
            cache.width = src.width;
            cache.height = src.height;
            const ctx = cache.getContext('2d');
            if (ctx) {
                const img = ctx.createImageData(src.width, src.height);
                img.data.set(src.rgba);
                ctx.putImageData(img, 0, 0);
                base.drawImage(cache, 0, 0, edge, edge);
            }
        } });
        const dynamicEffect = effect(() => { void model.teams.value; const units = m.units.value, fog = m.fog.value, spots = m.showResources.value ? m.spots.value : [], pings = m.pings.value, now = model.match.timeS.value; const start = performance.now(); dyn.clearRect(0, 0, edge, edge); drawFog(dyn, fog, edge); drawDynamics(dyn, edge, m.mapSizeWu.value, units, spots, pings, colors, now); minimapTimings.push(performance.now() - start); if (minimapTimings.length > 10000)
            minimapTimings.shift(); });
        let frame: number | null = null;
        const cameraEffect = effect(() => { const corners = m.camera.value, size = m.mapSizeWu.value; if (frame !== null)
            cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = null; drawCamera(top, corners, size, edge); }); });
        return () => { colorEffect(); baseEffect(); dynamicEffect(); cameraEffect(); if (frame !== null)
            cancelAnimationFrame(frame); };
    }, [model, available]);
    const camera = (e: PointerEvent) => { const el = e.currentTarget as HTMLElement; const [x, z] = worldPoint(e.clientX, e.clientY, el.getBoundingClientRect(), m.mapSizeWu.peek()); c.setCamera(x, z); };
    return <Panel component="Minimap" testId="minimap" panelId="minimap" class="minimap"><PanelHead title={m.mapName.value || t('ui.minimap.title')} end={<span class="minimap__tools"><button aria-label={t('ui.minimap.mode')} onClick={() => c.setMinimapMode(m.mode.peek() === 'terrain' ? 'tactical' : 'terrain')}>▧</button><button aria-label={t('ui.minimap.resources')} aria-pressed={m.showResources.value} onClick={() => c.toggleResources()}>◇</button><button aria-label={t('ui.minimap.whole')} onClick={() => c.showWholeMap()}>⛶</button></span>}/>{available ? <div class="minimap__wrap" data-testid="minimap-surface" onPointerDown={(e) => { if (e.button === 0) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        camera(e);
    } }} onPointerMove={(e) => { if (e.buttons === 1)
        camera(e); }} onContextMenu={(e) => { e.preventDefault(); const [x, z] = worldPoint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), m.mapSizeWu.peek()); c.minimapOrder(x, z, e.shiftKey); }}><canvas ref={terrain} width={216} height={216}/><canvas ref={dynamic} width={216} height={216}/><canvas ref={overlay} width={216} height={216}/></div> : <div class="minimap__facts"><b>{m.mapName.value}</b><p>{t('ui.common.worldUnits', { value: m.mapSizeWu.value })}</p><p>{t('ui.minimap.spots', { free: m.spots.value.filter(s => !s.taken).length, total: m.spots.value.length })}</p><p>{t('ui.minimap.pending')}</p></div>}</Panel>;
}
