/**
 * All German UI texts of the panels (TRACK-EDITOR P6) in one place. Functions build texts with
 * values; everything else is a plain string.
 */
import type { PropFieldKind, SpotKind } from '@faf/formats';
import type { SymmetryMode, ToolId } from '../model/types.ts';

export const TOOL_LABELS: Readonly<Record<ToolId, string>> = {
  select: 'Auswählen',
  start: 'Startposition',
  mass: 'Mass-Spot',
  hydro: 'Hydro-Spot',
  fieldCircle: 'Feld (Kreis)',
  fieldPolygon: 'Feld (Polygon)',
  delete: 'Löschen',
};

export const TOOL_HINTS: Readonly<Record<ToolId, string>> = {
  select: 'Klick wählt, Shift+Klick ergänzt, Ziehen verschiebt, Ziehen ins Leere schwenkt die Kamera',
  start: 'Klick setzt eine Startposition (kleinste freie Armee)',
  mass: 'Klick setzt einen Mass-Spot',
  hydro: 'Klick setzt einen Hydro-Spot',
  fieldCircle: 'Ziehen: Mittelpunkt → Radius (mindestens 1 WU)',
  fieldPolygon: 'Klicks setzen Punkte, Doppelklick/Enter schließt (≥ 3), Backspace entfernt den letzten, Esc bricht ab',
  delete: 'Klick löscht den Treffer (auf einem Eckpunkt nur den Eckpunkt)',
};

export const SYMMETRY_LABELS: Readonly<Record<SymmetryMode, string>> = {
  none: 'Keine',
  point: 'Punkt (Mitte)',
  mirrorX: 'Achse X (links ↔ rechts)',
  mirrorZ: 'Achse Z (oben ↔ unten)',
  diagonal: 'Diagonale (x = z)',
  antiDiagonal: 'Gegendiagonale (x + z = Größe)',
};

/** Label of the half that `symmetrize(mode, keep)` keeps (half a: axis function < 0, see symmetry.ts). */
export const KEEP_HALF_LABELS: Readonly<Record<SymmetryMode, { readonly a: string; readonly b: string }>> = {
  none: { a: 'Hälfte A', b: 'Hälfte B' },
  point: { a: 'A – linke Hälfte (x < Mitte)', b: 'B – rechte Hälfte (x > Mitte)' },
  mirrorX: { a: 'A – links (x < Mitte)', b: 'B – rechts (x > Mitte)' },
  mirrorZ: { a: 'A – oben (z < Mitte)', b: 'B – unten (z > Mitte)' },
  diagonal: { a: 'A – unten links (x < z)', b: 'B – oben rechts (x > z)' },
  antiDiagonal: { a: 'A – oben links (x + z < Größe)', b: 'B – unten rechts (x + z > Größe)' },
};

export const FIELD_KIND_LABELS: Readonly<Record<PropFieldKind, string>> = {
  tree: 'Baum',
  rock: 'Fels',
  wreck: 'Wrack',
};

export const SPOT_KIND_LABELS: Readonly<Record<SpotKind, string>> = {
  mass: 'Mass',
  hydro: 'Hydro',
};

export const SEVERITY_LABELS = {
  error: 'Fehler',
  warning: 'Warnungen',
  info: 'Hinweise',
} as const;

export const SEVERITY_SHORT = {
  error: 'Fehler',
  warning: 'Warnung',
  info: 'Hinweis',
} as const;

export const S = {
  appTitle: 'Marker-Editor',
  open: 'Öffnen …',
  openTitle: '.rtsmap-Datei öffnen (Strg+O)',
  mapSelect: 'Karte',
  mapSelectPlaceholder: 'Mitgelieferte Karte …',
  mapSelectLoading: 'Lade Kartenliste …',
  mapSelectFailed: 'Kartenliste nicht verfügbar',
  save: 'Speichern',
  saveTitle: '.rtsmap herunterladen (Strg+S)',
  exportMarkers: 'markers.json',
  exportMarkersTitle: 'markers.json für mapc exportieren',
  undo: 'Rückgängig',
  redo: 'Wiederholen',
  undoTitle: 'Rückgängig (Strg+Z)',
  redoTitle: 'Wiederholen (Strg+Umschalt+Z / Strg+Y)',
  fit: 'Einpassen',
  fitTitle: 'Ganze Karte zeigen (F)',
  help: 'Hilfe',
  helpTitle: 'Tastenkürzel und Bedienung (?)',
  noFile: 'keine Karte',
  dirtyMark: '*',
  dirtyTitle: 'Ungespeicherte Änderungen',

  tools: 'Werkzeuge',

  symmetry: 'Symmetrie',
  symmetryMode: 'Modus',
  keepHalf: 'Behalten',
  symmetrize: 'Symmetrisieren',
  symmetrizeTitle: 'Die andere Hälfte durch Spiegelbilder der behaltenen Hälfte ersetzen (ein Undo-Schritt)',
  liveSymmetry: 'Live-Symmetrie',
  liveSymmetryTitle: 'Änderungen wirken auch auf den gespiegelten Zwilling',
  grid: 'Raster',
  gridTitle: 'Höhenraster einblenden (G)',
  snap: 'Einrasten',
  snapOff: 'aus',

  properties: 'Eigenschaften',
  noDocument: 'Keine Karte geladen. Öffne eine .rtsmap-Datei oder wähle eine mitgelieferte Karte.',
  noSelection: 'Nichts ausgewählt. Klicke mit dem Auswahlwerkzeug auf einen Marker.',
  mapInfo: 'Karte',
  start: 'Startposition',
  spot: 'Ressourcen-Spot',
  field: 'Prop-Feld',
  vertex: 'Eckpunkt',
  army: 'Armee',
  armyTaken: 'belegt – wird getauscht',
  kind: 'Art',
  x: 'x (WU)',
  z: 'z (WU)',
  radius: 'Radius (WU)',
  name: 'Name',
  ids: 'Blueprints (id:gewicht, …)',
  idsHint: 'z. B. core:tree_01:3, core:tree_02:1',
  density: 'Dichte je 1024 WU²',
  seed: 'Seed',
  reseed: 'Neu würfeln',
  reseedTitle: 'Neuen Seed erzeugen (deterministisch aus Seed und Revision)',
  scaleMin: 'Skalierung min (%)',
  scaleMax: 'Skalierung max (%)',
  maxSlope: 'Max. Neigung (‰, 0 = egal)',
  dryOnly: 'Nur auf trockenem Land',
  reclaimMass: 'Reclaim Masse je Prop',
  reclaimEnergy: 'Reclaim Energie je Prop',
  expanded: 'Props (expandiert)',
  reclaimTotal: 'Summe Reclaim',
  vertexOf: (field: number, vertex: number): string => `Punkt ${vertex + 1} von Feld ${field + 1}`,
  polygonPoints: (n: number): string => `Polygon mit ${n} Punkten`,
  circleShape: 'Kreis',
  multiTitle: (n: number): string => `${n} Objekte ausgewählt`,
  multiStarts: (n: number): string => `${n} Startposition${n === 1 ? '' : 'en'}`,
  multiSpots: (mass: number, hydro: number): string => `${mass} Mass, ${hydro} Hydro`,
  multiFields: (n: number): string => `${n} Prop-Feld${n === 1 ? '' : 'er'}`,
  multiVertices: (n: number): string => `${n} Eckpunkt${n === 1 ? '' : 'e'}`,
  multiHint: 'Ziehen verschiebt alle, Entf löscht alle. Einzelwerte bei Auswahl eines Objekts.',
  armyOption: (army: number): string => `Armee ${army + 1}`,

  validation: 'Validierung',
  noIssues: 'Keine Befunde – die Karte ist in Ordnung.',
  issuesHidden: (n: number): string => `${n} weitere Befunde ausgeblendet`,
  mapWide: 'kartenweit',
  filterTitle: 'Klick blendet diese Schwere ein/aus',

  cursor: 'Cursor',
  size: 'Größe',
  starts: 'Starts',
  mass: 'Mass',
  hydro: 'Hydro',
  fields: 'Felder',
  props: 'Props',
  selected: 'Auswahl',
  dirty: 'ungespeichert',
  clean: 'gespeichert',

  helpHeading: 'Bedienung & Tastenkürzel',
  helpClose: 'Schließen',
  helpMouse: 'Maus',
  helpKeys: 'Tastatur',
  helpTools: 'Werkzeuge',
  helpFooter: 'Zahlenfelder übernehmen den Wert mit Enter oder beim Verlassen (ein Undo-Schritt); Esc verwirft die Eingabe. Rot markierte Eingaben werden nicht übernommen.',
} as const;

/** Keyboard shortcuts shown in the help overlay (the controller's keymap, P5). */
export const HELP_KEYS: readonly (readonly [string, string])[] = [
  ['1 – 7', 'Werkzeug wählen (Reihenfolge der Werkzeugleiste)'],
  ['Strg/⌘ + Z', 'Rückgängig'],
  ['Strg/⌘ + Umschalt + Z, Strg + Y', 'Wiederholen'],
  ['Entf / Rücktaste', 'Auswahl löschen'],
  ['Esc', 'Aktion abbrechen / Auswahl aufheben / Hilfe schließen'],
  ['Enter', 'Polygon abschließen'],
  ['F', 'Ganze Karte zeigen'],
  ['G', 'Raster ein/aus'],
  ['Strg/⌘ + S', 'Speichern (.rtsmap herunterladen)'],
  ['Strg/⌘ + O', 'Datei öffnen'],
  ['?', 'Diese Hilfe ein/aus'],
];

export const HELP_MOUSE: readonly (readonly [string, string])[] = [
  ['Linksklick', 'Werkzeug anwenden (Auswahl, Setzen, Löschen)'],
  ['Umschalt + Klick', 'Auswahl ergänzen'],
  ['Linksziehen auf Marker', 'Verschieben (ein Undo-Schritt); Eck- und Radiusgriffe ändern die Form'],
  ['Doppelklick auf Feldkante', 'Eckpunkt einfügen'],
  ['Linksziehen ins Leere', 'Kamera schwenken (Auswahlwerkzeug)'],
  ['Rechts-/Mittelziehen', 'Kamera drehen / schwenken'],
  ['Mausrad', 'Zoomen'],
  ['Datei auf das Fenster ziehen', '.rtsmap öffnen'],
];

/** Error texts of the input parsers (format.ts). */
export const E = {
  empty: 'Bitte einen Wert eingeben',
  notNumber: 'Keine gültige Zahl',
  notInteger: 'Nur ganze Zahlen',
  range: (lo: string, hi: string): string => `Erlaubt: ${lo} … ${hi}`,
  decimals: (n: number): string => `Höchstens ${n} Nachkommastelle${n === 1 ? '' : 'n'}`,
  scaleOrder: 'Minimum darf nicht größer als das Maximum sein',
  nameLength: (max: number): string => `1 … ${max} Bytes (UTF-8)`,
  nameControl: 'Keine Steuerzeichen erlaubt',
  entriesCount: (max: number): string => `1 … ${max} Einträge`,
  entryId: (id: string): string => `„${id}“ ist keine gültige ID (namespace:name, Kleinbuchstaben)`,
  entryIdLength: (id: string, max: number): string => `„${id}“ ist länger als ${max} Bytes`,
  entryWeight: (token: string): string => `Gewicht in „${token}“ muss 1 … 65535 sein`,
  entryDuplicate: (id: string): string => `„${id}“ kommt doppelt vor`,
} as const;
