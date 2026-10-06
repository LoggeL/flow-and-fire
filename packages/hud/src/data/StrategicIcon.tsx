import type { JSX } from 'preact';
import { useLayoutEffect } from 'preact/hooks';
import { useUnitCatalog } from '../model/index.ts';
import { cx } from '../ui/cx.ts';
import { ensureIconSprite, hasGhostIcon, iconOf, iconSymbolId, isIconId } from './icons.ts';
import type { IconState } from './icons.ts';

/** Team colour source of an icon: the own house, the enemy, neutral grey, or inherited from CSS. */
export type IconTeam = 'self' | 'enemy' | 'neutral';

export interface StrategicIconProps {
  /** Unit type id (`core:lnd_t1_tank`); its icon from the unit catalog of the HudProvider is shown. */
  readonly typeId?: string;
  /** Icon name from content/icons (`land_direct_t1`, `blip_air` …); wins over typeId. */
  readonly icon?: string;
  readonly state?: IconState;
  /** Team colour via the .ff-si modifiers (default: own team). */
  readonly team?: IconTeam;
  /** Explicit team colour (any CSS colour or var()); sets --team on the element. */
  readonly color?: string;
  /** Accessible name; without it the icon is decorative (aria-hidden). */
  readonly label?: string;
  readonly class?: string;
  readonly 'data-testid'?: string;
}

/**
 * Strategic icon as one <svg><use> pair (ui.md §9.2) referencing the sprite from IconSprite. The team
 * colour reaches the symbol through the CSS variable --team.
 */
export function StrategicIcon(props: StrategicIconProps): JSX.Element | null {
  const units = useUnitCatalog();
  const name = props.icon ?? (props.typeId !== undefined ? iconOf(units, props.typeId) : null);
  if (name === null || name === undefined || !isIconId(name)) return null;
  const state = props.state ?? 'normal';
  const style = props.color !== undefined ? { '--team': props.color } : undefined;
  const labelled = props.label !== undefined && props.label !== '';
  return (
    <svg
      class={cx(
        'ff-si',
        'ff-sicon',
        props.team === 'enemy' && 'ff-si--enemy',
        props.team === 'neutral' && 'ff-si--neutral',
        state === 'ghost' && 'is-ghost',
        state === 'ghost' && !hasGhostIcon(name) && 'is-ghost-fallback',
        props.class,
      )}
      style={style}
      data-component="StrategicIcon"
      data-testid={props['data-testid'] ?? 'strategic-icon'}
      data-icon={name}
      data-state={state}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? props.label : undefined}
      aria-hidden={labelled ? undefined : 'true'}
      focusable="false"
    >
      <use href={`#${iconSymbolId(name, state)}`} />
    </svg>
  );
}

/**
 * Inserts the strategic icon sprite into the document once (mount it near the app root). Renders nothing.
 */
export function IconSprite(): null {
  useLayoutEffect(() => {
    ensureIconSprite(document);
  }, []);
  return null;
}
