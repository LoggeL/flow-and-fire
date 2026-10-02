import { Bar, Panel, fmtDec, fmtPct, useHud } from '@faf/hud';
import type { GameHudController } from './live.ts';
import { liveUnitText } from './unit-text.ts';
import { BuildPortrait } from './BuildPortrait.tsx';

type UpgradeController = Pick<GameHudController, 'factoryUpgrade' | 'startFactoryUpgrade' | 'pauseFactoryUpgrade' | 'cancelFactoryUpgrade'>;

/** A selected completed factory shows its real paid successor and what that successor unlocks. */
export function LiveFactoryUpgrade({ controller }: { readonly controller: UpgradeController }) {
  const m = useHud(), upgrade = controller.factoryUpgrade.value;
  if (!upgrade) return null;
  const en = m.locale.value === 'en', busy = upgrade.active || upgrade.queued;
  const number = (value: number) => fmtDec(value, 0, m.locale.value);
  const percentage = fmtPct(upgrade.progress, 0, m.locale.value);
  const name = (id: string) => liveUnitText(id, 'name', m.locale.value);
  const target = upgrade.targetTypeId === null ? null : name(upgrade.targetTypeId);
  const unlocks = upgrade.unlocks.map(name).join(', ');
  const improvements = `${en ? 'Build power' : 'Baukraft'} ${number(upgrade.buildPower)} → ${number(upgrade.targetBuildPower)} · HP ${number(upgrade.hpMax)} → ${number(upgrade.targetHpMax)}${unlocks ? ` · ${en ? 'unlocks' : 'neu'}: ${unlocks}` : ''}`;
  const status = upgrade.queued && !upgrade.active ? (en ? 'Queued' : 'Eingereiht')
    : upgrade.paused ? (en ? 'Paused' : 'Pausiert')
    : upgrade.stalled ? (en ? 'Waiting for resources' : 'Wartet auf Ressourcen')
    : upgrade.remainingS === null ? (en ? 'Upgrading' : 'Ausbau läuft') : `${number(upgrade.remainingS)} s`;
  return <Panel class="live-commander-upgrade live-factory-upgrade" panelId="factory-upgrades" testId="factory-upgrades" component="FactoryUpgrades">
    <div class="live-upgrade-heading"><b>{name(upgrade.currentTypeId)}</b>{busy && <span>{status}</span>}</div>
    {target === null ? <div class="live-upgrade-complete">{en ? 'Fully upgraded' : 'Voll ausgebaut'} · {en ? 'Build power' : 'Baukraft'} {number(upgrade.buildPower)}</div>
      : busy ? <div class="live-upgrade-running">
        <div class="live-factory-upgrade-transition"><BuildPortrait typeId={upgrade.targetTypeId!} role="factory" tier={upgrade.targetTier ?? 0}/><b>T{upgrade.tier} → T{upgrade.targetTier}</b><span>{number(upgrade.mass)} M · {number(upgrade.energy)} E</span></div>
        <div class="live-upgrade-progress-label"><span>{target}</span><span>{percentage}</span></div>
        <Bar kind="build" value={upgrade.progress} testId="factory-upgrade-progress" label={`${target}: ${percentage}`}/>
        <div class="live-upgrade-running-actions"><button type="button" data-testid="factory-upgrade-pause" disabled={!upgrade.active || !upgrade.controllable} onClick={() => controller.pauseFactoryUpgrade()}>{upgrade.paused ? (en ? 'Resume' : 'Fortsetzen') : 'Pause'}</button><button type="button" data-testid="factory-upgrade-cancel" disabled={!upgrade.controllable} title={en ? 'Cancels the upgrade; the production queue is kept' : 'Bricht den Ausbau ab; die Bauliste bleibt erhalten'} onClick={() => controller.cancelFactoryUpgrade()}>{upgrade.paused ? (en ? 'Cancel & resume' : 'Abbrechen + fortsetzen') : (en ? 'Cancel' : 'Abbrechen')}</button></div>
        <div class="live-upgrade-paused-note" data-testid="factory-upgrade-note">{upgrade.paused ? (en ? 'Paused: the upgrade and production are idle.' : 'Pausiert: Ausbau und Produktion ruhen.') : (en ? 'No production while upgrading; the queue continues afterwards.' : 'Während des Ausbaus ruht die Produktion; die Bauliste läuft danach weiter.')}</div>
      </div>
      : <button class="live-upgrade-start" type="button" data-testid="factory-upgrade-start" disabled={!upgrade.enabled || !upgrade.controllable} aria-label={`${en ? 'Upgrade' : 'Ausbauen'}: ${target}. ${number(upgrade.mass)} M, ${number(upgrade.energy)} E. ${improvements}`} title={improvements} onClick={() => controller.startFactoryUpgrade()}>
        <BuildPortrait typeId={upgrade.targetTypeId!} role="factory" tier={upgrade.targetTier ?? 0}/>
        <span class="live-upgrade-target"><b>{target}</b><small>{improvements}</small></span>
        <span class="live-upgrade-cost"><span class="live-upgrade-mass">{number(upgrade.mass)} M</span><span>{number(upgrade.energy)} E</span></span>
      </button>}
  </Panel>;
}
