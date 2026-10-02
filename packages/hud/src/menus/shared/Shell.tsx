import type { ComponentChildren } from 'preact';
import { useCommands, useHud } from '../../model/index.ts';
import { Button, Select } from '../../ui/index.ts';
import { t } from '../../i18n/t.ts';
import '../../styles/menus.css';
import './menus.css';
export function MenuShell({ title, component, children, footer, headerAside, back = true, language = true }: {
    readonly title: string;
    readonly component: string;
    readonly children: ComponentChildren;
    readonly footer?: ComponentChildren;
    readonly headerAside?: ComponentChildren;
    /** False on screens without a parent (main menu) or with their own exits (score). */
    readonly back?: boolean;
    /** False where the screen itself offers the language setting. */
    readonly language?: boolean;
}) {
    const m = useHud(), c = useCommands();
    return <div class="menu-root" data-component={component} data-testid={component}><header class="menu-top"><h1>{title}</h1><div class="sp">{headerAside}{language && <Select label={t('ui.menu.language')} value={m.locale.value === 'en' ? 'en' : 'de'} options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} onChange={(v) => c.setLocale(v)}/>}</div></header>{children}<footer class="menu-foot">{back && <Button onClick={() => c.backToMenu()}>{t('ui.common.back')}</Button>}<div class="sp">{footer}</div></footer></div>;
}
