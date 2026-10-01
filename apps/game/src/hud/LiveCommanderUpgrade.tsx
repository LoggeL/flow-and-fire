import { Bar, Panel, fmtDec, fmtPct, useHud } from '@faf/hud';
import type { GameHudController } from './live.ts';
import { liveUnitText } from './unit-text.ts';
import engineeringIcon from '../assets/ui/acu-engineering.png';
import armorIcon from '../assets/ui/acu-armor.png';

type UpgradeController = Pick<GameHudController, 'commanderUpgrade' | 'startCommanderUpgrade' | 'pauseCommanderUpgrade' | 'cancelCommanderUpgrade'>;

/** Enhancement controls stay visible alongside construction, using accepted upgrade state. */
export function LiveCommanderUpgrade({ controller }: { readonly controller: UpgradeController }) {
  const m = useHud(), upgrade = controller.commanderUpgrade.value;
  if (!upgrade) return null;
  const en = m.locale.value === 'en', busy = upgrade.active || upgrade.queued;
  const number = (value: number) => fmtDec(value, 0, m.locale.value);
  const percentage = fmtPct(upgrade.progress, 0, m.locale.value);
  const target = upgrade.targetTypeId === null ? null : liveUnitText(upgrade.targetTypeId, 'name', m.locale.value);
  const improvements = `${en ? 'Build power' : 'Baukraft'} ${number(upgrade.buildPower)} → ${number(upgrade.targetBuildPower)} · HP ${number(upgrade.hpMax)} → ${number(upgrade.targetHpMax)}`;
  const cost = `${number(upgrade.mass)} M · ${number(upgrade.energy)} E`;
  const status = upgrade.queued && !upgrade.active ? (en ? 'Queued' : 'Eingereiht')
    : upgrade.paused ? (en ? 'Paused' : 'Pausiert')
    : upgrade.stalled ? (en ? 'Waiting for resources' : 'Wartet auf Ressourcen')
    : upgrade.remainingS === null ? (en ? 'Upgrading' : 'Ausbau läuft') : `${number(upgrade.remainingS)} s`;
  const commander = liveUnitText('core:cmd_commander', 'name', m.locale.value);
  return <Panel class="live-commander-upgrade" panelId="commander-upgrades" testId="commander-upgrades" component="CommanderUpgrades">
    <div class="live-upgrade-heading"><b>{en ? `${commander} upgrades` : `${commander}-Ausbau`}</b>{busy && <span>{status}</span>}</div>
    {target === null ? <div class="live-upgrade-complete">{en ? 'Fully upgraded' : 'Voll ausgebaut'} · {en ? 'Build power' : 'Baukraft'} {number(upgrade.buildPower)} · HP {number(upgrade.hpMax)}</div>
      : busy ? <div class="live-upgrade-running">
        <div class="live-upgrade-progress-label"><span>{target}</span><span>{percentage}</span></div>
        <Bar kind="build" value={upgrade.progress} testId="commander-upgrade-progress" label={`${target}: ${percentage}`}/>
        <div class="live-upgrade-running-actions"><button type="button" data-testid="commander-upgrade-pause" disabled={!upgrade.active || !upgrade.controllable} onClick={() => controller.pauseCommanderUpgrade()}>{upgrade.paused ? (en ? 'Resume' : 'Fortsetzen') : 'Pause'}</button><button type="button" data-testid="commander-upgrade-cancel" disabled={!upgrade.controllable} title={upgrade.paused ? (en ? 'Cancels the upgrade and resumes the unit' : 'Bricht den Ausbau ab und setzt die Einheit fort') : undefined} onClick={() => controller.cancelCommanderUpgrade()}>{upgrade.paused ? (en ? 'Cancel & resume' : 'Abbrechen + fortsetzen') : (en ? 'Cancel' : 'Abbrechen')}</button></div>
        {upgrade.paused && <div class="live-upgrade-paused-note" data-testid="commander-upgrade-paused-note">{en ? `Paused: the ${commander}'s own income and build power are idle.` : `Pausiert: Eigenproduktion und Baukraft des ${commander}s ruhen.`}</div>}
      </div>
      : <button class="live-upgrade-start" type="button" data-testid="commander-upgrade-start" disabled={!upgrade.enabled || !upgrade.controllable} aria-label={`${en ? 'Upgrade' : 'Ausbauen'}: ${target}. ${cost}. ${improvements}`} title={improvements} onClick={() => controller.startCommanderUpgrade()}>
        <img src={upgrade.targetTypeId === 'core:cmd_commander_armored' ? armorIcon : engineeringIcon} alt="" aria-hidden="true"/>
        <span class="live-upgrade-target"><b>{target}</b><small>{improvements}</small></span>
        <span class="live-upgrade-cost"><span class="live-upgrade-mass">{number(upgrade.mass)} M</span><span>{number(upgrade.energy)} E</span></span>
      </button>}
  </Panel>;
}
