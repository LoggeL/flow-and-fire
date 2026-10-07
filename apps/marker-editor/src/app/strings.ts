/**
 * German texts of the app controller and the file IO (status line, dialogs, the map label).
 * The panels (src/ui) keep their own strings; these are the messages the controller writes into
 * `store.status` and the texts of load/save errors.
 */
import type { FormatErrorCode } from '@faf/formats';

export const STRINGS = {
  loading: (name: string): string => `Lade ${name} …`,
  loaded: (name: string): string => `${name} geladen`,
  loadFailed: (name: string, reason: string): string => `Karte ${name} konnte nicht geladen werden: ${reason}`,
  fileReadFailed: (name: string, reason: string): string => `Datei ${name} konnte nicht gelesen werden: ${reason}`,
  notAMapFile: (name: string): string => `${name} ist keine .rtsmap-Datei`,
  saved: (file: string, bytes: number): string => `${file} gespeichert (${formatBytes(bytes)})`,
  saveFailed: (reason: string): string => `Speichern nicht möglich: ${reason}`,
  markersExported: 'markers.json exportiert',
  markersFailed: (reason: string): string => `markers.json-Export nicht möglich: ${reason}`,
  overlayExported: 'editor.json exportiert (nach content/maps/src/<karte>/ legen, dann pnpm maps)',
  overlayFailed: (reason: string): string => `editor.json-Export nicht möglich: ${reason}`,
  noDocument: 'Keine Karte geladen',
  discardChanges: (file: string): string => `Ungespeicherte Änderungen an ${file} verwerfen?`,
  beforeUnload: 'Ungespeicherte Änderungen gehen verloren.',
  offMap: 'Außerhalb der Karte',
  circleDragHint: 'Kreisfeld: vom Mittelpunkt aus ziehen, um den Radius festzulegen',
  polygonPoint: (n: number): string =>
    n < 3 ? `Polygon: ${n} Punkt(e) – mindestens 3, Doppelklick oder Enter schließt ab` : `Polygon: ${n} Punkte – Doppelklick, Enter oder Klick auf den ersten Punkt schließt ab, Esc bricht ab`,
  polygonTooFew: 'Polygon: mindestens 3 Punkte nötig',
  polygonMaxPoints: (max: number): string => `Polygon: höchstens ${max} Punkte`,
  polygonCancelled: 'Polygon verworfen',
  dragCancelled: 'Verschieben abgebrochen',
  vertexInserted: 'Eckpunkt eingefügt',
  gridOn: 'Raster an',
  gridOff: 'Raster aus',
  toolNames: {
    select: 'Auswahl',
    start: 'Startposition',
    mass: 'Mass-Spot',
    hydro: 'Hydro-Spot',
    fieldCircle: 'Kreisfeld',
    fieldPolygon: 'Polygonfeld',
    delete: 'Löschen',
  },
  mapLabel: (name: string, sizeWu: number, starts: number, spots: number, fields: number): string =>
    `${name} · ${sizeWu}×${sizeWu} WU · ${starts} Starts · ${spots} Spots · ${fields} Felder`,
  appTitle: 'Flow & Fire – Marker-Editor',
} as const;

/** German descriptions of the format error codes of @faf/formats. */
export const FORMAT_ERROR_TEXT: Readonly<Record<FormatErrorCode, string>> = {
  'bad-compression': 'komprimierte Dateidaten sind beschädigt',
  'too-large': 'Datei überschreitet die zulässige Größe',
  'unsupported-version': 'Dateiversion wird nicht unterstützt',
  truncated: 'Datei ist unvollständig (abgeschnitten)',
  'bad-magic': 'keine Flow-&-Fire-Kartendatei (falsche Signatur)',
  'bad-container-version': 'Container-Version wird nicht unterstützt',
  'bad-format-version': 'Kartenformat-Version wird nicht unterstützt',
  'bad-reserved': 'reservierte Felder sind belegt',
  'bad-chunk-id': 'ungültige Chunk-Kennung',
  'bad-length': 'ungültige Längenangabe',
  'bad-crc': 'Prüfsumme stimmt nicht (Datei beschädigt)',
  'bad-padding': 'ungültiges Padding',
  'trailing-bytes': 'überzählige Bytes am Dateiende',
  'missing-chunk': 'Pflicht-Chunk fehlt',
  'duplicate-chunk': 'Chunk doppelt vorhanden',
  'chunk-order': 'Chunks in falscher Reihenfolge',
  'bad-json': 'Metadaten (JSON) fehlerhaft',
  'non-canonical': 'Datei ist nicht kanonisch kodiert',
  'bad-value': 'ungültiger Wert',
};

/** "2,7 MB" / "812 kB" / "96 B". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} kB`;
  return `${n} B`;
}
