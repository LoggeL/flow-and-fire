import { MenuShell, Panel, PanelHead, useHud } from '@faf/hud';
import { liveUnitText } from './unit-text.ts';

/** Unit names come from the actual content texts, so the briefing follows renames. */
const NAMES = { acu: 'core:cmd_commander', mex: 'core:str_t1_mex', pgen: 'core:str_t1_pgen', fac: 'core:fac_land_t1' } as const;
type Text = { readonly de: string; readonly en: string };
const SECTIONS: readonly { readonly title: Text; readonly items: readonly Text[] }[] = [
  { title: { de: 'Die ersten Minuten', en: 'The first minutes' }, items: [
    { de: 'Wähle deinen {acu} mit Linksklick. Die Baukarte unten links zeigt, was er errichten kann; die Taste steht oben links auf jeder Karte.', en: 'Select your {acu} with a left click. The build card at the bottom left lists what it can build; each card shows its key in the top left corner.' },
    { de: '{mex} fördert Masse und steht nur auf Massepunkten (helle Ringe am Boden). {pgen} erzeugt Energie.', en: '{mex} extracts mass and only fits on mass points (light rings on the ground). {pgen} generates energy.' },
    { de: '{fac} baut Einheiten. Wähle es aus und klicke Einheiten in der Produktionskarte an; Umschalt+Klick reiht fünf ein.', en: '{fac} builds units. Select it and click units in the production card; Shift+click queues five.' },
  ] },
  { title: { de: 'Steuerung', en: 'Controls' }, items: [
    { de: 'Linksklick wählt, Ziehen wählt im Rahmen, Rechtsklick bewegt oder führt den passenden Befehl aus.', en: 'Left click selects, dragging selects in a box, right click moves or issues the fitting order.' },
    { de: 'Umschalt hängt Befehle an. Umschalt-Ziehen beim Bauen setzt eine ganze Reihe.', en: 'Shift appends orders. Shift-dragging while placing builds a whole row.' },
    { de: 'Mausrad zoomt, Pfeiltasten oder Bildschirmrand verschieben die Kamera, H springt zum {acu}.', en: 'The mouse wheel zooms, arrow keys or the screen edge pan the camera, H jumps to the {acu}.' },
    { de: 'Alt+Ziffer speichert eine Gruppe, die Ziffer wählt sie wieder. P pausiert, Esc öffnet das Menü oder bricht ab.', en: 'Alt+digit stores a group, the digit selects it again. P pauses, Esc opens the menu or cancels.' },
  ] },
  { title: { de: 'Wirtschaft', en: 'Economy' }, items: [
    { de: 'Oben links stehen Vorrat, Einnahmen und Verbrauch. Reicht eine Ressource nicht, wird alles langsamer gebaut.', en: 'The top left shows storage, income and spending. If a resource runs short, everything builds slower.' },
    { de: '„Pausiert“ im Auswahlfeld heißt: Die Einheit verbraucht nichts, produziert aber auch nichts. „Fortsetzen“ hebt das auf.', en: '“Paused” in the selection panel means the unit neither spends nor produces. “Resume” lifts it.' },
    { de: '{acu} und {mex} lassen sich gegen Masse und Energie ausbauen. „Abbrechen + fortsetzen“ beendet einen pausierten Ausbau und lässt die Einheit weiterarbeiten.', en: '{acu} and {mex} can be upgraded for mass and energy. “Cancel & resume” ends a paused upgrade and lets the unit work again.' },
  ] },
  { title: { de: 'Sieg', en: 'Victory' }, items: [
    { de: 'Die Siegbedingung stellst du im Gefecht ein. Nach der Partie zeigt das Ergebnis die erfassten Werte beider Seiten.', en: 'You choose the victory condition in the skirmish setup. Afterwards the result screen shows the recorded totals of both sides.' },
  ] },
];

/** Static briefing: real controls and rules of this build, no placeholder tutorial flow. */
export function LiveBriefing() {
  const m = useHud(), lang = m.locale.value === 'en' ? 'en' : 'de';
  const text = (value: string) => value.replace(/\{(acu|mex|pgen|fac)\}/g, (_, key: keyof typeof NAMES) => liveUnitText(NAMES[key], 'name', m.locale.value));
  return <MenuShell component="Briefing" title={lang === 'en' ? 'Briefing' : 'Einweisung'}><main class="live-info-screen" data-testid="briefing">{SECTIONS.map(section =>
    <Panel key={section.title.de} class="live-info-panel"><PanelHead title={section.title[lang]}/><ul>{section.items.map(item => <li key={item.de}>{text(item[lang])}</li>)}</ul></Panel>)}</main></MenuShell>;
}

const LIBRARIES: readonly [string, string][] = [
  ['Preact, @preact/signals', 'MIT'], ['gl-matrix', 'MIT'], ['meshoptimizer', 'MIT'], ['@sinclair/typebox', 'MIT'],
  ['IBM Plex Mono, IBM Plex Sans Condensed', 'SIL OFL 1.1'], ['opus-decoder, @wasm-audio-decoders/common', 'MIT'],
];
/** Credits in the menu style; library list mirrors the bundled THIRD_PARTY_NOTICES.txt. */
export function LiveCredits({ build }: { readonly build: string }) {
  const m = useHud(), en = m.locale.value === 'en';
  return <MenuShell component="Credits" title={en ? 'Credits' : 'Mitwirkende'}><main class="live-info-screen" data-testid="credits">
    <Panel class="live-info-panel"><PanelHead title="Flow & Fire"/><p>{en ? 'A browser real-time strategy game inspired by Supreme Commander: Forged Alliance. Not affiliated with its rights holders.' : 'Ein Echtzeitstrategiespiel im Browser, inspiriert von Supreme Commander: Forged Alliance. Kein offizielles Produkt der Rechteinhaber.'}</p>{build && <p class="live-info-meta">Build {build}</p>}</Panel>
    <Panel class="live-info-panel"><PanelHead title={en ? 'Bundled libraries and fonts' : 'Enthaltene Bibliotheken und Schriften'}/><ul>{LIBRARIES.map(([name, licence]) => <li key={name}><span>{name}</span> <small>{licence}</small></li>)}</ul>
      <p><a href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noopener">{en ? 'Full licence texts' : 'Vollständige Lizenztexte'}</a></p></Panel>
  </main></MenuShell>;
}
