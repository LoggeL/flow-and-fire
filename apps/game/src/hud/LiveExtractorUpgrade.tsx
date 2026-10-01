import { Bar, Panel, ResourceGlyph, fmtDec, fmtPct, useHud } from '@faf/hud';
import type { GameHudController } from './live.ts';
import { liveUnitText } from './unit-text.ts';

type UpgradeController = Pick<GameHudController, 'extractorUpgrade' | 'startExtractorUpgrade' | 'pauseExtractorUpgrade' | 'cancelExtractorUpgrade'>;

/** Selected extractors expose their real accepted successor, paid work and economy. */
export function LiveExtractorUpgrade({ controller }: { readonly controller: UpgradeController }) {
  const m = useHud(), upgrade = controller.extractorUpgrade.value;
  if (!upgrade) return null;
  const en = m.locale.value === 'en', busy = upgrade.active || upgrade.queued;
  const number = (value: number) => fmtDec(value, 0, m.locale.value);
  const percentage = fmtPct(upgrade.progress, 0, m.locale.value);
  const target = upgrade.targetTypeId === null ? null : liveUnitText(upgrade.targetTypeId, 'name', m.locale.value);
  const improvements = `${en ? 'Mass/s' : 'Masse/s'} ${number(upgrade.massIncome)} → ${number(upgrade.targetMassIncome)} · ${en ? 'Energy/s' : 'Energie/s'} −${number(upgrade.energyUpkeep)} → −${number(upgrade.targetEnergyUpkeep)} · HP ${number(upgrade.hpMax)} → ${number(upgrade.targetHpMax)}`;
  const status = upgrade.queued && !upgrade.active ? (en ? 'Queued' : 'Eingereiht')
    : upgrade.paused ? (en ? 'Paused' : 'Pausiert')
    : upgrade.stalled ? (en ? 'Waiting for resources' : 'Wartet auf Ressourcen')
    : upgrade.remainingS === null ? (en ? 'Upgrading' : 'Ausbau läuft') : `${number(upgrade.remainingS)} s`;
  return <Panel class="live-commander-upgrade" panelId="extractor-upgrades" testId="extractor-upgrades" component="ExtractorUpgrades">
    <div class="live-upgrade-heading"><b>{liveUnitText(upgrade.currentTypeId, 'name', m.locale.value)} · T{upgrade.tier}</b>{busy && <span>{status}</span>}</div>
    {target === null ? <div class="live-upgrade-complete">{en ? 'Fully upgraded' : 'Voll ausgebaut'} · {number(upgrade.massIncome)} M/s</div>
      : busy ? <div class="live-upgrade-running">
        <div class="live-upgrade-progress-label"><span>{target}</span><span>{percentage}</span></div>
        <Bar kind="build" value={upgrade.progress} testId="extractor-upgrade-progress" label={`${target}: ${percentage}`}/>
        <div class="live-upgrade-running-actions"><button type="button" data-testid="extractor-upgrade-pause" disabled={!upgrade.active || !upgrade.controllable} onClick={() => controller.pauseExtractorUpgrade()}>{upgrade.paused ? (en ? 'Resume' : 'Fortsetzen') : 'Pause'}</button><button type="button" data-testid="extractor-upgrade-cancel" disabled={!upgrade.controllable} title={upgrade.paused ? (en ? 'Cancels the upgrade and resumes the unit' : 'Bricht den Ausbau ab und setzt die Einheit fort') : undefined} onClick={() => controller.cancelExtractorUpgrade()}>{upgrade.paused ? (en ? 'Cancel & resume' : 'Abbrechen + fortsetzen') : (en ? 'Cancel' : 'Abbrechen')}</button></div>
        {upgrade.paused && <div class="live-upgrade-paused-note" data-testid="extractor-upgrade-paused-note">{en ? 'Paused: mass output and the upgrade are idle.' : 'Pausiert: Masseförderung und Ausbau ruhen.'}</div>}
      </div>
      : <button class="live-upgrade-start" type="button" data-testid="extractor-upgrade-start" disabled={!upgrade.enabled || !upgrade.controllable} aria-label={`${en ? 'Upgrade' : 'Ausbauen'}: ${target}. ${number(upgrade.mass)} M, ${number(upgrade.energy)} E. ${improvements}`} title={improvements} onClick={() => controller.startExtractorUpgrade()}>
        <ResourceGlyph kind="mass" decorative/><span>T{upgrade.targetTier}</span>
        <span class="live-upgrade-target"><b>{target}</b><small>{improvements}</small></span>
        <span class="live-upgrade-cost"><span class="live-upgrade-mass">{number(upgrade.mass)} M</span><span>{number(upgrade.energy)} E</span></span>
      </button>}
  </Panel>;
}
