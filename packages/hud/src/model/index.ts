import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { createContext, createElement } from 'preact';
import type { ComponentChildren, VNode } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import { createNoopCommands } from '../commands/index.ts';
import type { HudCommands } from '../commands/index.ts';
import { locale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';
import type { KeyboardLayout } from '../ui/keys.ts';
import { createAlertsSection } from './alerts.ts';
import type { AlertsSection } from './alerts.ts';
import { createCardSection } from './card.ts';
import type { CardSection } from './card.ts';
import { createEcoSection } from './eco.ts';
import type { EcoSection } from './eco.ts';
import { createFactorySection } from './factory.ts';
import type { FactorySection } from './factory.ts';
import { createGameMenuSection } from './menus/gamemenu.ts';
import type { GameMenuSection } from './menus/gamemenu.ts';
import { createLoadingSection } from './menus/loading.ts';
import type { LoadingSection } from './menus/loading.ts';
import { createMainMenuSection } from './menus/main.ts';
import type { MainMenuSection } from './menus/main.ts';
import { createScoreSection } from './menus/score.ts';
import type { ScoreSection } from './menus/score.ts';
import { createSettingsSection } from './menus/settings.ts';
import type { MotionSetting, SettingsSection } from './menus/settings.ts';
import { createSkirmishSection } from './menus/skirmish.ts';
import type { SkirmishSection, TeamColorMode } from './menus/skirmish.ts';
import { createMinimapSection } from './minimap.ts';
import type { MinimapSection } from './minimap.ts';
import { createOrdersSection } from './orders.ts';
import type { OrdersSection } from './orders.ts';
import { createSelectionSection } from './selection.ts';
import type { SelectionSection } from './selection.ts';
import { createMatchSection } from './status.ts';
import type { MatchSection } from './status.ts';
import { createStripSection } from './strip.ts';
import type { StripSection } from './strip.ts';
import { createTooltipSection } from './tooltip.ts';
import type { TooltipSection } from './tooltip.ts';

export * from './alerts.ts';
export * from './card.ts';
export * from './eco.ts';
export * from './factory.ts';
export * from './menus/index.ts';
export * from './minimap.ts';
export * from './orders.ts';
export * from './selection.ts';
export * from './snapshot.ts';
export * from './status.ts';
export * from './strip.ts';
export * from './tooltip.ts';

export interface MenusModel {
  readonly main: MainMenuSection;
  readonly skirmish: SkirmishSection;
  readonly loading: LoadingSection;
  readonly gameMenu: GameMenuSection;
  readonly settings: SettingsSection;
  readonly score: ScoreSection;
}

/**
 * View model of HUD and menus (ui.md §9.1): one signal tree, written by the scheduler at fixed rates,
 * read by components. The only data channel into @faf/hud besides HudCommands.
 */
export interface HudModel {
  /** Shared UI locale signal (the one `t()` reads). */
  readonly locale: Signal<Locale>;
  readonly teams: Signal<TeamColorMode>;
  /** UI scale (1rem = 16 px × scale). */
  readonly scale: Signal<number>;
  readonly reducedMotion: Signal<MotionSetting>;
  /** Layout for key cap labels (UI-E6). */
  readonly keyboardLayout: Signal<KeyboardLayout>;
  readonly eco: EcoSection;
  readonly match: MatchSection;
  readonly alerts: AlertsSection;
  readonly tooltip: TooltipSection;
  readonly selection: SelectionSection;
  readonly factory: FactorySection;
  readonly card: CardSection;
  readonly orders: OrdersSection;
  readonly strip: StripSection;
  readonly minimap: MinimapSection;
  readonly menus: MenusModel;
}

/** Fresh model with defaults (empty selection, zero economy, German key labels). */
export function createHudModel(): HudModel {
  return {
    locale,
    teams: signal<TeamColorMode>('house'),
    scale: signal(1),
    reducedMotion: signal<MotionSetting>('system'),
    keyboardLayout: signal<KeyboardLayout>('de'),
    eco: createEcoSection(),
    match: createMatchSection(),
    alerts: createAlertsSection(),
    tooltip: createTooltipSection(),
    selection: createSelectionSection(),
    factory: createFactorySection(),
    card: createCardSection(),
    orders: createOrdersSection(),
    strip: createStripSection(),
    minimap: createMinimapSection(),
    menus: {
      main: createMainMenuSection(),
      skirmish: createSkirmishSection(),
      loading: createLoadingSection(),
      gameMenu: createGameMenuSection(),
      settings: createSettingsSection(),
      score: createScoreSection(),
    },
  };
}

interface HudContextValue {
  readonly model: HudModel;
  readonly commands: HudCommands;
}

const HudContext = createContext<HudContextValue | null>(null);

export interface HudProviderProps {
  readonly model: HudModel;
  readonly commands?: HudCommands;
  readonly children?: ComponentChildren;
}

/** Provides model and commands to all HUD/menu components below. */
export function HudProvider({ model, commands, children }: HudProviderProps): VNode {
  const value = useMemo<HudContextValue>(() => ({ model, commands: commands ?? createNoopCommands() }), [model, commands]);
  // The context Provider's VNode type does not narrow to VNode<{}> under exactOptionalPropertyTypes.
  return createElement(HudContext.Provider, { value }, children) as unknown as VNode;
}

function useHudContext(): HudContextValue {
  const ctx = useContext(HudContext);
  if (!ctx) throw new Error('@faf/hud: component rendered outside <HudProvider>');
  return ctx;
}

export function useHud(): HudModel {
  return useHudContext().model;
}

export function useCommands(): HudCommands {
  return useHudContext().commands;
}
