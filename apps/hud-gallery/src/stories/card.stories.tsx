/**
 * Command card, order bar, order tooltip and strip stories (hud-p4-card): every state from ui.md §6
 * (see required-states.ts) plus the German vs. English key layout and three docked 1080p views to compare
 * with docs/design/ui-mockups/hud.html?sel=vogt|factory|army. Interactive stories wrap the recording
 * commands in createCardDemoCommands, so clicks and keys change the model like the game would.
 */
import {
  CardCell,
  CommandCard,
  ControlGroups,
  HudProvider,
  IdleButton,
  NO_CELL_INPUTS,
  OrderBar,
  OrderButton,
  OrderTooltip,
  SLOT_CODES,
  SelectionFilter,
  Strip,
  applyCardDemo,
  applyStripDemo,
  cellViews,
  createCardDemoCommands,
  keyLabel,
  resolveCardPage,
  useCardHotkeys,
  useHud,
  demoUnitCatalog,
} from '@faf/hud';
import type { CardDemoId, CellInputs, CellView, DemoState, HudModel, OrderId, OrderState, SlotCode } from '@faf/hud';
import { signal } from '@preact/signals';
import type { ComponentChildren, JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { defineStories } from '../story.ts';
import type { Story, StoryContext } from '../story.ts';

const CAT = demoUnitCatalog();

// ---------- gallery layout helpers (chrome, not product UI) ----------

const sheet: JSX.CSSProperties = { display: 'grid', gap: '1.25rem', padding: '1.5rem', alignContent: 'start', justifyItems: 'start' };
const rowStyle: JSX.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '1rem 1.5rem', alignItems: 'flex-end' };
const demoStyle: JSX.CSSProperties = { display: 'grid', gap: '0.375rem', justifyItems: 'start' };
const caption: JSX.CSSProperties = { color: 'var(--text-lo)', fontSize: 'var(--fs-micro)', letterSpacing: '0.06em', textTransform: 'uppercase' };
/** One-row cell grid so cells get the card sizes (icon box, line icon position). */
const cellRow: JSX.CSSProperties = { gridTemplateRows: 'var(--cell)', gridTemplateColumns: 'repeat(auto-fill, var(--cell))', padding: 0 };

function Sheet({ children }: { readonly children: ComponentChildren }): JSX.Element {
  return <div style={sheet}>{children}</div>;
}

function Row({ children }: { readonly children: ComponentChildren }): JSX.Element {
  return <div style={rowStyle}>{children}</div>;
}

function Demo({ label, children }: { readonly label: string; readonly children: ComponentChildren }): JSX.Element {
  return (
    <div style={demoStyle}>
      <small style={caption}>{label}</small>
      {children}
    </div>
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function story(component: string, state: string, render: Story['render'], extra: Partial<Story> = {}): Story {
  const comp = component.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return { id: `${comp}--${slug(state)}`, component, state, title: `${component} · ${state}`, layout: 'component', ...extra, render };
}

/** Demo commands on top of the recording commands + grid/strip hotkeys (gallery only). */
function Interactive({ ctx, children }: { readonly ctx: StoryContext; readonly children: ComponentChildren }): JSX.Element {
  const commands = useMemo(() => createCardDemoCommands(ctx.model, ctx.commands), [ctx]);
  return (
    <HudProvider model={ctx.model} commands={commands}>
      <Hotkeys />
      {children}
    </HudProvider>
  );
}

function Hotkeys(): null {
  useCardHotkeys();
  return null;
}

function demoSetup(id: CardDemoId, extra?: (m: HudModel) => void): (ctx: StoryContext) => void {
  return ({ model }) => {
    applyCardDemo(model, id);
    applyStripDemo(model);
    extra?.(model);
  };
}

// ---------- CommandCard ----------

function cardStory(state: string, id: CardDemoId, extra?: (m: HudModel) => void, opts: Partial<Story> = {}): Story {
  return story(
    'CommandCard',
    state,
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <CommandCard mac={false} />
        </Sheet>
      </Interactive>
    ),
    { setup: demoSetup(id, extra), ...opts },
  );
}

const CARD_STORIES: readonly Story[] = [
  cardStory('Bau', 'vogt'),
  cardStory('Produktion', 'landFactory', undefined, { tags: ['xbrowser'] }),
  cardStory('Gebäude', 'mex'),
  cardStory('Befehle', 'army', undefined, { tags: ['xbrowser'] }),
  cardStory('leer', 'empty'),
  cardStory('Tab T1', 'vogt'),
  cardStory('Tab T2', 'engineerT2'),
  cardStory('Tab T3', 'engineerT3'),
  // Additional variants (allowed by the coverage test).
  cardStory('T3 auf Tab T1', 'engineerT3', (m) => {
    m.card.tab.value = 1;
  }),
  cardStory('gemischte Bauer', 'mixedBuilders'),
  cardStory('Luftwerk', 'airFactory'),
  cardStory('Gebäude Fähigkeit', 'radar'),
  cardStory('Unit-Cap erreicht', 'capReached'),
  cardStory('Platzieren', 'placement'),
  cardStory('Selbstzerstörung', 'selfDestruct'),
  story(
    'CommandCard',
    'Tastatur DE vs EN',
    (ctx) => <KeyboardCompare ctx={ctx} />,
    { setup: demoSetup('vogt'), viewport: { width: 960, height: 640 } },
  ),
];

/** Two cards side by side: German layout (Y X C V B) and English layout (Z X C V B). */
function KeyboardCompare({ ctx }: { readonly ctx: StoryContext }): JSX.Element {
  const en = useMemo(() => {
    const m: HudModel = { ...ctx.model, keyboardLayout: signal('en') };
    return m;
  }, [ctx]);
  return (
    <Sheet>
      <Row>
        <Demo label="layout de">
          <CommandCard mac={false} testId="command-card-de" />
        </Demo>
        <HudProvider model={en} commands={ctx.commands}>
          <Demo label="layout en">
            <CommandCard mac={false} testId="command-card-en" />
          </Demo>
        </HudProvider>
      </Row>
    </Sheet>
  );
}

// ---------- CardCell ----------

function viewsOf(selected: readonly string[], inputs: Partial<CellInputs> = {}, tab: number | null = null): readonly CellView[] {
  return cellViews(resolveCardPage(CAT, selected, tab), { ...NO_CELL_INPUTS, units: CAT, ...inputs });
}

function viewAt(views: readonly CellView[], slot: SlotCode): CellView {
  const v = views[SLOT_CODES.indexOf(slot)];
  if (v === undefined) throw new Error(`no cell ${slot}`);
  return v;
}

interface CellDemo {
  readonly label: string;
  readonly view: CellView;
  readonly demo?: DemoState;
  readonly progress?: Readonly<Record<string, number>>;
  readonly countdown?: string;
}

function CellSheet({ cells }: { readonly cells: readonly CellDemo[] }): JSX.Element {
  const model = useHud();
  const layout = model.keyboardLayout.value;
  return (
    <Sheet>
      <Row>
        {cells.map((c, i) => (
          <Demo key={i} label={c.label}>
            <div class="card__grid" style={cellRow} role="grid">
              <div class="card__row" role="row">
                <CardCell
                  view={c.view}
                  layout={layout}
                  demoState={c.demo}
                  progress={c.progress !== undefined ? signal(c.progress) : undefined}
                  countdownText={c.countdown !== undefined ? signal(c.countdown) : undefined}
                  selfDestructKeys={`${keyLabel('ControlLeft', layout)}+${keyLabel('Delete', layout)}`}
                  testId={`cell-demo-${i}`}
                />
              </div>
            </div>
          </Demo>
        ))}
      </Row>
    </Sheet>
  );
}

const VOGT = ['core:cmd_commander'];
const LAND = ['core:str_t1_fac_land'];
const ARMY = ['core:lnd_t1_tank', 'core:lnd_t1_arty'];

function cellStory(state: string, cells: () => readonly CellDemo[]): Story {
  return story('CardCell', state, () => <CellSheet cells={cells()} />);
}

const CELL_STORIES: readonly Story[] = [
  cellStory('Standard', () => [
    { label: 'unit', view: viewAt(viewsOf(VOGT), 'KeyW') },
    { label: 'order', view: viewAt(viewsOf(ARMY), 'KeyQ') },
    { label: 'upgrade', view: viewAt(viewsOf(LAND), 'KeyB') },
  ]),
  cellStory('Hover', () => [{ label: 'hover', view: viewAt(viewsOf(VOGT), 'KeyW'), demo: 'hover' }]),
  cellStory('Gedrückt', () => [{ label: 'pressed', view: viewAt(viewsOf(VOGT), 'KeyW'), demo: 'pressed' }]),
  cellStory('Aktiv (Platzieren)', () => [
    { label: 'placing', view: viewAt(viewsOf(VOGT, { armedSlot: 'KeyW' }), 'KeyW') },
    { label: 'armed order', view: viewAt(viewsOf(ARMY, { orderStates: { attack: { enabled: true, armed: true } } }), 'KeyA') },
  ]),
  cellStory('Fokus', () => [{ label: 'focus', view: viewAt(viewsOf(VOGT), 'KeyQ'), demo: 'focus' }]),
  cellStory('Queue-Badge', () => [
    { label: '5', view: viewAt(viewsOf(LAND, { queueCounts: { 'core:lnd_t1_tank': 5 } }), 'KeyQ') },
    { label: '120', view: viewAt(viewsOf(LAND, { queueCounts: { 'core:lnd_t1_arty': 120 } }), 'KeyW') },
  ]),
  cellStory('Fortschritt', () => [
    {
      label: '64 %',
      view: viewAt(viewsOf(LAND, { queueCounts: { 'core:lnd_t1_tank': 5 } }), 'KeyQ'),
      progress: { 'core:lnd_t1_tank': 0.64 },
    },
    {
      label: '15 %',
      view: viewAt(viewsOf(LAND, { queueCounts: { 'core:lnd_t1_engineer': 1 } }), 'KeyE'),
      progress: { 'core:lnd_t1_engineer': 0.15 },
    },
  ]),
  cellStory('Tech-Striche', () => [
    { label: 'T1 of I–III', view: viewAt(viewsOf(VOGT), 'KeyQ') },
    { label: 'T2 of I–III', view: viewAt(viewsOf(['core:lnd_t3_engineer'], {}, 2), 'KeyQ') },
    { label: 'T3 of I–III', view: viewAt(viewsOf(['core:lnd_t3_engineer']), 'KeyX') },
    { label: 'I–II', view: viewAt(viewsOf(['core:lnd_t2_engineer']), 'KeyZ') },
    { label: 'II–III', view: viewAt(viewsOf(['core:lnd_t3_engineer']), 'KeyV') },
  ]),
  cellStory('Gesperrt', () => [
    { label: 'needs T2 engineer', view: viewAt(viewsOf(VOGT), 'KeyF') },
    { label: 'needs Landwerk II', view: viewAt(viewsOf(LAND), 'KeyD') },
  ]),
  cellStory('Deaktiviert', () => [
    { label: 'unit cap', view: viewAt(viewsOf(LAND, { capReached: true }), 'KeyQ') },
    { label: 'order reason', view: viewAt(viewsOf(ARMY, { orderStates: { reclaim: { enabled: false, reason: 'noEngineer' } } }), 'KeyR') },
  ]),
  cellStory('Leer', () => [{ label: 'empty', view: viewAt(viewsOf(VOGT), 'KeyG') }]),
  cellStory('Gefahr', () => [
    { label: 'self-destruct', view: viewAt(viewsOf(ARMY), 'KeyB') },
    { label: 'hover', view: viewAt(viewsOf(ARMY), 'KeyB'), demo: 'hover' },
    { label: 'countdown', view: viewAt(viewsOf(ARMY, { countdown: 3 }), 'KeyB'), countdown: '3' },
  ]),
];

// ---------- OrderBar ----------

const ORDER_BAR_STORIES: readonly Story[] = [
  story(
    'OrderBar',
    'sichtbar',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <Demo label="Vogt (build page)">
            <OrderBar mac={false} />
          </Demo>
        </Sheet>
      </Interactive>
    ),
    { setup: demoSetup('vogt') },
  ),
  story(
    'OrderBar',
    'ausgeblendet',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <Demo label="army: bar hidden, orders in the grid">
            <OrderBar mac={false} />
          </Demo>
          <CommandCard mac={false} />
        </Sheet>
      </Interactive>
    ),
    { setup: demoSetup('army') },
  ),
  story(
    'OrderBar',
    'Fabrik',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <OrderBar mac={false} />
        </Sheet>
      </Interactive>
    ),
    { setup: demoSetup('landFactory') },
  ),
];

// ---------- OrderButton ----------

interface ButtonDemo {
  readonly label: string;
  readonly id: OrderId;
  readonly state: OrderState;
  readonly demo?: DemoState;
  readonly countdown?: string;
}

function ButtonSheet({ items }: { readonly items: readonly ButtonDemo[] }): JSX.Element {
  const layout = useHud().keyboardLayout.value;
  return (
    <Sheet>
      <Row>
        {items.map((b, i) => {
          const key = b.id === 'selfDestruct' ? '' : keyLabel(ORDER_KEYS[b.id], layout);
          return (
            <Demo key={i} label={b.label}>
              <div class="orders">
                <OrderButton
                  id={b.id}
                  state={b.state}
                  keyText={key}
                  keysLabel={key}
                  demoState={b.demo}
                  countdown={b.countdown !== undefined}
                  countdownText={b.countdown !== undefined ? signal(b.countdown) : undefined}
                  testId={`order-demo-${i}`}
                />
              </div>
            </Demo>
          );
        })}
      </Row>
    </Sheet>
  );
}

const ORDER_KEYS: Readonly<Record<OrderId, SlotCode>> = {
  move: 'KeyQ',
  patrol: 'KeyW',
  assist: 'KeyE',
  reclaim: 'KeyR',
  repair: 'KeyT',
  attack: 'KeyA',
  stop: 'KeyS',
  pause: 'KeyD',
  fireState: 'KeyF',
  ability: 'KeyG',
  attackGround: 'KeyZ',
  tapshot: 'KeyX',
  formation: 'KeyC',
  selfDestruct: 'KeyB',
};

function buttonStory(state: string, items: readonly ButtonDemo[]): Story {
  return story('OrderButton', state, () => <ButtonSheet items={items} />);
}

const ON: OrderState = { enabled: true };

const ORDER_BUTTON_STORIES: readonly Story[] = [
  buttonStory('Standard', [
    { label: 'move', id: 'move', state: ON },
    { label: 'stop', id: 'stop', state: ON },
    { label: 'badge', id: 'attackGround', state: { enabled: true, badge: 3 } },
  ]),
  buttonStory('Hover', [{ label: 'hover', id: 'reclaim', state: ON, demo: 'hover' }]),
  buttonStory('Scharf', [{ label: 'armed', id: 'attack', state: { enabled: true, armed: true } }]),
  buttonStory('An', [
    { label: 'auto tap shot', id: 'ability', state: { enabled: true, toggle: 'on', ability: 'autoTapshot' } },
    { label: 'pause', id: 'pause', state: { enabled: true, toggle: 'on' } },
  ]),
  buttonStory('Gemischt', [{ label: 'shield mixed', id: 'ability', state: { enabled: true, toggle: 'mixed', ability: 'shield' } }]),
  buttonStory('Zyklus', [
    { label: 'fire at will', id: 'fireState', state: { enabled: true, cycle: 0 } },
    { label: 'return fire', id: 'fireState', state: { enabled: true, cycle: 1 } },
    { label: 'hold fire', id: 'fireState', state: { enabled: true, cycle: 2 } },
  ]),
  buttonStory('Deaktiviert', [
    { label: 'no engineer', id: 'repair', state: { enabled: false, reason: 'noEngineer' } },
    { label: 'tap shot < 7500 E', id: 'tapshot', state: { enabled: false, reason: 'tapshotCharge' } },
  ]),
  buttonStory('Fokus', [{ label: 'focus', id: 'patrol', state: ON, demo: 'focus' }]),
  buttonStory('Gefahr', [
    { label: 'self-destruct', id: 'selfDestruct', state: ON },
    { label: 'hover', id: 'selfDestruct', state: ON, demo: 'hover' },
  ]),
  buttonStory('Countdown', [{ label: '4 s', id: 'selfDestruct', state: ON, countdown: '4' }]),
];

// ---------- OrderTooltip ----------

const TOOLTIP_STORIES: readonly Story[] = [
  story(
    'OrderTooltip',
    'Befehl',
    () => (
      <Sheet>
        <Row>
          <OrderTooltip orderId="reclaim" mac={false} />
          <OrderTooltip orderId="fireState" mac={false} />
        </Row>
      </Sheet>
    ),
    { setup: demoSetup('vogt') },
  ),
  story(
    'OrderTooltip',
    'deaktiviert mit Grund',
    () => (
      <Sheet>
        <Row>
          <OrderTooltip orderId="repair" mac={false} />
          <OrderTooltip orderId="selfDestruct" mac />
        </Row>
      </Sheet>
    ),
    { setup: demoSetup('army') },
  ),
];

// ---------- SelectionFilter, IdleButton, ControlGroups ----------

const STRIP_STORIES: readonly Story[] = [
  story(
    'SelectionFilter',
    'Standard',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <div style={{ width: 'var(--hud-minimap)', display: 'grid' }}>
            <SelectionFilter />
          </div>
        </Sheet>
      </Interactive>
    ),
    { setup: ({ model }) => applyStripDemo(model, { idle: 2 }) },
  ),
  story(
    'SelectionFilter',
    'Hover',
    () => (
      <Sheet>
        <div style={{ width: 'var(--hud-minimap)', display: 'grid' }}>
          <SelectionFilter demo={{ kind: 'air', state: 'hover' }} />
        </div>
      </Sheet>
    ),
    { setup: ({ model }) => applyStripDemo(model, { idle: 2 }) },
  ),
  story('IdleButton', 'Standard', () => (
    <Sheet>
      <IdleButton />
    </Sheet>
  ), { setup: ({ model }) => applyStripDemo(model, { idle: 2 }) }),
  story('IdleButton', 'Hover', () => (
    <Sheet>
      <IdleButton demoState="hover" />
    </Sheet>
  ), { setup: ({ model }) => applyStripDemo(model, { idle: 2 }) }),
  story('IdleButton', 'Idle-Zähler 0', () => (
    <Sheet>
      <IdleButton />
    </Sheet>
  ), { setup: ({ model }) => applyStripDemo(model, { idle: 0, idleFactories: 0 }) }),
  story('IdleButton', 'Idle-Zähler N', () => (
    <Sheet>
      <Row>
        <IdleButton />
      </Row>
    </Sheet>
  ), { setup: ({ model }) => applyStripDemo(model, { idle: 3 }) }),
  story(
    'ControlGroups',
    'leer',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <ControlGroups />
        </Sheet>
      </Interactive>
    ),
  ),
  story(
    'ControlGroups',
    'belegt',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <ControlGroups />
        </Sheet>
      </Interactive>
    ),
    { setup: ({ model }) => applyStripDemo(model, { active: null }) },
  ),
  story(
    'ControlGroups',
    'aktiv',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <ControlGroups />
        </Sheet>
      </Interactive>
    ),
    { setup: ({ model }) => applyStripDemo(model, { active: 1 }) },
  ),
  story(
    'ControlGroups',
    'Rechtsklick speichert',
    (ctx) => (
      <Interactive ctx={ctx}>
        <Sheet>
          <Demo label="right click = save · shift + right click = add (group 5 hovered)">
            <ControlGroups demo={{ index: 4, state: 'hover' }} />
          </Demo>
        </Sheet>
      </Interactive>
    ),
    {
      setup: (ctx) => {
        applyCardDemo(ctx.model, 'army');
        applyStripDemo(ctx.model, { active: 4 });
        // The game's answer to a right click on group 5: the 19 selected units are stored there.
        createCardDemoCommands(ctx.model, ctx.commands).saveGroup(4, false);
      },
    },
  ),
];

// ---------- docked 1080p views (compare with hud.html?sel=vogt|factory|army) ----------

const dockStyle: JSX.CSSProperties = {
  position: 'absolute',
  left: 'var(--hud-gutter)',
  right: 'var(--hud-gutter)',
  bottom: 'var(--hud-gutter)',
  height: 'var(--hud-dock-h)',
  display: 'grid',
  gridTemplateColumns: 'var(--hud-minimap) minmax(0, 1fr) var(--hud-card-w)',
  gap: 'var(--sp-1)',
};
const placeholder: JSX.CSSProperties = { background: 'var(--surface-0)', border: '1px dashed var(--line)' };

function DockView({ ctx }: { readonly ctx: StoryContext }): JSX.Element {
  return (
    <Interactive ctx={ctx}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <Strip mac={false} />
        <div style={dockStyle}>
          <div style={placeholder} />
          <div style={placeholder} />
          <CommandCard mac={false} />
        </div>
      </div>
    </Interactive>
  );
}

function dockStory(state: string, id: CardDemoId, active: number | null): Story {
  return story('CommandCard', state, (ctx) => <DockView ctx={ctx} />, {
    layout: 'fullscreen',
    setup: (ctx) => {
      applyCardDemo(ctx.model, id);
      applyStripDemo(ctx.model, { active, idle: 2 });
    },
  });
}

const DOCK_STORIES: readonly Story[] = [
  dockStory('Dock Vogt', 'vogt', null),
  dockStory('Dock Fabrik', 'landFactory', 2),
  dockStory('Dock Armee', 'army', 0),
];

export default defineStories([
  ...CARD_STORIES,
  ...CELL_STORIES,
  ...ORDER_BAR_STORIES,
  ...ORDER_BUTTON_STORIES,
  ...TOOLTIP_STORIES,
  ...STRIP_STORIES,
  ...DOCK_STORIES,
]);
