import type { JSX } from 'preact';
import { cx } from './cx.ts';
import { ensureLineIconSprite } from './icons.ts';
import type { LineIconName } from './icons.ts';

export interface LineIconProps {
  readonly name: LineIconName;
  /** Extra classes, e.g. "ff-gi--mass". */
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

/** Line icon as `<svg><use>` into the shared sprite (one DOM node pair per icon, ui.md §9.2). Decorative. */
export function LineIcon({ name, class: cls, testId }: LineIconProps): JSX.Element {
  ensureLineIconSprite();
  return (
    <svg
      class={cx('ff-gi', cls)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-component="LineIcon"
      data-testid={testId ?? `line-icon-${name}`}
      data-icon={name}
    >
      <use href={`#gi-${name}`} />
    </svg>
  );
}
