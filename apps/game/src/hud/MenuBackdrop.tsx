import { useEffect, useState } from 'preact/hooks';
import { useHud } from '@faf/hud';
import commanderDusk from './assets/menu/commander-dusk-v1.webp';

// Decorative atmosphere runs entirely on compositor transforms and opacity.
const EMBERS = [
  [57, 7, 17, -3], [67, 15, 21, -11], [73, 6, 19, -7], [84, 12, 24, -18],
  [91, 20, 22, -5], [62, 25, 27, -16], [79, 28, 26, -21], [95, 8, 20, -13],
] as const;

/** Mounted only on the main screen. OS motion preference always takes precedence. */
export function MenuBackdrop() {
  const en = useHud().locale.value === 'en';
  const [enabled, setEnabled] = useState(true);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReduced(preference.matches);
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

  const active = enabled && !reduced && visible;
  const action = reduced
    ? (en ? 'Reduced motion' : 'Bewegung reduziert')
    : enabled
      ? (en ? 'Pause background animation' : 'Hintergrundanimation pausieren')
      : (en ? 'Play background animation' : 'Hintergrundanimation abspielen');

  return <>
    <div class="menu-backdrop" data-testid="menu-backdrop" data-motion={active ? 'active' : 'paused'} data-motion-reason={reduced ? 'reduced' : !enabled ? 'user' : !visible ? 'hidden' : 'enabled'} aria-hidden="true">
      <img class="menu-backdrop__image" src={commanderDusk} alt="" draggable={false} loading="eager" fetchpriority="high" decoding="async" data-testid="menu-background-image"/>
      <div class="menu-backdrop__shade"/>
      <div class="menu-backdrop__mist"/>
      <div class="menu-backdrop__mist menu-backdrop__mist--far"/>
      <div class="menu-backdrop__embers">{EMBERS.map(([left, bottom, duration, delay], index) => <i key={index} style={{left: `${left}%`, bottom: `${bottom}%`, animationDuration: `${duration}s`, animationDelay: `${delay}s`}}/>)}</div>
      <div class="menu-backdrop__vignette"/>
    </div>
    <button type="button" class="menu-motion-control" data-testid="menu-motion-toggle" aria-label={action} aria-pressed={enabled && !reduced} disabled={reduced} title={action} onClick={() => setEnabled(value => !value)}>
      <span aria-hidden="true">{enabled && !reduced ? 'Ⅱ' : '▷'}</span>
      <span>{reduced ? action : 'Animation'}</span>
    </button>
  </>;
}
