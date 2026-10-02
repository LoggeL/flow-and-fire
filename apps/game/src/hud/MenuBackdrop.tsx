import { useEffect, useState } from 'preact/hooks';
import { useHud } from '@faf/hud';
import parallaxBackground from './assets/menu/parallax-background-v1.webp';
import parallaxCommander from './assets/menu/parallax-commander-v1.webp';
import parallaxForeground from './assets/menu/parallax-foreground-v1.webp';

// Decorative atmosphere runs entirely on compositor transforms and opacity.
const EMBERS = [
  [57, 7, 17, -3], [67, 15, 21, -11], [73, 6, 19, -7], [84, 12, 24, -18],
  [91, 20, 22, -5], [62, 25, 27, -16], [79, 28, 26, -21], [95, 8, 20, -13],
] as const;

// Coordinates in the registered 1672 × 941 source frame, tied to actual scene details.
const FACTORY_LIGHTS = [
  [939, 582, 148, 132, 11, -3],
  [816, 551, 60, 68, 14, -7],
  [928, 413, 72, 52, 17, -10],
] as const;
const FACTORY_SMOKE = [[824, 553, 94, 165, 21, -6], [1121, 532, 72, 142, 27, -16]] as const;
const VALLEY_HAZE = [[380, 462, 340, 305, 18, -5], [1130, 535, 405, 245, 23, -12]] as const;
function sceneBox(x: number, y: number, width: number, height: number) {
  return {left: `${x / 1672 * 100}%`, top: `${y / 941 * 100}%`, width: `${width / 1672 * 100}%`, height: `${height / 941 * 100}%`};
}

/** Shared by the main menu and match setup. OS motion preference always takes precedence. */
export function MenuBackdrop() {
  const m = useHud(), enabled = m.menus.settings.values.value.backgroundAnimation;
  const [systemReduced, setSystemReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setSystemReduced(preference.matches);
    const updateVisibility = () => setVisible(document.visibilityState !== 'hidden');
    updatePreference();
    updateVisibility();
    preference.addEventListener('change', updatePreference);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updatePreference);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  const reduced = systemReduced || m.reducedMotion.value === 'on';
  const active = enabled && !reduced && visible;

  return <div class="menu-backdrop" data-testid="menu-backdrop" data-parallax="layered" data-motion={active ? 'active' : 'paused'} data-motion-reason={reduced ? 'reduced' : !enabled ? 'user' : !visible ? 'hidden' : 'enabled'} aria-hidden="true">
    <div class="menu-backdrop__camera" data-testid="menu-camera-orbit" data-scene-layer="camera">
      <img class="menu-backdrop__layer menu-backdrop__image" src={parallaxBackground} alt="" draggable={false} loading="eager" fetchpriority="high" decoding="async" data-testid="menu-background-image" data-menu-layer="background"/>
      <div class="menu-backdrop__scene-effects menu-backdrop__scene-effects--background" data-testid="menu-background-effects" data-scene-layer="background"><div class="menu-backdrop__scene-plane">
        <i class="menu-scene-cloud menu-scene-cloud--shadow" data-scene-effect="cloud" data-scene-layer="sky-shadow" data-testid="menu-sky-shadow" style={sceneBox(425, -65, 990, 330)}/>
        <i class="menu-scene-cloud menu-scene-cloud--warm" data-scene-effect="cloud" data-scene-layer="sky-glow" data-testid="menu-sky-glow" style={sceneBox(970, 22, 560, 185)}/>
        {FACTORY_LIGHTS.map(([x, y, width, height, duration, delay], index) => <i key={`light-${index}`} class="menu-scene-light" data-scene-effect="factory-light" style={{...sceneBox(x, y, width, height), animationDuration: `${duration}s`, animationDelay: `${delay}s`}}/>)}
        {FACTORY_SMOKE.map(([x, y, width, height, duration, delay], index) => <i key={`smoke-${index}`} class="menu-scene-smoke" data-scene-effect="smoke" style={{...sceneBox(x, y, width, height), animationDuration: `${duration}s`, animationDelay: `${delay}s`}}/>)}
        {FACTORY_SMOKE.map(([x, y, width, height, duration, delay], index) => <i key={`billow-${index}`} class="menu-scene-smoke menu-scene-smoke--billow" data-scene-effect="smoke" data-scene-layer={`factory-billow-${index}`} data-testid={`menu-factory-billow-${index}`} style={{...sceneBox(x, y, width, height), animationDuration: `${duration}s`, animationDelay: `${delay - duration / 2}s`}}/>)}
        {VALLEY_HAZE.map(([x, y, width, height, duration, delay], index) => <i key={`haze-${index}`} class="menu-scene-haze" data-scene-effect="haze" data-scene-layer={`valley-haze-${index}`} data-testid={`menu-valley-haze-${index}`} style={{...sceneBox(x, y, width, height), animationDuration: `${duration}s`, animationDelay: `${delay}s`}}/>)}
      </div></div>
      <div class="menu-backdrop__mist menu-backdrop__mist--far"/>
      <img class="menu-backdrop__layer menu-backdrop__commander" src={parallaxCommander} alt="" draggable={false} loading="eager" fetchpriority="high" decoding="async" data-testid="menu-commander-image" data-menu-layer="commander"/>
      <div class="menu-backdrop__scene-effects menu-backdrop__scene-effects--commander" data-testid="menu-commander-effects" data-scene-layer="commander"><div class="menu-backdrop__scene-plane"><i class="menu-scene-emitter" data-scene-effect="emitter" style={sceneBox(1508, 495, 150, 190)}/></div></div>
      <div class="menu-backdrop__mist"/>
      <img class="menu-backdrop__layer menu-backdrop__foreground" src={parallaxForeground} alt="" draggable={false} loading="eager" decoding="async" data-testid="menu-foreground-image" data-menu-layer="foreground"/>
      <div class="menu-backdrop__embers">{EMBERS.map(([left, bottom, duration, delay], index) => <i key={index} style={{left: `${left}%`, bottom: `${bottom}%`, animationDuration: `${duration}s`, animationDelay: `${delay}s`}}/>)}</div>
    </div>
      <div class="menu-backdrop__shade"/>
      <div class="menu-backdrop__vignette"/>
    </div>;
}
