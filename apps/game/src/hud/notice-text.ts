import { ALERT_DEFS, fmtPct, t, type AlertItem, type Locale } from '@faf/hud';
import { liveUnitText } from './unit-text.ts';

/** One readable line from an actual event, without age/location boilerplate. */
export function liveNoticeText(item: AlertItem, locale: Locale): string {
  let title = t(`ui.alerts.type.${item.type}`, undefined, locale);
  if (item.subjectTypeId) title = t('ui.alerts.withSubject', {
    title, subject: liveUnitText(item.subjectTypeId, 'name', locale),
  }, locale);
  if (item.count > 1) title = t('ui.alerts.count', { title, n: item.count }, locale);
  return title;
}

export function liveNoticeFlow(item: AlertItem, locale: Locale): string | null {
  return (item.type === 'massStall' || item.type === 'energyStall') && item.flow !== undefined
    ? fmtPct(item.flow, 0, locale) : null;
}

/** Storage notices have no destination; economy notices open the real flow details. */
export function liveNoticeCanJump(item: AlertItem): boolean {
  const target = ALERT_DEFS[item.type].jump;
  return target === 'flowDetails' || (target !== 'none' && item.location !== null);
}
