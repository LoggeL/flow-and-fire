import type { ComponentChildren } from 'preact';
import { useCommands, useHud } from '../../model/index.ts';
import { Button, Select } from '../../ui/index.ts';
import { t } from '../../i18n/t.ts';
import '../../styles/menus.css';
import './menus.css';
export function MenuShell({ title, component, children, footer }: {
    readonly title: string;
    readonly component: string;
    readonly children: ComponentChildren;
    readonly footer?: ComponentChildren;
}) {
    const m = useHud(), c = useCommands();
    return <div class="menu-root" data-component={component} data-testid={component}><header class="menu-top"><h1>{title}</h1><div class="sp"><Select label={t('ui.menu.language')} value={m.locale.value === 'en' ? 'en' : 'de'} options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} onChange={(v) => c.setLocale(v)}/></div></header>{children}<footer class="menu-foot"><Button onClick={() => c.backToMenu()}>{t('ui.common.back')}</Button><div class="sp">{footer}</div></footer></div>;
}
