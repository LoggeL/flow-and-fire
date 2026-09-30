// @vitest-environment happy-dom
/**
 * Form controls of the panels (src/ui/components/inputs.tsx) in isolation: Row layout (normal and
 * wide, used by the symmetry panel so long option labels are not cut off), InfoRow and the
 * ValueInput commit rules (Enter + change commit once, invalid text never commits, Esc discards,
 * unchanged values issue no command, a new model value drops the draft).
 */
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountInputsFixture, type InputsFixture } from './inputs-fixture.tsx';

let root: HTMLElement;
let fx: InputsFixture;

function q<T extends Element = HTMLElement>(testId: string): T {
  const el = root.querySelector(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`missing ${testId}`);
  return el as T;
}

function type(input: HTMLInputElement, text: string): void {
  act(() => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function key(input: HTMLInputElement, k: string): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });
}

function change(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  act(() => {
    fx = mountInputsFixture(root, 10);
  });
});

afterEach(() => {
  act(() => fx.unmount());
  root.remove();
});

describe('Row / InfoRow', () => {
  it('lays a wide row out as label above control', () => {
    const plain = q('plain-select').closest('.me-row')!;
    const wide = q('wide-select').closest('.me-row')!;
    expect(plain.classList.contains('me-row-wide')).toBe(false);
    expect(wide.classList.contains('me-row-wide')).toBe(true);
    expect(wide.getAttribute('title')).toBe('full label');
    expect(q('info-value').textContent).toBe('42');
  });
});

describe('ValueInput', () => {
  it('commits a valid value once on Enter followed by change', () => {
    const input = q<HTMLInputElement>('density');
    expect(input.value).toBe('10');
    type(input, '42');
    key(input, 'Enter');
    change(input);
    expect(fx.commits).toEqual([42]);
    expect(input.value).toBe('42');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('marks invalid text red and never commits it', () => {
    const input = q<HTMLInputElement>('density');
    for (const bad of ['0', '101', 'abc', '', '4.5']) {
      type(input, bad);
      key(input, 'Enter');
      change(input);
      expect(input.classList.contains('me-invalid'), bad).toBe(true);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    expect(fx.commits).toEqual([]);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('discards the draft with Escape and skips unchanged values', () => {
    const input = q<HTMLInputElement>('density');
    type(input, '77');
    key(input, 'Escape');
    expect(input.value).toBe('10');
    change(input);
    type(input, '10');
    key(input, 'Enter');
    expect(fx.commits).toEqual([]);
  });

  it('drops a pending draft when the model value changes', () => {
    const input = q<HTMLInputElement>('density');
    type(input, '55');
    act(() => fx.setValue(12));
    expect(input.value).toBe('12');
    change(input);
    expect(fx.commits).toEqual([]);
  });
});
