import type { JSX } from 'preact';
import { t } from '../../i18n/t.ts';
import { useHud } from '../../model/index.ts';
import { Key } from '../../ui/Key.tsx';
import { SEP } from './labels.ts';

/** Empty selection (ui.md §5.5 "Leer"): short help – click/box, H = commander, "." = idle engineer, Ctrl+A = all. */
export function SelectionEmpty(): JSX.Element {
  const layout = useHud().keyboardLayout.value;
  return (
    <div class="sel__body sel__body--empty" data-kind="none" data-testid="selection-empty">
      <div class="sel__help">
        <span class="sel__help-title">{t('ui.selection.help.title')}</span>
        <span class="ff-lo">
          {t('ui.selection.help.click')}
          {SEP}
          <Key code="KeyH" layout={layout} /> {t('ui.selection.help.commander')}
          {SEP}
          <Key code="Period" layout={layout} /> {t('ui.selection.help.idle')}
          {SEP}
          <Key code="ControlLeft" layout={layout} />+<Key code="KeyA" layout={layout} /> {t('ui.selection.help.all')}
        </span>
      </div>
    </div>
  );
}
