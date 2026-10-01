// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GHOST_ICON_IDS,
  ICON_IDS,
  ICON_SPRITE,
  ICON_SPRITE_ID,
  ensureIconSprite,
  hasGhostIcon,
  iconMaskClass,
  iconOf,
  iconSymbolId,
} from '../../src/data/icons.ts';
import { MVP_UNITS } from '../../src/data/roster.ts';
import { IconSprite, StrategicIcon } from '../../src/data/StrategicIcon.tsx';

afterEach(() => {
  cleanup();
  document.getElementById(ICON_SPRITE_ID)?.remove();
});

describe('icon sprite', () => {
  it('has one symbol per icon and per ghost variant, team colour as CSS variable', () => {
    for (const id of ICON_IDS) expect(ICON_SPRITE).toContain(`<symbol id="si-${id}" `);
    for (const id of GHOST_ICON_IDS) expect(ICON_SPRITE).toContain(`<symbol id="si-${id}--ghost" `);
    expect(ICON_SPRITE).toContain('var(--team, #2F6FD0)');
    expect(ICON_SPRITE).not.toContain('<title>');
    expect(ICON_SPRITE).not.toContain('.selected');
    expect(ICON_IDS).toContain('blip_air');
  });

  it('every roster unit has an icon', () => {
    for (const u of MVP_UNITS) expect(iconOf(u.id), u.id).toBe(u.icon);
    expect(iconOf('core:nope')).toBeNull();
  });

  it('every compiled runtime visual resolves to an existing HUD symbol', () => {
    // Source data only. This creates no HUD runtime dependency on the content compiler or Game.
    const view = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../content/generated/view.json'), 'utf8')) as { visuals: { id: string }[] };
    expect(view.visuals.length).toBeGreaterThan(0);
    for (const visual of view.visuals) {
      const icon = iconOf(visual.id);
      expect(icon, `compiled runtime type ${visual.id}`).not.toBeNull();
      expect(ICON_SPRITE).toContain(`<symbol id="si-${icon}" `);
    }
  });

  it('ghost symbols exist for structures only; others fall back to the normal symbol', () => {
    expect(hasGhostIcon('struct_fac_land_t1')).toBe(true);
    expect(hasGhostIcon('land_direct_t1')).toBe(false);
    expect(iconSymbolId('struct_fac_land_t1', 'ghost')).toBe('si-struct_fac_land_t1--ghost');
    expect(iconSymbolId('land_direct_t1', 'ghost')).toBe('si-land_direct_t1');
    expect(iconMaskClass('land_direct_t1')).toBe('si-mask-land_direct_t1');
  });

  it('ensureIconSprite inserts once', () => {
    const a = ensureIconSprite(document);
    const b = ensureIconSprite(document);
    expect(a).toBe(b);
    expect(document.querySelectorAll(`#${ICON_SPRITE_ID}`)).toHaveLength(1);
    expect(a.querySelectorAll('symbol').length).toBe(ICON_IDS.length + GHOST_ICON_IDS.length);
  });

  it('IconSprite component mounts the sprite and renders nothing itself', () => {
    const { container } = render(
      <div>
        <IconSprite />
        <IconSprite />
      </div>,
    );
    expect(container.innerHTML).toBe('<div></div>');
    expect(document.querySelectorAll(`#${ICON_SPRITE_ID}`)).toHaveLength(1);
  });
});

describe('StrategicIcon', () => {
  it.each([
    ['core:eng_t1', 'eng_build_t1'],
    ['core:fac_land_t1', 'struct_fac_land_t1'],
    ['core:str_t1_estorage', 'struct_estore_t1'],
    ['core:cmd_commander_engineering', 'cmd_commander'],
    ['core:cmd_commander_armored', 'cmd_commander'],
    ['core:lnd_t3_heavy', 'land_direct_t3'],
    ['core:cube', 'blip_ground'],
  ])('renders the existing %s runtime glyph without a roster record', (typeId, icon) => {
    const { container } = render(<StrategicIcon typeId={typeId}/>);
    expect(container.querySelector('svg')?.getAttribute('data-icon')).toBe(icon);
    expect(container.querySelector('use')?.getAttribute('href')).toBe(`#si-${icon}`);
    expect(iconOf(typeId.slice('core:'.length))).toBe(icon);
  });

  it('renders one <svg><use> pair for a type id', () => {
    const { container } = render(<StrategicIcon typeId="core:lnd_t1_tank" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toBe('ff-si ff-sicon');
    expect(svg.getAttribute('data-component')).toBe('StrategicIcon');
    expect(svg.getAttribute('data-testid')).toBe('strategic-icon');
    expect(svg.getAttribute('data-icon')).toBe('land_direct_t1');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children).toHaveLength(1);
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#si-land_direct_t1');
  });

  it('icon prop wins; ghost uses the ghost symbol for structures', () => {
    const { container } = render(<StrategicIcon typeId="core:lnd_t1_tank" icon="struct_energy_t1" state="ghost" />);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#si-struct_energy_t1--ghost');
    expect(svg.classList.contains('is-ghost')).toBe(true);
    expect(svg.classList.contains('is-ghost-fallback')).toBe(false);
  });

  it('ghost of a mobile unit dims the normal symbol', () => {
    const { container } = render(<StrategicIcon typeId="core:lnd_t1_tank" state="ghost" />);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('use')!.getAttribute('href')).toBe('#si-land_direct_t1');
    expect(svg.classList.contains('is-ghost-fallback')).toBe(true);
  });

  it('team modifiers and explicit colour', () => {
    const { container } = render(
      <div>
        <StrategicIcon icon="land_bot_t1" team="enemy" />
        <StrategicIcon icon="land_bot_t1" team="neutral" />
        <StrategicIcon icon="land_bot_t1" color="var(--cvd-rot)" class="extra" data-testid="x" />
      </div>,
    );
    const [enemy, neutral, custom] = [...container.querySelectorAll('svg')];
    expect(enemy!.classList.contains('ff-si--enemy')).toBe(true);
    expect(neutral!.classList.contains('ff-si--neutral')).toBe(true);
    expect(custom!.getAttribute('style')).toContain('--team: var(--cvd-rot)');
    expect(custom!.classList.contains('extra')).toBe(true);
    expect(custom!.getAttribute('data-testid')).toBe('x');
  });

  it('accessible name when labelled', () => {
    const { container } = render(<StrategicIcon typeId="core:str_t1_mex" label="Zapfstelle I" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Zapfstelle I');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
  });

  it('renders nothing for unknown types or icons', () => {
    const { container } = render(
      <div>
        <StrategicIcon typeId="core:nope" />
        <StrategicIcon icon="nope" />
        <StrategicIcon />
      </div>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
});
