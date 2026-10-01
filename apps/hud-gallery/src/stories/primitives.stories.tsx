/**
 * Primitive stories (hud-p0): every primitive in every state from ui.md §6 (see required-states.ts).
 * Visible texts come from the common i18n namespace so the pseudo-locale pass stretches them too;
 * captions are gallery chrome (small, grey) and name the variant shown.
 */
import {
  Badge,
  Bar,
  Button,
  Check,
  Input,
  Key,
  Range,
  Segmented,
  Select,
  Switch,
  Tab,
  Tabs,
  Vet,
  fmtPct,
  t,
} from '@faf/hud';
import type { ButtonSize, ButtonVariant, DemoState, LineIconName, Tone } from '@faf/hud';
import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import { defineStories } from '../story.ts';
import type { Story } from '../story.ts';

/** State names exactly as in ui.md §6 / required-states.ts. */
type PrimitiveState = 'Standard' | 'Hover' | 'Ausgewählt/An' | 'Fokus' | 'Deaktiviert';

const PRIMITIVE_STATES: readonly PrimitiveState[] = ['Standard', 'Hover', 'Ausgewählt/An', 'Fokus', 'Deaktiviert'];

const STATE_SLUG: Readonly<Record<string, string>> = {
  Standard: 'standard',
  Hover: 'hover',
  Gedrückt: 'gedrueckt',
  'Ausgewählt/An': 'ausgewaehlt',
  Fokus: 'fokus',
  Deaktiviert: 'deaktiviert',
  Wert: 'wert',
  Warnung: 'warnung',
  Kritisch: 'kritisch',
};

function demoOf(state: string): DemoState | undefined {
  if (state === 'Hover') return 'hover';
  if (state === 'Gedrückt') return 'pressed';
  if (state === 'Fokus') return 'focus';
  return undefined;
}

// ---------- gallery layout helpers (chrome, not product UI) ----------

const sheet: JSX.CSSProperties = {
  display: 'grid',
  gap: '1.25rem',
  padding: '1.5rem',
  alignContent: 'start',
  justifyItems: 'start',
};
const row: JSX.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '1rem 1.5rem', alignItems: 'flex-start' };
const cell: JSX.CSSProperties = { display: 'grid', gap: '0.375rem', justifyItems: 'start' };
const caption: JSX.CSSProperties = {
  color: 'var(--text-lo)',
  fontSize: 'var(--fs-micro)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

function Sheet({ children }: { children: ComponentChildren }): JSX.Element {
  return <div style={sheet}>{children}</div>;
}

function Row({ children }: { children: ComponentChildren }): JSX.Element {
  return <div style={row}>{children}</div>;
}

function Demo({ label, width, children }: { label: string; width?: string; children: ComponentChildren }): JSX.Element {
  return (
    <div style={width ? { ...cell, width } : cell}>
      <small style={caption}>{label}</small>
      {children}
    </div>
  );
}

function story(component: string, state: string, render: Story['render'], extra: Partial<Story> = {}): Story {
  const slug = component.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return {
    id: `${slug}--${STATE_SLUG[state] ?? state.toLowerCase()}`,
    component,
    state,
    title: `${component} · ${state}`,
    layout: 'component',
    ...extra,
    render,
  };
}

// ---------- Button ----------

const BUTTON_VARIANTS: readonly { variant: ButtonVariant; label: () => string; icon?: LineIconName }[] = [
  { variant: 'primary', label: () => t('ui.common.confirm') },
  { variant: 'secondary', label: () => t('ui.common.back') },
  { variant: 'ghost', label: () => t('ui.common.reset') },
  { variant: 'danger', label: () => t('ui.common.cancel') },
];
const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

function buttonStory(state: string): Story {
  const demoState = demoOf(state);
  const disabled = state === 'Deaktiviert';
  return story('Button', state, () => (
    <Sheet>
      {BUTTON_SIZES.map((size) => (
        <Row key={size}>
          {BUTTON_VARIANTS.map((v) => (
            <Demo key={v.variant} label={`${v.variant} · ${size}`}>
              <Button variant={v.variant} size={size} demoState={demoState} disabled={disabled} testId={`button-${v.variant}-${size}`}>
                {v.label()}
              </Button>
            </Demo>
          ))}
          <Demo label="icon">
            <Button size="icon" icon="close" label={t('ui.common.close')} demoState={demoState} disabled={disabled} testId={`button-icon-${size}`} />
          </Demo>
        </Row>
      ))}
    </Sheet>
  ));
}

// ---------- Tab ----------

function tabStory(state: PrimitiveState): Story {
  const demo = demoOf(state);
  return story('Tab', state, () => (
    <Sheet>
      <Demo label="Tech-Tabs">
        <Tabs label={t('ui.common.tier', { n: '1–3' })}>
          <Tab selected={state === 'Ausgewählt/An'} demoState={demo} disabled={state === 'Deaktiviert'} keyHint={'1'} testId="tab-t1">
            {t('ui.common.tier', { n: 1 })}
          </Tab>
          <Tab testId="tab-t2">
            {t('ui.common.tier', { n: 2 })}
          </Tab>
          <Tab disabled={state === 'Deaktiviert'} testId="tab-t3">
            {t('ui.common.tier', { n: 3 })}
          </Tab>
        </Tabs>
      </Demo>
      <Demo label="Text-Tabs">
        <Tabs label={t('ui.common.system')}>
          <Tab selected={state === 'Ausgewählt/An'} demoState={demo} disabled={state === 'Deaktiviert'} testId="tab-text">
            {t('ui.common.system')}
          </Tab>
          <Tab testId="tab-text-2">{t('ui.common.mixed')}</Tab>
        </Tabs>
      </Demo>
    </Sheet>
  ));
}

// ---------- Segmented ----------

type Level = 'easy' | 'normal' | 'hard';

function SegmentedDemo({ state }: { state: PrimitiveState }): JSX.Element {
  const [value, setValue] = useState<Level>(state === 'Ausgewählt/An' ? 'hard' : 'normal');
  const options: readonly { value: Level; label: string }[] = [
    { value: 'easy', label: t('ui.common.off') },
    { value: 'normal', label: t('ui.common.system') },
    { value: 'hard', label: t('ui.common.on') },
  ];
  return (
    <Segmented<Level>
      label={t('ui.common.system')}
      options={options}
      value={value}
      onChange={setValue}
      disabled={state === 'Deaktiviert'}
      demoHover={state === 'Hover' ? 'easy' : undefined}
      demoFocus={state === 'Fokus' ? 'normal' : undefined}
    />
  );
}

function segmentedStory(state: PrimitiveState): Story {
  return story('Segmented', state, () => (
    <Sheet>
      <Demo label="Segmente">
        <SegmentedDemo state={state} />
      </Demo>
    </Sheet>
  ));
}

// ---------- Switch / Check ----------

function switchStory(state: PrimitiveState): Story {
  const on = state === 'Ausgewählt/An';
  return story('Switch', state, () => (
    <Sheet>
      <Row>
        <Demo label={on ? 'an' : 'aus'}>
          <Switch label={t('ui.common.on')} on={on} demoState={demoOf(state)} disabled={state === 'Deaktiviert'} />
        </Demo>
        {state === 'Deaktiviert' ? (
          <Demo label="an, deaktiviert">
            <Switch label={t('ui.common.on')} on disabled testId="switch-on-disabled" />
          </Demo>
        ) : null}
      </Row>
    </Sheet>
  ));
}

function checkStory(state: PrimitiveState): Story {
  const on = state === 'Ausgewählt/An';
  return story('Check', state, () => (
    <Sheet>
      <Row>
        <Demo label={on ? 'an' : 'aus'}>
          <Check label={t('ui.common.on')} checked={on} demoState={demoOf(state)} disabled={state === 'Deaktiviert'} />
        </Demo>
        {on ? (
          <Demo label="gemischt">
            <Check label={t('ui.common.mixed')} checked="mixed" testId="check-mixed" />
          </Demo>
        ) : null}
        {state === 'Deaktiviert' ? (
          <Demo label="an, deaktiviert">
            <Check label={t('ui.common.on')} checked disabled testId="check-on-disabled" />
          </Demo>
        ) : null}
      </Row>
    </Sheet>
  ));
}

// ---------- Range / Select / Input ----------

function rangeStory(state: PrimitiveState): Story {
  const value = state === 'Ausgewählt/An' ? 80 : 65;
  return story('Range', state, () => (
    <Sheet>
      <Demo label="Regler" width="14rem">
        <Range
          label={t('ui.common.system')}
          value={value}
          valueText={fmtPct(value / 100)}
          demoState={demoOf(state)}
          disabled={state === 'Deaktiviert'}
        />
      </Demo>
    </Sheet>
  ));
}

function selectStory(state: PrimitiveState): Story {
  return story('Select', state, () => (
    <Sheet>
      <Demo label="Auswahlliste" width="14rem">
        <Select
          label={t('ui.common.system')}
          value={state === 'Ausgewählt/An' ? 'on' : 'system'}
          options={[
            { value: 'system', label: t('ui.common.system') },
            { value: 'on', label: t('ui.common.on') },
            { value: 'off', label: t('ui.common.off') },
          ]}
          demoState={demoOf(state)}
          disabled={state === 'Deaktiviert'}
        />
      </Demo>
    </Sheet>
  ));
}

function inputStory(state: PrimitiveState): Story {
  return story('Input', state, () => (
    <Sheet>
      <Demo label="Eingabe" width="14rem">
        <Input
          label={t('ui.common.system')}
          placeholder={t('ui.common.none')}
          value={state === 'Ausgewählt/An' ? '0x7b21e04c' : ''}
          demoState={demoOf(state)}
          disabled={state === 'Deaktiviert'}
        />
      </Demo>
      {state === 'Standard' ? (
        <Demo label="ungültig" width="14rem">
          <Input label={t('ui.common.error')} value="?" invalid testId="input-invalid" />
        </Demo>
      ) : null}
    </Sheet>
  ));
}

// ---------- Bar ----------

const BAR_ROWS = [
  { kind: 'hp', label: 'HP' },
  { kind: 'shield', label: 'Schild' },
  { kind: 'build', label: 'Bau' },
  { kind: 'mass', label: 'Mass' },
  { kind: 'energy', label: 'Energy' },
] as const;

function barStory(state: 'Wert' | 'Warnung' | 'Kritisch'): Story {
  const level = state === 'Wert' ? 'normal' : state === 'Warnung' ? 'warn' : 'crit';
  const value = state === 'Wert' ? 0.86 : state === 'Warnung' ? 0.42 : 0.18;
  return story(
    'Bar',
    state,
    ({ model }) => (
      <Sheet>
        <div style={{ display: 'grid', gridTemplateColumns: '8rem 20rem', gap: '0.625rem 1rem', alignItems: 'center' }}>
          {BAR_ROWS.map((r) => [
            <small key={`${r.kind}-l`} style={caption}>
              {r.label}
            </small>,
            <Bar key={r.kind} kind={r.kind} value={r.kind === 'build' ? model.factory.progress : value} level={level} testId={`bar-${r.kind}`} />,
          ])}
          <small style={caption}>{'HP (automatisch)'}</small>
          <Bar kind="hp" value={value} testId="bar-hp-auto" />
          <small style={caption}>{'Abstich-Schwelle'}</small>
          <Bar kind="energy" value={value} level={level} marks={[0.75]} testId="bar-mark" />
        </div>
      </Sheet>
    ),
    {
      setup: ({ model }) => {
        // The build bar is bound to a model signal (hot path: --v without re-render).
        model.factory.progress.value = value;
      },
    },
  );
}

// ---------- Badge / Key / Vet ----------

const TONES: readonly Tone[] = ['neutral', 'ok', 'info', 'warn', 'crit', 'ember'];
const TONE_ICON: Readonly<Record<Tone, LineIconName | undefined>> = {
  neutral: undefined,
  ok: 'ok',
  info: 'info',
  warn: 'warn',
  crit: 'crit',
  ember: undefined,
};
const TONE_TEXT: Readonly<Record<Tone, () => string>> = {
  neutral: () => t('ui.common.none'),
  ok: () => t('ui.common.level.ok'),
  info: () => t('ui.common.level.info'),
  warn: () => t('ui.common.level.warn'),
  crit: () => t('ui.common.level.crit'),
  ember: () => t('ui.common.tier', { n: 2 }),
};

function badgeStory(tone: Tone): Story {
  return story('Badge', tone, () => (
    <Sheet>
      <Row>
        <Demo label="Text">
          <Badge tone={tone} testId={`badge-${tone}`}>
            {TONE_TEXT[tone]()}
          </Badge>
        </Demo>
        {TONE_ICON[tone] ? (
          <Demo label="mit Symbol">
            <Badge tone={tone} icon={TONE_ICON[tone]} testId={`badge-${tone}-icon`}>
              {TONE_TEXT[tone]()}
            </Badge>
          </Demo>
        ) : null}
      </Row>
    </Sheet>
  ));
}

function keyStory(tone: Tone): Story {
  return story('Key', tone, ({ model }) => (
    <Sheet>
      <Row>
        {(['KeyQ', 'KeyZ', 'Space', 'Delete', 'AltLeft', 'ShiftLeft'] as const).map((code) => (
          <Demo key={code} label={code}>
            <Key tone={tone} code={code} layout={model.keyboardLayout.value} testId={`key-${tone}-${code}`} />
          </Demo>
        ))}
      </Row>
    </Sheet>
  ));
}

function vetStory(tone: Tone): Story {
  return story('Vet', tone, () => (
    <Sheet>
      <Row>
        {[0, 1, 2, 3, 5].map((level) => (
          <Demo key={level} label={`Stufe ${level}`}>
            <Vet level={level} tone={tone} testId={`vet-${tone}-${level}`} />
          </Demo>
        ))}
      </Row>
    </Sheet>
  ));
}

export default defineStories([
  ...(['Standard', 'Hover', 'Gedrückt', 'Fokus', 'Deaktiviert'] as const).map(buttonStory),
  ...PRIMITIVE_STATES.map(tabStory),
  ...PRIMITIVE_STATES.map(segmentedStory),
  ...PRIMITIVE_STATES.map(switchStory),
  ...PRIMITIVE_STATES.map(checkStory),
  ...PRIMITIVE_STATES.map(rangeStory),
  ...PRIMITIVE_STATES.map(selectStory),
  ...PRIMITIVE_STATES.map(inputStory),
  ...(['Wert', 'Warnung', 'Kritisch'] as const).map(barStory),
  ...TONES.map(badgeStory),
  ...TONES.map(keyStory),
  ...TONES.map(vetStory),
]);
