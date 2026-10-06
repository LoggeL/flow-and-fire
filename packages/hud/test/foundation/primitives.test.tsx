// @vitest-environment happy-dom
import { signal } from '@preact/signals';
import { describe, expect, test, vi } from 'vitest';
import {
  Badge,
  Bar,
  Button,
  Check,
  Input,
  Key,
  LINE_ICON_NAMES,
  LINE_ICON_SPRITE_ID,
  LevelSymbol,
  LineIcon,
  Num,
  Panel,
  PanelHead,
  Range,
  ResourceGlyph,
  Segmented,
  Select,
  Switch,
  Tab,
  Tabs,
  TooltipFrame,
  Vet,
  fmtDec,
  rangeFill,
  setLocale,
} from '../../src/index.ts';
import { act, fireEvent, flushSignals, renderWithHud, screen } from '../support/index.tsx';

const byTestId = (id: string): HTMLElement => screen.getByTestId(id);

describe('Button', () => {
  test('variants, sizes and demo states map to mockup classes', () => {
    renderWithHud(
      <>
        <Button variant="primary" size="lg" testId="b1">{'x'}</Button>
        <Button variant="ghost" size="sm" demoState="hover" testId="b2">{'x'}</Button>
        <Button variant="danger" demoState="pressed" testId="b3">{'x'}</Button>
        <Button size="icon" icon="close" label="Schließen" demoState="focus" testId="b4" />
        <Button disabled testId="b5">{'x'}</Button>
      </>,
    );
    expect(byTestId('b1').className).toBe('ff-btn ff-btn--primary ff-btn--lg');
    expect(byTestId('b2').className).toBe('ff-btn ff-btn--ghost ff-btn--sm is-hover');
    expect(byTestId('b3').className).toBe('ff-btn ff-btn--danger is-pressed');
    expect(byTestId('b4').className).toBe('ff-btn ff-btn--icon is-focus');
    expect(byTestId('b4').getAttribute('aria-label')).toBe('Schließen');
    expect(byTestId('b4').querySelector('use')?.getAttribute('href')).toBe('#gi-close');
    expect(byTestId('b5').className).toBe('ff-btn is-disabled');
    expect((byTestId('b5') as HTMLButtonElement).disabled).toBe(true);
    expect(byTestId('b1').dataset['component']).toBe('Button');
    expect(byTestId('b1').getAttribute('type')).toBe('button');
  });

  test('click handler fires, not when disabled', () => {
    const onClick = vi.fn();
    renderWithHud(
      <>
        <Button onClick={onClick} testId="ok">{'x'}</Button>
        <Button onClick={onClick} disabled testId="off">{'x'}</Button>
      </>,
    );
    fireEvent.click(byTestId('ok'));
    fireEvent.click(byTestId('off'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Tabs / Tab', () => {
  test('selection, disabled, aria and arrow navigation', () => {
    const onSelect = vi.fn();
    renderWithHud(
      <Tabs label="Tech">
        <Tab selected testId="t1" onSelect={onSelect} keyHint={'1'}>{'T1'}</Tab>
        <Tab demoState="hover" testId="t2" onSelect={onSelect}>{'T2'}</Tab>
        <Tab disabled testId="t3" onSelect={onSelect}>{'T3'}</Tab>
      </Tabs>,
    );
    const t1 = byTestId('t1');
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('Tech');
    expect(t1.className).toBe('ff-tab is-selected');
    expect(t1.getAttribute('aria-selected')).toBe('true');
    expect(t1.tabIndex).toBe(0);
    expect(t1.querySelector('.ff-key')?.textContent).toBe('1');
    expect(byTestId('t2').className).toBe('ff-tab is-hover');
    expect(byTestId('t3').className).toBe('ff-tab is-disabled');
    expect(byTestId('t3').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(byTestId('t3'));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(byTestId('t2'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    t1.focus();
    fireEvent.keyDown(t1, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(byTestId('t2'));
    fireEvent.keyDown(byTestId('t2'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(t1);
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'easy', label: 'Leicht' },
    { value: 'normal', label: 'Normal' },
    { value: 'hard', label: 'Schwer' },
  ] as const;

  test('radio semantics, selection and keyboard', () => {
    const onChange = vi.fn();
    renderWithHud(<Segmented label="Stufe" options={options} value="normal" onChange={onChange} demoHover="hard" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios[1]?.className).toBe('is-selected');
    expect(radios[2]?.className).toBe('is-hover');
    fireEvent.click(radios[0] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith('easy');
    (radios[1] as HTMLElement).focus();
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('hard');
  });

  test('disabled group', () => {
    renderWithHud(<Segmented label="Stufe" options={options} value="easy" disabled />);
    expect(byTestId('segmented').className).toBe('ff-seg is-disabled');
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Switch / Check', () => {
  test('switch toggles and reflects state', () => {
    const onChange = vi.fn();
    renderWithHud(
      <>
        <Switch label="Bloom" on={false} onChange={onChange} testId="s1" />
        <Switch label="Bloom" on disabled testId="s2" />
      </>,
    );
    expect(byTestId('s1').className).toBe('ff-switch');
    expect(byTestId('s1').getAttribute('role')).toBe('switch');
    expect(byTestId('s1').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(byTestId('s1'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(byTestId('s2').className).toBe('ff-switch is-on is-disabled');
    expect(byTestId('s2').getAttribute('aria-checked')).toBe('true');
  });

  test('check on / off / mixed', () => {
    const onChange = vi.fn();
    renderWithHud(
      <>
        <Check label="a" checked testId="c1" />
        <Check label="b" checked={false} demoState="focus" testId="c2" />
        <Check label="c" checked="mixed" onChange={onChange} testId="c3" />
      </>,
    );
    expect(byTestId('c1').className).toBe('ff-check is-on');
    expect(byTestId('c2').className).toBe('ff-check is-focus');
    expect(byTestId('c3').className).toBe('ff-check is-mixed');
    expect(byTestId('c3').getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(byTestId('c3'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Range / Select / Input', () => {
  test('range sets --v and reports numbers', () => {
    const onChange = vi.fn();
    renderWithHud(<Range label="Musik" value={65} onChange={onChange} valueText="65 %" />);
    const r = byTestId('range') as HTMLInputElement;
    expect(r.style.getPropertyValue('--v')).toBe('65%');
    expect(r.getAttribute('aria-valuetext')).toBe('65 %');
    r.value = '30';
    fireEvent.input(r);
    expect(onChange).toHaveBeenCalledWith(30);
    expect(rangeFill(0.8, 0.5, 1)).toBe('60%');
    expect(rangeFill(5, 5, 5)).toBe('0%');
  });

  test('select emits typed values', () => {
    const onChange = vi.fn();
    renderWithHud(
      <Select
        label="Schatten"
        value="b"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Aus' },
          { value: 'b', label: '2 Kaskaden' },
        ]}
      />,
    );
    const s = byTestId('select') as HTMLSelectElement;
    expect(s.className).toBe('ff-select');
    expect(s.value).toBe('b');
    s.value = 'a';
    fireEvent.change(s);
    expect(onChange).toHaveBeenCalledWith('a');
  });

  test('input: placeholder, invalid, disabled', () => {
    const onInput = vi.fn();
    renderWithHud(<Input label="Seed" placeholder="Zufall" value="" invalid onInput={onInput} />);
    const i = byTestId('input') as HTMLInputElement;
    expect(i.className).toBe('ff-input is-invalid');
    expect(i.getAttribute('aria-invalid')).toBe('true');
    expect(i.placeholder).toBe('Zufall');
    i.value = '42';
    fireEvent.input(i);
    expect(onInput).toHaveBeenCalledWith('42');
  });
});

describe('Bar', () => {
  test('static values: kind classes and HP auto levels', () => {
    renderWithHud(
      <>
        <Bar kind="hp" value={0.86} testId="h1" />
        <Bar kind="hp" value={0.42} testId="h2" />
        <Bar kind="hp" value={0.18} testId="h3" />
        <Bar kind="energy" value={0.1} level="crit" testId="e" />
        <Bar kind="build" value={1.7} marks={[0.5]} label="Bau" testId="b" />
      </>,
    );
    expect(byTestId('h1').className).toBe('ff-bar ff-bar--hp');
    expect(byTestId('h2').className).toBe('ff-bar ff-bar--hp is-warn');
    expect(byTestId('h3').className).toBe('ff-bar ff-bar--hp is-crit');
    expect(byTestId('e').className).toBe('ff-bar ff-bar--energy is-crit');
    const fill = byTestId('b').querySelector('i') as HTMLElement;
    expect(fill.style.getPropertyValue('--v')).toBe('1');
    expect(byTestId('b').getAttribute('role')).toBe('img');
    expect(byTestId('b').querySelector('.ff-bar__mark')).not.toBeNull();
    expect(byTestId('h1').getAttribute('aria-hidden')).toBe('true');
  });

  test('signal value updates --v and level classes without re-rendering', () => {
    const v = signal(0.9);
    let renders = 0;
    function Probe() {
      renders++;
      return <Bar kind="hp" value={v} />;
    }
    renderWithHud(<Probe />);
    const bar = byTestId('bar-hp');
    const fill = bar.querySelector('i') as HTMLElement;
    expect(fill.style.getPropertyValue('--v')).toBe('0.9');
    act(() => {
      v.value = 0.25;
    });
    expect(fill.style.getPropertyValue('--v')).toBe('0.25');
    expect(bar.classList.contains('is-crit')).toBe(true);
    act(() => {
      v.value = 0.5;
    });
    expect(bar.classList.contains('is-crit')).toBe(false);
    expect(bar.classList.contains('is-warn')).toBe(true);
    expect(renders).toBe(1);
  });
});

describe('Num', () => {
  test('binds a signal as text, writes only on changed strings, never re-renders', async () => {
    const v = signal(312);
    let renders = 0;
    function Probe() {
      renders++;
      return <Num value={v} ch={6} />;
    }
    renderWithHud(<Probe />);
    const el = byTestId('num');
    expect(el.textContent).toBe('312');
    expect(el.className).toBe('num ff-numbox');
    expect(el.style.minWidth).toBe('6ch');
    const node = el.firstChild as Text;
    let writes = 0;
    const observer = new MutationObserver((m) => {
      writes += m.length;
    });
    observer.observe(el, { characterData: true, subtree: true, childList: true });
    act(() => {
      v.value = 1230;
    });
    act(() => {
      v.value = 1230.2; // same formatted string → no write
    });
    await flushSignals();
    expect(el.textContent).toBe('1.230');
    expect(el.firstChild).toBe(node);
    expect(writes).toBe(1);
    observer.disconnect();
    expect(renders).toBe(1);
  });

  test('custom formatter and locale switch', async () => {
    const v = signal(28);
    renderWithHud(<Num value={v} format={(x) => fmtDec(x, 1)} />);
    expect(byTestId('num').textContent).toBe('28,0');
    await flushSignals(() => setLocale('en'));
    expect(byTestId('num').textContent).toBe('28.0');
  });

  test('plain numbers', () => {
    renderWithHud(<Num value={4900} align="left" />);
    expect(byTestId('num').textContent).toBe('4.900');
    expect(byTestId('num').style.textAlign).toBe('left');
  });
});

describe('Badge / Key / Vet', () => {
  test('tones', () => {
    renderWithHud(
      <>
        <Badge testId="n">{'Neutral'}</Badge>
        <Badge tone="crit" icon="crit" testId="c">{'Stall'}</Badge>
        <Badge tone="ember" testId="e">{'MS14'}</Badge>
        <Key testId="k1">{'Q'}</Key>
        <Key tone="ember" code="KeyZ" layout="de" testId="k2" />
        <Key code="KeyZ" layout="en" testId="k3" />
        <Vet level={2} testId="v" />
        <Vet level={9} tone="ember" testId="v2" />
      </>,
    );
    expect(byTestId('n').className).toBe('ff-badge');
    expect(byTestId('c').className).toBe('ff-badge ff-badge--crit');
    expect(byTestId('c').querySelector('use')?.getAttribute('href')).toBe('#gi-crit');
    expect(byTestId('e').className).toBe('ff-badge ff-badge--ember');
    expect(byTestId('k1').tagName).toBe('KBD');
    expect(byTestId('k1').className).toBe('ff-key');
    expect(byTestId('k2').className).toBe('ff-key ff-key--ember');
    expect(byTestId('k2').textContent).toBe('Y');
    expect(byTestId('k3').textContent).toBe('Z');
    const vet = byTestId('v');
    expect(vet.className).toBe('ff-vet');
    expect([...vet.querySelectorAll('i')].map((i) => i.className)).toEqual(['on', 'on', '', '', '']);
    expect(vet.getAttribute('aria-label')).toBe('Veteranenstufe 2 von 5');
    expect(byTestId('v2').querySelectorAll('i.on')).toHaveLength(5);
    expect(byTestId('v2').className).toBe('ff-vet ff-vet--ember');
  });
});

describe('Panel / PanelHead', () => {
  test('tone, chamfer, data-panel, head markup', () => {
    renderWithHud(
      <Panel tone="copper" chamfer="l" solid panelId="card" component="CommandCard" label="Karte" testId="p">
        <PanelHead title="Bau · Vogt" end={'T1'} />
      </Panel>,
    );
    const p = byTestId('p');
    expect(p.tagName).toBe('SECTION');
    expect(p.className).toBe('ff-panel ff-panel--copper ff-panel--solid ff-panel--chamfer-l');
    expect(p.dataset['panel']).toBe('card');
    expect(p.dataset['component']).toBe('CommandCard');
    expect(p.getAttribute('aria-label')).toBe('Karte');
    const head = byTestId('panel-head');
    expect(head.className).toBe('ff-ph');
    expect(head.querySelector('[data-fit]')?.textContent).toBe('Bau · Vogt');
    expect(head.querySelector('.ff-ph__end')?.textContent).toBe('T1');
  });
});

describe('icons and glyphs', () => {
  test('LineIcon references the sprite which is inserted once', () => {
    renderWithHud(
      <>
        <LineIcon name="move" />
        <LineIcon name="stop" class="ff-gi--fill" />
      </>,
    );
    const sprites = document.querySelectorAll(`#${LINE_ICON_SPRITE_ID}`);
    expect(sprites).toHaveLength(1);
    expect(sprites[0]?.querySelectorAll('symbol')).toHaveLength(LINE_ICON_NAMES.length);
    expect(document.getElementById('gi-play')?.innerHTML).toContain('fill="currentColor" stroke="none"');
    expect(document.getElementById('gi-idle')?.innerHTML).toContain('stroke-width="1.6"');
    const icon = byTestId('line-icon-stop');
    expect(icon.getAttribute('class')).toBe('ff-gi ff-gi--fill');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelector('use')?.getAttribute('href')).toBe('#gi-stop');
  });

  test('LevelSymbol shapes and labels', () => {
    renderWithHud(
      <>
        <LevelSymbol level="crit" />
        <LevelSymbol level="warn" />
        <LevelSymbol level="info" decorative />
        <LevelSymbol level="ok" />
      </>,
    );
    expect(byTestId('level-crit').className).toBe('ff-level ff-level--crit');
    expect(byTestId('level-crit').getAttribute('aria-label')).toBe('Kritisch');
    expect(byTestId('level-crit').querySelector('use')?.getAttribute('href')).toBe('#gi-crit');
    expect(byTestId('level-warn').querySelector('use')?.getAttribute('href')).toBe('#gi-warn');
    expect(byTestId('level-info').getAttribute('aria-hidden')).toBe('true');
    expect(byTestId('level-info').getAttribute('role')).toBeNull();
    expect(byTestId('level-ok').querySelector('use')?.getAttribute('href')).toBe('#gi-ok');
  });

  test('ResourceGlyph diamond / flame, icon and dot', () => {
    renderWithHud(
      <>
        <ResourceGlyph kind="mass" />
        <ResourceGlyph kind="energy" variant="dot" />
      </>,
      { locale: 'en' },
    );
    expect(byTestId('glyph-mass').getAttribute('aria-label')).toBe('Mass');
    expect(byTestId('glyph-mass').querySelector('svg')?.getAttribute('class')).toBe('ff-gi ff-gi--mass');
    expect(byTestId('glyph-energy').className).toBe('ff-res ff-res--energy');
    expect(byTestId('glyph-energy').getAttribute('aria-label')).toBe('Energy');
  });
});

describe('TooltipFrame', () => {
  test('full layout: head, cost, grid, body, adjacency, foot', () => {
    renderWithHud(
      <TooltipFrame
        name="Erzspeicher I"
        role="Speicher"
        keyHint={'R'}
        cost={{ mass: '150', energy: '750', flow: '≈ 6,5 M/s · 33 E/s', flowWarn: true }}
        stats={[
          { label: 'HP', value: '1.600' },
          { label: 'DPS', value: '–' },
          { label: 'Speicher', value: '500 M' },
          { label: 'Sicht', value: '20 WU' },
          { label: 'Bauzeit', value: '8,0 s', sub: 'bei BP 10' },
          { label: 'Tech', value: 'T1' },
          { label: 'zu viel', value: 'x' },
        ]}
        body="Gussbehälter für Erz."
        adjacency={{ label: 'Nachbarschaft:', text: '+10 % Förderung' }}
        foot={'Klick platzieren'}
      />,
    );
    const tip = byTestId('tooltip-frame');
    expect(tip.className).toBe('ff-tip');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.querySelector('.ff-tip__name')?.textContent).toBe('Erzspeicher I');
    expect(tip.querySelector('.ff-tip__role')?.textContent).toBe('Speicher');
    expect(tip.querySelector('.ff-key--ember')?.textContent).toBe('R');
    expect(tip.querySelector('.ff-tip__mass b')?.textContent).toBe('150');
    expect(tip.querySelector('.ff-tip__energy b')?.textContent).toBe('750');
    expect(tip.querySelector('.ff-tip__flow')?.className).toContain('is-warn');
    expect(tip.querySelectorAll('.ff-tip__grid > div')).toHaveLength(6);
    expect(tip.querySelector('.ff-tip__sub')?.textContent).toBe('bei BP 10');
    expect(tip.querySelector('.ff-tip__body')?.textContent).toBe('Gussbehälter für Erz.');
    expect(tip.querySelector('.ff-tip__adj')?.textContent).toBe('Nachbarschaft: +10 % Förderung');
    expect(tip.querySelector('.ff-tip__foot')?.textContent).toBe('Klick platzieren');
  });

  test('minimal: without optional parts', () => {
    renderWithHud(<TooltipFrame name="Stop" />);
    const tip = byTestId('tooltip-frame');
    for (const part of ['.ff-tip__cost', '.ff-tip__grid', '.ff-tip__body', '.ff-tip__adj', '.ff-tip__foot']) {
      expect(tip.querySelector(part), part).toBeNull();
    }
  });
});
