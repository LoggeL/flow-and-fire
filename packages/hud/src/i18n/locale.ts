import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';

/** UI locales (P12). "pseudo" is German text stretched by ≥ 30 % with accents and brackets for layout checks. */
export type Locale = 'de' | 'en' | 'pseudo';

export const LOCALES: readonly Locale[] = ['de', 'en', 'pseudo'];

/** Current UI locale. `t()` and the formatters read it, so components re-render on change. */
export const locale: Signal<Locale> = signal<Locale>('de');

export function setLocale(next: Locale): void {
  locale.value = next;
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** BCP-47 tag for Intl formatting; pseudo formats like German (it is derived from the German text). */
export function intlTag(l: Locale): string {
  return l === 'en' ? 'en-US' : 'de-DE';
}
