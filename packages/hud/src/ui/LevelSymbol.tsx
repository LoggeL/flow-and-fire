import type { JSX } from 'preact';
import { t } from '../i18n/t.ts';
import type { AlertLevel } from '../model/alerts.ts';
import { LineIcon } from './LineIcon.tsx';
import { cx } from './cx.ts';

/** Shape per level (ui.md §8.1): octagon / triangle / circle / circle with check. */
export const LEVEL_ICON = { crit: 'crit', warn: 'warn', info: 'info', ok: 'ok' } as const satisfies Record<AlertLevel, string>;

export interface LevelSymbolProps {
  readonly level: AlertLevel;
  /** Hide from assistive tech when the text next to it already names the level. */
  readonly decorative?: boolean | undefined;
  readonly class?: string | undefined;
  readonly testId?: string | undefined;
}

export function LevelSymbol({ level, decorative = false, class: cls, testId }: LevelSymbolProps): JSX.Element {
  return (
    <span
      class={cx('ff-level', `ff-level--${level}`, cls)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : t(`ui.common.level.${level}`)}
      aria-hidden={decorative ? 'true' : undefined}
      data-component="LevelSymbol"
      data-testid={testId ?? `level-${level}`}
      data-level={level}
    >
      <LineIcon name={LEVEL_ICON[level]} />
    </span>
  );
}
