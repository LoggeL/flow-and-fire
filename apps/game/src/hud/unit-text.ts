/** Live compiled units can exist outside the presentation-only design roster. */
import { findUnit, normalizeTypeId, pseudo, unitText, unitTextKey, type Locale, type UnitTextField } from '@faf/hud';
// Vite raw imports keep these actual content dictionaries inside the Game build without extending
// the composite TypeScript project's src root to include content JSON files.
import deJson from '../../../../content/locales/de.json?raw';
import enJson from '../../../../content/locales/en.json?raw';
import { hudTypeId, simTypeId } from './type-ids.ts';

const CONTENT_TEXT: Readonly<Record<'de' | 'en', Readonly<Record<string, string>>>> = {
  de: JSON.parse(deJson) as Record<string, string>,
  en: JSON.parse(enJson) as Record<string, string>,
};

/** Roster text first; otherwise actual P12 content names/descriptions and a safe generic role. */
export function liveUnitText(typeId: string, field: UnitTextField, locale: Locale): string {
  const fullId = normalizeTypeId(typeId);
  const rosterId = hudTypeId(fullId);
  if (findUnit(rosterId) !== undefined) return unitText(rosterId, field, locale);
  const language = locale === 'en' ? 'en' : 'de';
  const generic = language === 'en' ? 'Unit' : 'Einheit';
  const contentId = simTypeId(fullId);
  let text: string;
  if (field === 'name' || field === 'short') {
    text = CONTENT_TEXT[language][unitTextKey(contentId, 'name')] ?? generic;
    if (field === 'short') text = text.slice(0, 10);
  } else if (field === 'desc') {
    text = CONTENT_TEXT[language][unitTextKey(contentId, 'desc')] ?? '';
  } else {
    text = field === 'role' ? generic : '';
  }
  if (locale !== 'pseudo') return text;
  const translated = pseudo(text);
  return field === 'short' ? translated.slice(1, translated.length - 1).replace(/~+$/, '') : translated;
}
