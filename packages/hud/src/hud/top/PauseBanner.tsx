/**
 * Pause and speed banner, top centre (ui.md §5.3): pause (A5), background pause (S9), speed ≠ 1 (A6),
 * sim lag and WebGL context loss (P10). Event driven: re-renders only when the banner kind or its value changes.
 */
import { computed } from '@preact/signals';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { fmtDec } from '../../format/index.ts';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { bannerKind } from '../../model/status.ts';
import type { BannerKind } from '../../model/status.ts';
import { Key } from '../../ui/Key.tsx';
import { LevelSymbol } from '../../ui/LevelSymbol.tsx';
import { keyLabel } from '../../ui/keys.ts';

/** Physical key of pause / resume (A5). */
export const PAUSE_KEY_CODE = 'KeyP';

export function PauseBanner(): JSX.Element | null {
  const model = useHud();
  const commands = useCommands();
  const match = model.match;
  const kind = useMemo(
    () => computed<BannerKind | null>(() => bannerKind(match.pause.value, match.speed.value, match.simLag.value, match.contextLost.value)),
    [match],
  ).value;
  if (kind === null) return null;
  const common = { 'data-component': 'PauseBanner', 'data-testid': 'pause-banner', 'data-panel': 'banner', 'data-kind': kind, role: 'status' as const };

  if (kind === 'pause' || kind === 'background') {
    const layout = model.keyboardLayout.value;
    return (
      <div class="banner ff-panel ff-panel--ember" {...common}>
        <div class="banner__title">{t('ui.status.banner.pause')}</div>
        <div class="banner__sub">
          {kind === 'background' ? `${t('ui.status.banner.background')} · ` : `${t('ui.status.banner.pauseSub')} `}
          <button
            type="button"
            class="banner__resume"
            data-testid="banner-resume"
            aria-label={t('ui.common.withKey', { label: t('ui.status.banner.resume'), key: keyLabel(PAUSE_KEY_CODE, layout) })}
            onClick={() => commands.togglePause()}
          >
            <Key code={PAUSE_KEY_CODE} layout={layout} />
            {t('ui.status.banner.resume')}
          </button>
        </div>
      </div>
    );
  }
  if (kind === 'speed') {
    return (
      <div class="banner banner--speed ff-panel" {...common}>
        <div class="banner__title num">{t('ui.status.banner.speed', { value: fmtDec(match.speed.value, 1) })}</div>
      </div>
    );
  }
  if (kind === 'simLag') {
    return (
      <div class="banner banner--note banner--lag ff-panel" {...common}>
        <div class="banner__title">
          <LevelSymbol level="warn" />
          <span class="num">{t('ui.status.banner.lag', { value: fmtDec(match.simLag.value ?? 1, 1) })}</span>
        </div>
      </div>
    );
  }
  return (
    <div class="banner banner--note banner--context ff-panel" {...common}>
      <div class="banner__title">
        <LevelSymbol level="info" />
        <span>{t('ui.status.banner.contextLoss')}</span>
      </div>
    </div>
  );
}
