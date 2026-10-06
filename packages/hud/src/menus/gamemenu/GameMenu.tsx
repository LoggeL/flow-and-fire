/**
 * In-game menu (Esc, ui.md §5.15, G12): modal in the middle (z 50) with Fortsetzen · Einstellungen ·
 * Tastenübersicht · Aufgeben (with confirmation) · Ins Hauptmenü. aria-modal dialog with a focus trap;
 * Esc closes (in the confirmation: back to the menu). Focus returns to where it was when the menu closes.
 * In single player the sim pauses while it is open (the game does that; the menu says so).
 */
import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { t } from '../../i18n/t.ts';
import { useCommands, useHud } from '../../model/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Key } from '../../ui/Key.tsx';
import { LineIcon } from '../../ui/LineIcon.tsx';
import { PanelHead } from '../../ui/Panel.tsx';
import { focusables, trapTab } from '../shared/focus.ts';

const TITLE_ID = 'ffm-gamemenu-title';
const CONFIRM_ID = 'ffm-gamemenu-confirm';

function GameMenuDialog({ confirm }: { readonly confirm: boolean }): JSX.Element {
  const model = useHud();
  const cmd = useCommands();
  const root = useRef<HTMLDivElement>(null);
  const single = model.menus.gameMenu.singlePlayer.value;

  // Remember the focus of the page and give it back when the dialog goes away.
  useLayoutEffect(() => {
    const before = document.activeElement;
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // Focus lands on the primary action: "Fortsetzen", in the confirmation the safe "Weiterspielen".
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('[data-primary]') ?? (root.current ? focusables(root.current)[0] : undefined);
    el?.focus({ preventScroll: true });
  }, [confirm]);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (confirm) cmd.askSurrender(false);
      else cmd.resume();
      return;
    }
    if (root.current) trapTab(root.current, e);
  };

  return (
    <div class="gm-layer" data-testid="game-menu-layer" onKeyDown={onKeyDown}>
      <section
        ref={root}
        class="ff-panel ff-panel--copper gm"
        role={confirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={confirm ? CONFIRM_ID : TITLE_ID}
        data-component="GameMenu"
        data-testid="game-menu"
        data-state={confirm ? 'confirm' : 'open'}
        data-panel="game-menu"
      >
        <PanelHead title={<span id={TITLE_ID}>{t('ui.gamemenu.title')}</span>} />
        {confirm ? (
          <div class="gm__body">
            <div class="gm__confirm">
              <h3 id={CONFIRM_ID}>
                <LineIcon name="crit" />
                {t('ui.gamemenu.confirm.title')}
              </h3>
              <p>{t('ui.gamemenu.confirm.text')}</p>
              <div class="gm__actions">
                <Button variant="danger" onClick={() => cmd.surrender()} testId="gm-surrender-yes">
                  {t('ui.gamemenu.confirm.yes')}
                </Button>
                <button type="button" class="ff-btn ff-btn--primary" data-primary="" onClick={() => cmd.askSurrender(false)} data-testid="gm-surrender-no">
                  {t('ui.gamemenu.confirm.no')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div class="gm__body">
            <p class="gm__note" data-testid="gm-note">
              <LineIcon name={single ? 'pause' : 'play'} />
              {t(single ? 'ui.gamemenu.paused' : 'ui.gamemenu.running')}
            </p>
            <button
              type="button"
              class="ff-btn ff-btn--primary"
              data-primary=""
              onClick={() => cmd.resume()}
              data-testid="gm-resume"
            >
              <LineIcon name="play" />
              {t('ui.gamemenu.resume')}
            </button>
            <Button icon="sliders" onClick={() => cmd.openSettings('graphics')} testId="gm-settings">
              {t('ui.gamemenu.settings')}
            </Button>
            <Button icon="keyboard" onClick={() => cmd.openSettings('keys')} testId="gm-keys">
              {t('ui.gamemenu.keys')}
            </Button>
            <div class="gm__sep" role="separator" />
            <Button variant="danger" icon="flag" onClick={() => cmd.askSurrender(true)} testId="gm-surrender">
              {t('ui.gamemenu.surrender')}
            </Button>
            <Button variant="ghost" icon="exit" onClick={() => cmd.quitToMenu()} testId="gm-quit">
              {t('ui.gamemenu.quit')}
            </Button>
          </div>
        )}
        <div class="gm__foot" aria-hidden="true">
          <Key code="Escape" layout={model.keyboardLayout.value} />
          {t('ui.gamemenu.escHint')}
        </div>
      </section>
    </div>
  );
}

/** Renders nothing while `menus.gameMenu.open` is false. */
export function GameMenu(): JSX.Element | null {
  const gm = useHud().menus.gameMenu;
  if (!gm.open.value) return null;
  return <GameMenuDialog confirm={gm.confirmSurrender.value} />;
}
