/**
 * Match status top right (ui.md §5.2): timer (sim time, 1 Hz), sim speed with −/+ buttons (ember when ≠ ×1.0),
 * units / cap (yellow from 90 %, red at the cap), scores only in replays (UI-E3, A19), menu button (Esc).
 */
import { computed } from '@preact/signals';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { MINUS, fmtDec, fmtInt, fmtTime } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { capLevel, isSpeedChanged } from '../../model/status.ts';
import type { CapLevel, MatchSection } from '../../model/status.ts';
import { LineIcon } from '../../ui/LineIcon.tsx';
import type { LineIconName } from '../../ui/icons.ts';
import { cx } from '../../ui/cx.ts';

/** "×1,0" / "×2.0". */
export function speedText(speed: number): string {
  return t('ui.status.speedValue', { value: fmtDec(speed, 1) });
}

const CAP_ICON: Readonly<Record<CapLevel, LineIconName>> = { normal: 'cap', near: 'warn', reached: 'crit' };

function capBindings(match: MatchSection) {
  const level = computed(() => capLevel(match.units.value, match.unitCap.value));
  return {
    level,
    units: computed(() => fmtInt(match.units.value)),
    cap: computed(() => `/ ${fmtInt(match.unitCap.value)}`),
    label: computed(() => {
      const p = { units: fmtInt(match.units.value), cap: fmtInt(match.unitCap.value) };
      const l = level.value;
      return t(l === 'reached' ? 'ui.status.capReached' : l === 'near' ? 'ui.status.capNear' : 'ui.status.units', p);
    }),
  };
}

/** Units / cap; the icon turns into warning triangle / octagon at 90 % / at the cap (never colour alone). */
function CapStat({ match }: { readonly match: MatchSection }): JSX.Element {
  const b = useMemo(() => capBindings(match), [match]);
  const level = b.level.value;
  return (
    <div
      class={cx('stat', 'stat--cap', level === 'near' && 'is-near', level === 'reached' && 'is-reached')}
      role="img"
      aria-label={b.label}
      title={b.label}
      data-testid="status-cap"
      data-level={level}
    >
      <LineIcon name={CAP_ICON[level]} />
      <b class="num" data-testid="status-units">
        {b.units}
      </b>
      <span class="ff-lo num">{b.cap}</span>
    </div>
  );
}

/** Scores of both houses (replay only in the MVP). */
function ScoreStat({ match }: { readonly match: MatchSection }): JSX.Element | null {
  const scores = match.scores.value;
  if (!match.replay.value || scores === null) return null;
  const self = fmtInt(scores.self);
  const enemy = fmtInt(scores.enemy);
  return (
    <div class="stat stat--score" title={t('ui.status.score', { self, enemy })} data-testid="status-score">
      <LineIcon name="score" />
      <span class="score-chip score-chip--self">
        <i />
        <b class="num">{self}</b>
      </span>
      <span class="score-chip score-chip--enemy">
        <i />
        <b class="num">{enemy}</b>
      </span>
    </div>
  );
}

export function MatchStatus(): JSX.Element {
  const model = useHud();
  const commands = useCommands();
  const match = model.match;
  const b = useMemo(
    () => ({
      time: computed(() => fmtTime(match.timeS.value)),
      speed: computed(() => speedText(match.speed.value)),
      speedTitle: computed(() => t('ui.status.speed', { value: speedText(match.speed.value) })),
      speedClass: computed(() => cx('stat', 'stat--speed', isSpeedChanged(match.speed.value) && 'is-changed')),
    }),
    [match],
  );
  return (
    <section
      class="status ff-panel"
      data-component="MatchStatus"
      data-testid="match-status"
      data-panel="status"
      aria-label={t('ui.status.region')}
    >
      <div class="status__inner">
        <div class="stat stat--timer" title={t('ui.status.timer')} data-testid="status-timer">
          <LineIcon name="timer" />
          <b class="num">{b.time}</b>
        </div>
        <div class={b.speedClass} title={b.speedTitle} data-testid="status-speed">
          <LineIcon name="speed" />
          <button
            type="button"
            class="stat__step"
            aria-label={t('ui.common.withKey', { label: t('ui.status.slower'), key: MINUS })}
            data-testid="status-slower"
            onClick={() => commands.changeSpeed(-1)}
          >
            {MINUS}
          </button>
          <b class="num" data-testid="status-speed-value">
            {b.speed}
          </b>
          <button
            type="button"
            class="stat__step"
            aria-label={t('ui.common.withKey', { label: t('ui.status.faster'), key: '+' })}
            data-testid="status-faster"
            onClick={() => commands.changeSpeed(1)}
          >
            {'+'}
          </button>
        </div>
        <CapStat match={match} />
        <ScoreStat match={match} />
        <button
          type="button"
          class="status__menu"
          aria-label={t('ui.common.withKey', { label: t('ui.status.menu'), key: t('ui.common.key.esc') })}
          title={t('ui.common.withKey', { label: t('ui.status.menu'), key: t('ui.common.key.esc') })}
          data-testid="status-menu"
          onClick={() => commands.openGameMenu()}
        >
          <LineIcon name="menu" />
        </button>
      </div>
    </section>
  );
}
