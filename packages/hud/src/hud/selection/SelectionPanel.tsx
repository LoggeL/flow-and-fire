import { useComputed } from '@preact/signals';
import type { JSX } from 'preact';
import { locale } from '../../i18n/locale.ts';
import { t, tn } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import type { HudModel } from '../../model/index.ts';
import { Panel, PanelHead } from '../../ui/Panel.tsx';
import { FactoryDetail } from './FactoryDetail.tsx';
import { headGroup, headTypes, headUnits } from './labels.ts';
import { unitName } from '../../data/roster.ts';
import { SelectionEmpty } from './SelectionEmpty.tsx';
import { SelectionMulti } from './SelectionMulti.tsx';
import { UnitDetail } from './UnitDetail.tsx';

/** Head title of the panel: "Auswahl · 19 Einheiten · 5 Typen", "Auswahl · 1 Einheit", "Auswahl · Landwerk I". */
export function selectionHeadTitle(m: HudModel): string {
  const s = m.selection;
  const loc = locale.value;
  switch (s.kind.value) {
    case 'single':
      return s.single.value === null ? t('ui.selection.title') : t('ui.selection.head', { what: headUnits(1, loc) });
    case 'multi': {
      const multi = s.multi.value;
      if (multi === null) return t('ui.selection.title');
      return t('ui.selection.headMulti', { units: headUnits(multi.total, loc), types: headTypes(multi.groups.length, loc) });
    }
    case 'factory': {
      const d = m.factory.detail.value;
      if (d === null) return t('ui.selection.title');
      const what = d.factoryCount > 1 ? tn('ui.factory.count', d.factoryCount) : unitName(m.units.value, d.typeId, loc);
      return t('ui.selection.head', { what });
    }
    default:
      return t('ui.selection.title');
  }
}

/** Right side of the head: "Gruppe 3", the house label, or "leer". */
export function selectionHeadEnd(m: HudModel): string {
  const s = m.selection;
  if (s.kind.value === 'none') return t('ui.selection.headEmpty');
  return headGroup(s.controlGroup.value, s.groupLabel.value, locale.value);
}

function SelectionHead(): JSX.Element {
  const model = useHud();
  // Computed strings: the head text node updates without re-rendering (the factory detail changes at 4 Hz).
  const title = useComputed(() => selectionHeadTitle(model));
  const end = useComputed(() => selectionHeadEnd(model));
  return <PanelHead title={title} end={end} testId="selection-head" />;
}

export interface SelectionPanelProps {
  readonly class?: string | undefined;
}

/**
 * Selection panel (ui.md §5.5 `SelectionPanel`, middle column of the dock): head "Auswahl · N Einheiten ·
 * M Typen" with group/house, body by selection kind – empty help, UnitDetail, multi selection
 * (SelectionGroups + SelectionUnits + totals) or FactoryDetail + FactoryQueue. Re-renders on kind changes.
 */
export function SelectionPanel(props: SelectionPanelProps): JSX.Element {
  const { selection } = useHud();
  const hasMulti = useComputed(() => selection.multi.value !== null);
  const kind = selection.kind.value;
  let body: JSX.Element;
  if (kind === 'single') body = <UnitDetail />;
  else if (kind === 'multi') body = hasMulti.value ? <SelectionMulti /> : <SelectionEmpty />;
  else if (kind === 'factory') body = <FactoryDetail />;
  else body = <SelectionEmpty />;
  return (
    <Panel
      as="section"
      class={props.class ? `sel ${props.class}` : 'sel'}
      component="SelectionPanel"
      panelId="selection"
      label={t('ui.selection.region')}
      testId="selection-panel"
    >
      <SelectionHead />
      {body}
    </Panel>
  );
}
