import { Bar, Panel, fmtDec, fmtPct, useHud } from '@faf/hud';
import { useState } from 'preact/hooks';
import type { GameHudController } from './live.ts';
import { liveUnitText } from './unit-text.ts';

type UpgradeController = Pick<GameHudController, 'commanderUpgrade' | 'startCommanderUpgrade' | 'pauseCommanderUpgrade' | 'cancelCommanderUpgrade'>;
type Enhancement = NonNullable<GameHudController['commanderUpgrade']['value']>['enhancements'][number];
type Slot = Enhancement['slot'];
const SLOTS: readonly Slot[] = ['left', 'back', 'right'];
const SLOT_NAMES = { left: ['Linker Arm', 'Left arm'], right: ['Rechter Arm', 'Right arm'], back: ['Rücken', 'Back'] } as const;
const MODULE_NAMES = { engineering: ['Baumodul', 'Engineering suite'], cannon: ['Hauptwaffen-Verstärker', 'Main cannon amplifier'], armor: ['Rückenpanzerung', 'Back armor'] } as const;

/** A slot schematic, not a selected-unit portrait. The lit component identifies the fitted system. */
function SlotGlyph({ slot }: { readonly slot: Slot }) {
  return <svg class="live-enhancement-glyph" viewBox="0 0 36 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
    <path class={slot === 'back' ? 'is-lit' : ''} d="M12 9 15 6h6l3 3v15l-3 3h-6l-3-3Z"/>
    <path class={slot === 'left' ? 'is-lit' : ''} d="M25 11h6l2 3v12h-7l-1-3Z"/>
    <path class={slot === 'right' ? 'is-lit' : ''} d="M11 11H5l-2 3v12h7l1-3Z"/>
    <path d="M15 3h6v4M13 28v5h4v-6m6 1v5h-4v-6"/>
    {slot === 'left' && <path class="is-lit" d="m28 16 3 3-3 3m0-3h-3"/>}
    {slot === 'right' && <path class="is-lit" d="M6 22V12m-2 4h4"/>}
    {slot === 'back' && <path class="is-lit" d="m18 12 4 2v5l-4 4-4-4v-5Z"/>}
  </svg>;
}

/** Each independently paid module occupies its original-style body slot. All effects come from accepted blueprints. */
export function LiveCommanderUpgrade({ controller }: { readonly controller: UpgradeController }) {
  const m = useHud(), upgrade = controller.commanderUpgrade.value;
  const [choice, setChoice] = useState<{ handle: number; slot: Slot } | null>(null);
  if (!upgrade) return null;
  const en = m.locale.value === 'en', language = en ? 1 : 0, busy = upgrade.active || upgrade.queued;
  const number = (value: number) => fmtDec(value, 0, m.locale.value);
  const slotName = (slot: Slot) => SLOT_NAMES[slot][language];
  const name = (item: Enhancement) => MODULE_NAMES[item.id][language];
  const chosenSlot = choice?.handle === upgrade.handle ? choice.slot : 'left';
  const selected = upgrade.enhancements.find(item => item.slot === chosenSlot)!;
  const working = upgrade.enhancements.find(item => item.id === upgrade.activeEnhancementId) ?? selected;
  const improvements = (item: Enhancement) => [
    item.targetBuildPower !== upgrade.buildPower ? `${en ? 'Build power' : 'Baukraft'} ${number(upgrade.buildPower)} → ${number(item.targetBuildPower)}` : null,
    item.targetHpMax !== upgrade.hpMax ? `HP ${number(upgrade.hpMax)} → ${number(item.targetHpMax)}` : null,
    item.targetWeaponRange !== upgrade.weaponRange ? `${en ? 'Range' : 'Reichweite'} ${number(upgrade.weaponRange)} → ${number(item.targetWeaponRange)}` : null,
    item.targetWeaponDps !== upgrade.weaponDps ? `DPS ${number(upgrade.weaponDps)} → ${number(item.targetWeaponDps)}` : null,
  ].filter(Boolean).join(' · ');
  const percentage = fmtPct(upgrade.progress, 0, m.locale.value);
  const status = upgrade.queued && !upgrade.active ? (en ? 'Queued' : 'Eingereiht')
    : upgrade.paused ? (en ? 'Paused' : 'Pausiert')
    : upgrade.stalled ? (en ? 'Waiting for resources' : 'Wartet auf Ressourcen')
    : upgrade.remainingS === null ? (en ? 'Upgrading' : 'Ausbau läuft') : `${number(upgrade.remainingS)} s`;
  const commander = liveUnitText('core:cmd_commander', 'name', m.locale.value);
  return <Panel class="live-commander-upgrade live-enhancements" panelId="commander-upgrades" testId="commander-upgrades" component="CommanderUpgrades">
    <div class="live-upgrade-heading"><b>{commander} · {en ? 'Enhancements' : 'Ausbauten'}</b><span>{busy ? status : `${upgrade.enhancements.filter(item => item.installed).length} / 3`}</span></div>
    <div class="live-enhancement-slots" role="group" aria-label={en ? 'Enhancement slots' : 'Ausbauplätze'}>
      {SLOTS.map(slot => {
        const item = upgrade.enhancements.find(candidate => candidate.slot === slot)!;
        const fitting = busy && working.id === item.id;
        return <button key={slot} type="button" data-testid={`commander-slot-${slot}`} data-installed={item.installed} class={`live-enhancement-slot ${chosenSlot === slot ? 'is-selected' : ''} ${item.installed ? 'is-installed' : ''} ${fitting ? 'is-fitting' : ''}`} aria-pressed={chosenSlot === slot} title={`${slotName(slot)}: ${name(item)}${item.installed ? ` · ${en ? 'Installed' : 'Installiert'}` : ''}`} onClick={() => setChoice({ handle: upgrade.handle, slot })}>
          <SlotGlyph slot={slot}/><span>{slotName(slot)}<small>{item.installed ? (en ? 'Installed' : 'Installiert') : fitting ? status : item.id === 'engineering' ? (en ? 'Construction' : 'Bau') : item.id === 'cannon' ? (en ? 'Weapon' : 'Waffe') : (en ? 'Protection' : 'Schutz')}</small></span>
        </button>;
      })}
    </div>
    {busy ? <div class="live-upgrade-running">
      <div class="live-upgrade-progress-label"><span>{slotName(working.slot)} · {name(working)}</span><span>{percentage}</span></div>
      <Bar kind="build" value={upgrade.progress} testId="commander-upgrade-progress" label={`${name(working)}: ${percentage}`}/>
      <div class="live-upgrade-running-actions"><button type="button" data-testid="commander-upgrade-pause" disabled={!upgrade.active || !upgrade.controllable} onClick={() => controller.pauseCommanderUpgrade()}>{upgrade.paused ? (en ? 'Resume' : 'Fortsetzen') : 'Pause'}</button><button type="button" data-testid="commander-upgrade-cancel" disabled={!upgrade.controllable} title={upgrade.paused ? (en ? 'Cancels the upgrade and resumes the unit' : 'Bricht den Ausbau ab und setzt die Einheit fort') : undefined} onClick={() => controller.cancelCommanderUpgrade()}>{upgrade.paused ? (en ? 'Cancel & resume' : 'Abbrechen + fortsetzen') : (en ? 'Cancel' : 'Abbrechen')}</button></div>
      {upgrade.paused && <div class="live-upgrade-paused-note" data-testid="commander-upgrade-paused-note">{en ? `Paused: the ${commander}'s own income and build power are idle.` : `Pausiert: Eigenproduktion und Baukraft des ${commander}s ruhen.`}</div>}
    </div> : selected.installed ? <div class="live-enhancement-installed" data-testid="commander-enhancement-installed"><b>{name(selected)}</b><span>{en ? 'Installed' : 'Installiert'} ✓</span><small>{en ? 'Build power' : 'Baukraft'} {number(upgrade.buildPower)} · HP {number(upgrade.hpMax)} · {en ? 'Range' : 'Reichweite'} {number(upgrade.weaponRange)} · DPS {number(upgrade.weaponDps)}</small></div>
      : <button class="live-upgrade-start" type="button" data-testid="commander-upgrade-start" data-enhancement={selected.id} disabled={!selected.enabled || !upgrade.controllable} aria-label={`${en ? 'Install' : 'Einbauen'}: ${name(selected)}. ${number(selected.mass)} M, ${number(selected.energy)} E. ${improvements(selected)}`} title={improvements(selected)} onClick={() => controller.startCommanderUpgrade(selected.id)}>
        <span class="live-upgrade-target"><b>{name(selected)}</b><small>{improvements(selected)}</small></span>
        <span class="live-upgrade-cost"><span class="live-upgrade-mass">{number(selected.mass)} M</span><span>{number(selected.energy)} E</span></span><span class="live-enhancement-install-mark" aria-hidden="true">＋</span>
      </button>}
  </Panel>;
}
