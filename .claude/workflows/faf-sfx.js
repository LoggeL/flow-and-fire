export const meta = {
  name: 'faf-sfx',
  description: 'Prozedurale Sound-Effekte für Flow & Fire: Synth-Werkzeug, SFX-Bibliothek in Gruppen parallel, objektive Audio-Prüfung, Commit',
  phases: [
    { title: 'Fundament', detail: 'Offline-Synth (Node-DSP) + Liste + Vorschau' },
    { title: 'Sounds', detail: 'Sound-Gruppen parallel' },
    { title: 'Prüfung', detail: 'Lautheit/Clipping/Unterscheidbarkeit, nachbessern' },
    { title: 'Abschluss', detail: 'Commit' },
  ],
}
const REPO = '/Users/logge/Documents/Projects/flow-and-fire-audio'
const HEAVY = '/Users/logge/Documents/Projects/flow-and-fire/tools/heavy'
const COMMON = `Projekt: Flow & Fire (FAF), Browser-RTS nach Vorbild Supreme Commander: Forged Alliance. Arbeitsordner (Git-Worktree, Branch audio): ${REPO} — NUR dort arbeiten. Kontext: docs/PLAN.md §3.7 (Audio: Voice-Manager 32 Stimmen, Kategorien, Alerts), MS5 (P7 ~15 SFX), MS9 (P8 Alerts), MS14 (60–100 SFX), docs/design/faction.md (Audio-Charakter der Fraktion Varkan: gegossenes Eisen, Glut, Industrie) und docs/design/roster.json (Waffentypen, Einheitenklassen). Weitere Fraktionen folgen später — Struktur fraktionsfähig anlegen (content/audio/<fraktion>/ + content/audio/common/).
Alles PROZEDURAL/SELBST SYNTHETISIERT — keine heruntergeladenen Samples, keine fremden Sounds (Lizenz). ffmpeg (mit libopus) ist unter /opt/homebrew/bin/ffmpeg vorhanden. Schwere Befehle über ${HEAVY}. Keine Änderungen an packages/render|sim|client (Integration später in MS5). Kein git commit außer im Abschluss. Keine Rückfragen.`

phase('Fundament')
await agent(`${COMMON}

Baue tools/sfx (@faf/sfx, Node/TS, deterministisch mit Seed): DSP-Bausteine (Oszillatoren inkl. FM, Rauschen weiß/rosa/braun, Biquad-Filter mit Hüllkurven, ADSR/Multi-Segment-Envelopes, Pitch-Sweeps, Distortion/Waveshaper, Bitcrush, Comb/Delay, algorithmischer Reverb oder Faltung mit generiertem IR, Layering, Stereo-Pan/Breite, Normalisierung auf Ziel-LUFS, Fade), Sound-Definitionen als TS-Dateien content/audio/<scope>/<name>.sfx.ts (defineSfx({id, category, variants: n, loop?, ...})), CLI 'pnpm sfx' → WAV 48 kHz + Opus/WebM (ffmpeg) in content/audio/dist/ + manifest.json (id, Kategorie, Dauer, Loop-Punkte, Varianten, Prio, Cooldown-Vorschlag, Ziel-Lautheit).
Analyse-Tool: pro Datei Peak, RMS, integrierte Lautheit (LUFS nach BS.1770, K-Gewichtung), Clipping-Check, Spektral-Schwerpunkt, Dauer; Spektrogramm als PNG nach /private/tmp/claude-501/faf-sfx/ (zum Ansehen mit Read). Vorschauseite (statisches HTML, z.B. tools/sfx/preview) mit Liste, Play-Buttons, Kategorien-Filter.
Lege außerdem content/audio/SOUNDLIST.md an: vollständige Liste der MVP-Sounds nach Kategorien (Waffen je Waffentyp aus roster.json, Einschläge, Explosionen klein/mittel/groß/Kommandant, Bau/Nano-Strahl-Loop, Bau fertig, Reclaim, Fabrik-Roll-off, Bewegung (Ketten-Loop, Bot-Schritte, Hover, Flugzeug-Triebwerke), Schilde (Treffer, Kollaps, Aufbau), Radar-Ping, UI (Klick, Bestätigung/Ack je Einheitenklasse, Fehler, Auswahl, Bau platziert, Queue), Alerts (Einheit angegriffen, Basis angegriffen, Stall Masse/Energie, Kommandant in Gefahr, Bau fertig, Feind-Kommandant gesichtet… als synthetische Signaltöne), Musik-Stinger (Sieg/Niederlage), Ambience). Mit Zielwerten (LUFS je Kategorie, max. Dauer, Varianten).
Ein Referenz-Sound (Varkan T1-Kanone „Punze“-Schuss) als Beispiel. Selbsttest + Bericht.`, { label: 'fundament', phase: 'Fundament' })

const GROUPS = [
  { key: 'weapons', text: 'Waffen (alle Waffentypen aus roster.json: Kanonen, Artillerie-Abschuss, Raketen, Flak, Laser/Strahl, Bomben-Abwurf, Kommandanten-Waffe, Overcharge/Abstich)' },
  { key: 'impacts', text: 'Einschläge und Explosionen (klein/mittel/groß, Gebäude-Einsturz, Wrack, Flugzeug-Absturz, Kommandanten-Explosion mit Tiefbass, Schild-Treffer/Kollaps/Aufbau)' },
  { key: 'eco-ui', text: 'Bau/Eco/UI: Nano-Bau-Loop, Bau fertig, Reclaim-Loop, Fabrik-Roll-off, Mex/Pgen-Ambience-Loops, Radar-Ping, alle UI-Sounds und Acks je Einheitenklasse' },
  { key: 'move-alerts', text: 'Bewegung (Ketten, Bots, Luft-Triebwerke als Loops) + Alerts (synthetische, gut unterscheidbare Signaltöne je Alert-Typ, Priorität) + Sieg/Niederlage-Stinger + Karten-Ambience' },
]
phase('Sounds')
const made = await parallel(GROUPS.map(g => () => agent(`${COMMON}

Deine Gruppe: ${g.text}. Lies tools/sfx/README (oder Doku), content/audio/SOUNDLIST.md und den Referenz-Sound. Erstelle alle Sounds deiner Gruppe gemäß SOUNDLIST (Dateien nur in deinem Bereich anlegen, z.B. content/audio/varkan/${g.key}/ bzw. content/audio/common/${g.key}/). Klanglich im Audio-Charakter der Fraktion, unterscheidbar innerhalb der Kategorie, mit 2–4 Varianten wo sinnvoll (Wiederholungen im RTS!). Rendere nur deine Sounds, prüfe mit dem Analyse-Tool (Lautheit im Ziel, kein Clipping, Dauer) und sieh dir Spektrogramme an. Bericht: Liste mit Dauer/LUFS.`, { label: `sfx:${g.key}`, phase: 'Sounds' })))

phase('Prüfung')
const check = await agent(`${COMMON}

Gesamtprüfung: 'pnpm sfx' komplett (über ${HEAVY}), Analyse über alle Dateien: Lautheit je Kategorie im Ziel ±1,5 LU, kein Clipping (True Peak ≤ −1 dBTP), Loops nahtlos (Übergang prüfen), Varianten wirklich verschieden, Kategorien spektral unterscheidbar (Alerts dürfen nicht mit Waffen verwechselbar sein), Gesamtgröße der Opus-Dateien (Ziel ≤ 3 MB für MVP). SOUNDLIST vollständig abgedeckt? Behebe alles direkt. Bericht.`, { label: 'pruefung', phase: 'Prüfung' })

phase('Abschluss')
const fin = await agent(`${COMMON}

Abschluss: typecheck/lint/Tests von tools/sfx (über ${HEAVY}), docs/design/audio.md (Synth, Konventionen, Kategorien/Lautheitsziele, Stand, Integrationsplan MS5/MS9/MS14, wie man neue Sounds/Fraktionen ergänzt), README-Abschnitt „Sounds anhören“. Entscheide, ob dist-Dateien eingecheckt werden (klein → ja, sonst per Build erzeugen) und dokumentiere es. git add -A && git commit -m "feat(audio): prozedurale SFX-Bibliothek und Synth-Werkzeug" mit Leerzeile + "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Kein push. Bericht (deutsch, ≤ 12 Zeilen): Anzahl Sounds je Kategorie, Größe, wie anhören, offene Punkte.

Prüfbericht:\n${check}`, { label: 'abschluss', phase: 'Abschluss' })
return fin
