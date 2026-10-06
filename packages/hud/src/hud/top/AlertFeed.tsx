/**
 * Alert feed top right (ui.md §5.11): newest first, at most 3 visible plus "N ältere · Shift+␣ durchblättern".
 * Each alert: level symbol (octagon/triangle/circle/check), title with ×N, meta line (place, age from the sim
 * time), "Zum Ort" button (the newest carries the Space key). Critical alerts flash twice on arrival (off with
 * reduced motion); from 20 s they dim. The age and the stale class are 1 Hz signal bindings (no re-render).
 */
import { computed } from '@preact/signals';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import {
  ALERT_DEFS,
  alertLiveMode,
  isAlertFlashing,
  isAlertStale,
  newestJumpAlertId,
  olderAlertCount,
  visibleAlerts,
} from '../../model/alerts.ts';
import type { AlertItem } from '../../model/alerts.ts';
import { Key } from '../../ui/Key.tsx';
import { LevelSymbol } from '../../ui/LevelSymbol.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { cx } from '../../ui/cx.ts';
import { alertMeta, alertTitle } from './labels.ts';

/** Key glyphs shown on the buttons (Space, Shift+Space). */
export const SPACE_GLYPH = '␣';
export const SHIFT_SPACE_GLYPH = '⇧␣';

export interface AlertProps {
  readonly item: AlertItem;
  /** The alert Space jumps to (the newest one with a jump target) carries the key on its button. */
  readonly newest?: boolean | undefined;
}

export function Alert({ item, newest = false }: AlertProps): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const def = ALERT_DEFS[item.type];
  const timeS = model.match.timeS;
  // The flash is decided once when the alert appears (CSS animation, two iterations); merges do not re-flash.
  const flash = useMemo(
    () => isAlertFlashing(item, timeS.peek()) && model.reducedMotion.peek() !== 'on',
    [item.id], // once per alert id
  );
  const b = useMemo(
    () => ({
      cls: computed(() =>
        cx('ff-alert', `ff-alert--${def.level}`, flash && 'is-new', isAlertStale(item, timeS.value) && 'is-stale'),
      ),
      meta: computed(() => alertMeta(model.units.value, item, timeS.value, locale.value)),
    }),
    [item, def, flash, timeS, model.units],
  );
  const title = alertTitle(model.units.value, item, locale.value);
  const toFlow = def.jump === 'flowDetails';
  const jumpLabel = t(toFlow ? 'ui.alerts.jumpFlowLabel' : 'ui.alerts.jumpLabel', { title });
  return (
    <div
      class={b.cls}
      data-component="Alert"
      data-testid={`alert-${item.id}`}
      data-type={item.type}
      data-level={def.level}
      data-count={item.count}
      role="group"
      aria-label={title}
    >
      <span class="ff-alert__ico">
        <LevelSymbol level={def.level} testId={`alert-level-${item.id}`} />
      </span>
      <div class="ff-alert__txt">
        <div class="ff-alert__title" data-testid="alert-title">
          {title}
        </div>
        <div class="ff-alert__meta" data-testid="alert-meta">
          {b.meta}
        </div>
      </div>
      {def.jump === 'none' ? (
        <span class="ff-alert__nojump" />
      ) : (
        <button
          type="button"
          class="ff-alert__jump"
          aria-label={newest ? t('ui.common.withKey', { label: jumpLabel, key: t('ui.common.key.space') }) : jumpLabel}
          title={jumpLabel}
          data-testid={`alert-jump-${item.id}`}
          data-jump={def.jump}
          onClick={() => commands.jumpToAlert(item.id)}
        >
          <LineIcon name={toFlow ? 'energy' : 'jump'} />
          {newest ? <Key>{SPACE_GLYPH}</Key> : t(toFlow ? 'ui.alerts.jumpFlow' : 'ui.alerts.jump')}
        </button>
      )}
    </div>
  );
}

/** Feed of the active alerts (event driven: re-renders when alerts are added, merged or expire). */
export function AlertFeed(): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const items = model.alerts.items.value;
  const older = olderAlertCount(items, model.alerts.historyCount.value);
  const visible = visibleAlerts(items);
  const spaceId = newestJumpAlertId(items);
  return (
    <section
      class="alerts"
      data-component="AlertFeed"
      data-testid="alert-feed"
      data-panel={visible.length > 0 ? 'alerts' : undefined}
      aria-label={t('ui.alerts.feed')}
      aria-live={alertLiveMode(visible)}
      aria-relevant="additions text"
    >
      {visible.map((a) => (
        <Alert key={a.id} item={a} newest={a.id === spaceId} />
      ))}
      {older > 0 ? (
        <button
          type="button"
          class="alerts__more"
          aria-label={t('ui.common.withKey', {
            label: t('ui.alerts.cycleLabel', { n: older }),
            key: `${t('ui.common.key.shift')}+${t('ui.common.key.space')}`,
          })}
          data-testid="alerts-more"
          onClick={() => commands.cycleAlerts()}
        >
          {t('ui.alerts.more', { n: older })}
          <Key>{SHIFT_SPACE_GLYPH}</Key>
          {t('ui.alerts.cycle')}
        </button>
      ) : null}
    </section>
  );
}
