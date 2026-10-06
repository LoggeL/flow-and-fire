import type { JSX } from 'preact';
import { OrderBar } from '../card/OrderBar.tsx';
import { ControlGroups } from './ControlGroups.tsx';
import { SelectionFilter } from './SelectionFilter.tsx';

export interface StripProps {
  readonly mac?: boolean | undefined;
  readonly testId?: string | undefined;
}

/**
 * Strip between world and dock (ui.md §4.2): filters + idle over the minimap, control groups fixed over the
 * selection panel (R1), order bar right-aligned over the command card. Click-through except its buttons.
 */
export function Strip(props: StripProps): JSX.Element {
  return (
    <div class="strip" data-component="Strip" data-testid={props.testId ?? 'strip'}>
      <SelectionFilter />
      <ControlGroups />
      <OrderBar mac={props.mac} />
    </div>
  );
}
