import type { JSX } from 'preact';
import { t } from '../i18n/t.ts';
import type { ResourceKind } from '../model/eco.ts';
import { LineIcon } from './LineIcon.tsx';
import { cx } from './cx.ts';

export interface ResourceGlyphProps {
  readonly kind: ResourceKind;
  /** "icon" = line icon (diamond/flame), "dot" = small solid glyph (.ff-res). */
  readonly variant?: 'icon' | 'dot' | undefined;
  readonly decorative?: boolean | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Resource glyph: diamond = mass, flame = energy (faction.md §6.3). */
export function ResourceGlyph({ kind, variant = 'icon', decorative = false, class: cls, testId }: ResourceGlyphProps): JSX.Element {
  const a11y = decorative
    ? { 'aria-hidden': 'true' as const }
    : { role: 'img' as const, 'aria-label': t(kind === 'mass' ? 'ui.common.resource.mass' : 'ui.common.resource.energy') };
  if (variant === 'dot') {
    return <span class={cx('ff-res', `ff-res--${kind}`, cls)} {...a11y} data-component="ResourceGlyph" data-testid={testId ?? `glyph-${kind}`} data-kind={kind} />;
  }
  return (
    <span class={cx('ff-resglyph', cls)} {...a11y} data-component="ResourceGlyph" data-testid={testId ?? `glyph-${kind}`} data-kind={kind}>
      <LineIcon name={kind} class={`ff-gi--${kind}`} />
    </span>
  );
}
