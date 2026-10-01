/**
 * Strategic icon overview (hud-p1): all icons of content/icons as sprite references, normal and ghost,
 * and the three team colour modes (ui.md §8.2). Doubles as the harness self-test.
 */
import { ICON_IDS, StrategicIcon, hasGhostIcon, iconMaskClass } from '@faf/hud';
import type { TeamColorMode } from '@faf/hud';
import type { JSX } from 'preact';
import { defineStories } from '../story.ts';
import type { Story } from '../story.ts';

const VIEWPORT = { width: 1440, height: 820 };

function IconGrid({ variant }: { readonly variant: 'normal' | 'ghost' | 'teams' | 'mask' }): JSX.Element {
  return (
    <div class="gal-icons__grid">
      {ICON_IDS.map((icon) => (
        <div class="gal-icons__cell" key={icon} data-icon-cell={icon}>
          <span class="gal-icons__pair">
            {variant === 'normal' && <StrategicIcon icon={icon} />}
            {variant === 'ghost' && (
              <>
                <StrategicIcon icon={icon} />
                <StrategicIcon icon={icon} state="ghost" />
              </>
            )}
            {variant === 'mask' && (
              <>
                <span class={`gal-icons__mask si-mask ${iconMaskClass(icon)}`} />
                <span class={`gal-icons__mask gal-icons__mask--enemy si-mask ${iconMaskClass(icon)}`} />
              </>
            )}
            {variant === 'teams' && (
              <>
                <StrategicIcon icon={icon} team="self" />
                <StrategicIcon icon={icon} team="enemy" />
              </>
            )}
          </span>
          <span>{icon}</span>
        </div>
      ))}
    </div>
  );
}

function teamStory(mode: TeamColorMode, state: string, title: string, tags: readonly string[] = []): Story {
  return {
    id: `strategic-icon--teams-${mode}`,
    component: 'StrategicIcon',
    state,
    title,
    layout: 'component',
    viewport: VIEWPORT,
    tags,
    nodeBudget: 1200,
    setup: ({ model }) => {
      model.teams.value = mode;
    },
    render: () => (
      <div class="gal-icons">
        <section class="gal-icons__mode">
          <h3>
            {title} · eigen | feindlich · {ICON_IDS.length} Icons
          </h3>
          <div class="gal-icons__row">
            <span class="gal-icons__swatch" style={{ background: 'var(--team-self)' }} />
            <span class="gal-muted">--team-self</span>
            <span class="gal-icons__swatch" style={{ background: 'var(--team-enemy)' }} />
            <span class="gal-muted">--team-enemy</span>
          </div>
        </section>
        <IconGrid variant="teams" />
      </div>
    ),
  };
}

export default defineStories([
  {
    id: 'strategic-icon--normal',
    component: 'StrategicIcon',
    state: 'normal',
    title: `Alle ${ICON_IDS.length} Strategic Icons (Sprite, <svg><use>)`,
    layout: 'component',
    viewport: VIEWPORT,
    tags: ['xbrowser'],
    nodeBudget: 1200,
    render: () => <IconGrid variant="normal" />,
  },
  {
    id: 'strategic-icon--ghost',
    component: 'StrategicIcon',
    state: 'ghost',
    title: `Normal | Ghost (${ICON_IDS.filter(hasGhostIcon).length} Gebäude mit eigenem Ghost-Symbol, sonst gedimmt)`,
    layout: 'component',
    viewport: VIEWPORT,
    nodeBudget: 1200,
    render: () => <IconGrid variant="ghost" />,
  },
  {
    id: 'strategic-icon--mask',
    component: 'StrategicIcon',
    state: 'Maske (Ein-Knoten)',
    title: 'Ein-Knoten-Icons per mask-image (icons-mask.gen.css, ui.md §9.2): eigen | feindlich',
    layout: 'component',
    viewport: VIEWPORT,
    tags: ['xbrowser'],
    nodeBudget: 1200,
    render: () => <IconGrid variant="mask" />,
  },
  teamStory('house', 'Hausfarben', 'Hausfarben (Standard)'),
  teamStory('relation', 'Eigen/Feind', 'Eigen/Feind'),
  teamStory('cvd', 'Farbenblind', 'Farbenblind-sicher', ['xbrowser']),
  {
    id: 'strategic-icon--scale-125',
    component: 'StrategicIcon',
    state: 'normal',
    title: 'Alle Icons bei UI-Skalierung 1,25 (1440p)',
    layout: 'component',
    viewport: { width: 1800, height: 1000 },
    scale: 1.25,
    nodeBudget: 1200,
    render: () => <IconGrid variant="normal" />,
  },
]);
