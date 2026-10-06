/**
 * Unit tooltip content (ui.md §5.12) on TooltipFrame: head (icon, name, role, target layers, key), cost with
 * the flow demand at the builder's BP (yellow when it exceeds the current net), 3 × 2 value grid (unit vs.
 * structure), lock / disabled reason, description, verdigris adjacency box, foot with controls (build vs.
 * factory vs. info). Positioning and delay belong to the TooltipLayer; this component only renders content.
 */
import { computed } from '@preact/signals';
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { StrategicIcon } from '../../data/StrategicIcon.tsx';
import { flowDemand, unitText } from '../../data/roster.ts';
import { fmtDec, fmtInt } from '../../format/index.ts';
import { locale } from '../../i18n/locale.ts';
import { t } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import { flowDemandExceedsNet } from '../../model/tooltip.ts';
import type { UnitTooltipTarget } from '../../model/tooltip.ts';
import { Key } from '../../ui/Key.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { TooltipFrame } from '../../ui/TooltipFrame.tsx';
import { keyLabel } from '../../ui/keys.ts';
import { META_SEPARATOR, layersLabel } from './labels.ts';
import { unitTooltipStats } from './tooltipStats.ts';

export type UnitTooltipProps = Omit<UnitTooltipTarget, 'kind'> & {
  readonly testId?: string | undefined;
};

/** Shift key glyph on key caps. */
const SHIFT_GLYPH = '⇧';

function Foot({ mode }: { readonly mode: 'build' | 'factory' | 'info' }): JSX.Element {
  const click = <Key>{t('ui.common.key.click')}</Key>;
  if (mode === 'factory') {
    return (
      <>
        <span>
          {click}
          {'+1'}
        </span>
        <span>
          <Key>{SHIFT_GLYPH}</Key>
          {'+5'}
        </span>
        <span>
          <Key>{t('ui.common.key.rightClick')}</Key>
          {'−1'}
        </span>
      </>
    );
  }
  if (mode === 'build') {
    return (
      <>
        <span>
          {click}
          {t('ui.tooltip.foot.place')}
        </span>
        <span>
          <Key>{SHIFT_GLYPH}</Key>
          {t('ui.tooltip.foot.many')}
        </span>
      </>
    );
  }
  return (
    <>
      <span>
        {click}
        {t('ui.tooltip.foot.select')}
      </span>
      <span>
        <Key>{t('ui.tooltip.key.doubleClick')}</Key>
        {t('ui.tooltip.foot.selectType')}
      </span>
    </>
  );
}

export function UnitTooltip(props: UnitTooltipProps): JSX.Element {
  const { typeId, builderBp, slot, locked, disabledReason } = props;
  const model = useHud();
  const loc = locale.value;
  const hasBuilder = builderBp !== undefined && builderBp > 0;
  const mode = props.mode ?? (hasBuilder ? 'build' : 'info');
  const units = model.units.value;
  // Unknown ids (test/mod blueprints the catalog does not know) render a minimal tooltip: raw id as name,
  // „–“ values, no cost line – never a throw inside the render tree.
  const unit = units.find(typeId);
  const demand = useMemo(
    () => (hasBuilder ? flowDemand(units, typeId, builderBp) : null),
    [units, typeId, builderBp, hasBuilder],
  );
  // Re-renders only when the warning flips, not on every eco tick.
  const warn = useMemo(
    () =>
      computed(() =>
        demand
          ? flowDemandExceedsNet(demand.massPerS, demand.energyPerS, model.eco.mass.net.value, model.eco.energy.net.value)
          : false,
      ),
    [demand, model.eco],
  ).value;

  const name = unitText(units, typeId, 'name', loc);
  const layers = unit !== undefined ? layersLabel(unit.weapons.layers, loc) : '';
  const roleText = unitText(units, typeId, 'role', loc);
  const role = layers ? `${roleText}${META_SEPARATOR}${t('ui.tooltip.target', { layers })}` : roleText;
  const desc = unitText(units, typeId, 'desc', loc);
  const adjacency = unitText(units, typeId, 'adjacency', loc);
  const cost =
    demand !== null && unit !== undefined
      ? {
          mass: fmtInt(unit.economy.mass),
          energy: fmtInt(unit.economy.energy),
          flow: (
            <span title={warn ? t('ui.tooltip.flowWarn') : undefined} data-testid="tooltip-flow">
              {t('ui.tooltip.flow', { mass: fmtDec(demand.massPerS, 1), energy: fmtInt(demand.energyPerS) })}
            </span>
          ),
          flowWarn: warn,
        }
      : undefined;

  const lockLine = locked ? (
    <div class="tip-lock" data-testid="tooltip-locked">
      <LineIcon name="lock" />
      <span>{t(`ui.tooltip.locked.${locked.reason}`, { tier: locked.tier })}</span>
    </div>
  ) : disabledReason ? (
    <div class="tip-lock tip-lock--disabled" data-testid="tooltip-disabled">
      <LineIcon name="stop" />
      <span>{t('ui.tooltip.disabled', { reason: disabledReason })}</span>
    </div>
  ) : null;

  return (
    <div class="tip-unit" data-component="UnitTooltip" data-testid={props.testId ?? 'unit-tooltip'} data-type={unit?.id ?? typeId} data-mode={mode}>
      <TooltipFrame
        icon={<StrategicIcon typeId={typeId} />}
        name={name}
        role={role}
        keyHint={slot ? keyLabel(slot, model.keyboardLayout.value) : undefined}
        cost={cost}
        stats={unitTooltipStats(units, typeId, hasBuilder ? builderBp : undefined, loc)}
        body={
          lockLine || desc ? (
            <>
              {lockLine}
              {desc ? <p class="tip-desc">{desc}</p> : null}
            </>
          ) : undefined
        }
        adjacency={adjacency ? { label: t('ui.tooltip.adjacency'), text: adjacency } : undefined}
        foot={<Foot mode={mode} />}
        testId="unit-tooltip-frame"
      />
    </div>
  );
}
