import {
  ALERT_DEFS, alertMeta, isAlertStale, olderAlertCount, visibleAlerts,
  useCommands, useHud, t,
} from '@faf/hud';
import { liveNoticeCanJump, liveNoticeFlow, liveNoticeText } from './notice-text.ts';

/** Compact presentation of the existing authoritative event feed. */
export function LiveNotices() {
  const m = useHud(), c = useCommands();
  const older = olderAlertCount(m.alerts.items.value, m.alerts.historyCount.value);
  return <div class="alerts live-notices" data-component="AlertFeed" data-testid="alert-feed" data-panel="alerts">
    {visibleAlerts(m.alerts.items.value).map(item => {
      const level = ALERT_DEFS[item.type].level, jumpable = liveNoticeCanJump(item);
      const text = liveNoticeText(item, m.locale.value), flow = liveNoticeFlow(item, m.locale.value);
      const flowText = flow === null ? null : `${t('ui.alerts.jumpFlow', undefined, m.locale.value)} ${flow}`;
      const label = `${text}${flowText === null ? '' : `, ${flowText}`}`;
      const content = <><span class="live-notice-text">{text}</span>{flowText !== null && <span class="live-notice-flow">{flowText}</span>}{jumpable && <span class="live-notice-jump" aria-hidden="true">↗</span>}</>;
      const props = {
        class: `live-notice live-notice--${level} ${isAlertStale(item, m.match.timeS.value) ? 'is-stale' : ''}`,
        'data-testid': `alert-${item.id}`,
        title: `${label}. ${alertMeta(item, m.match.timeS.value, m.locale.value)}`,
      };
      return <div key={item.id} class="live-notice-row" role="status" aria-live={level === 'crit' ? 'assertive' : 'polite'}>
        {jumpable ? <button type="button" {...props} aria-label={`${label}. ${t('ui.alerts.jump', undefined, m.locale.value)}`} onClick={() => {
          if (ALERT_DEFS[item.type].jump === 'flowDetails' && !m.eco.detailsOpen.peek()) c.toggleFlowDetails();
          c.jumpToAlert(item.id);
        }}>{content}</button> : <div {...props}>{content}</div>}
      </div>;
    })}
    {older > 0 && <button class="alerts__more" type="button" aria-label={t('ui.alerts.cycleLabel', { n: older })} onClick={() => c.cycleAlerts()}>{t('ui.alerts.more', { n: older })}{t('ui.alerts.cycle')} <span aria-hidden="true">⇧ Space</span></button>}
  </div>;
}
