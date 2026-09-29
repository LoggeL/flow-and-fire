export const meta = {
  name: 'faf-unit-models',
  description: 'Einheiten/Gebäude als Kitbash-Low-Poly-Modelle + Strategic Icons designen (Modell-Kit, Viewer, Modelle je Fraktion parallel, visuelles Review)',
  phases: [
    { title: 'Fundament', detail: 'Modell-Kit (DSL→glTF), Viewer, Screenshot-Tool' },
    { title: 'Modelle', detail: 'Rollen-Gruppen parallel je Fraktion + Icons' },
    { title: 'Review', detail: 'Kontaktabzug prüfen, nachbessern' },
    { title: 'Abschluss', detail: 'Verify + Commit' },
  ],
}
const REPO = args.repo
const FACTIONS = args.factions   // [{slug, dir}]
const HEAVY = '/Users/logge/Documents/Projects/flow-and-fire/tools/heavy'
const COMMON = `Projekt: Flow & Fire (FAF), Browser-RTS nach Vorbild Supreme Commander: Forged Alliance, eigene Fraktionen. Arbeitsordner (Git-Worktree, Branch ${args.branch}): ${REPO} — NUR dort arbeiten. Kontext: docs/PLAN.md §3.7 (Rendering: Merged-Part-Mesh, jeder Vertex trägt partId, bis 8 Parts pro Unit mit eigenen Winkeln aus dem PartStream, Teamfarbe per Maske, LODs, Strategic Icons MSDF), §3.9 (Blueprint view: mesh, lod, placeholder, icon, iconThreshold), docs/STATUS.md, Fraktionsdesigns in docs/design/ (Varkan) bzw. docs/design/factions/<slug>/ (faction.md = Designsprache/Silhouetten-Regeln/Icon-Grammatik, roster.json = Einheitenliste inkl. Kitbash-Beschreibung, Footprint, Maßstab, Icon-Typ).
Regeln: Mac ohne Swap → schwere Befehle (pnpm build, pnpm test über mehrere Pakete, Playwright-Läufe über viele Modelle) über ${HEAVY} <befehl>. Port 5199 gehört dem Nutzer; eigene Server auf freien Ports und immer beenden. Keine Änderungen an packages/render, packages/sim, packages/client (dort arbeitet parallel MS3) — Integration ins Spiel passiert später im jeweiligen Meilenstein. Kein git commit außer im Abschluss-Schritt. Keine Rückfragen.`

phase('Fundament')
if (!args.skipFoundation) {
  await agent(`${COMMON}

Baue das Fundament für Einheiten-Modelle:
1. packages/modelkit (@faf/modelkit, reines TS, keine Abhängigkeit zu render/sim): Kitbash-DSL. Primitive: box, beveledBox, wedge, prism(n), cylinder, cone, frustum, sphere/icosphere, capsule, torus, tube; Transform (pos/rot/scale), Spiegelung (mirrorX), Wiederholung (array/radial), benannte Parts (hull, turret, barrel, legs_*, rotor, …) mit Pivot, max. 8 animierbare Parts; Material-Slots (base, dark, metal, team, glow, glass) → Vertexfarbe + Masken (Teamfarben-Maske, Glow-Maske); Flat-Shading-Normals; automatische LODs (LOD1/2: kleine Parts entfernen/vereinfachen, Zielbudgets je Klasse aus PLAN/roster); Export nach glTF 2.0 (via @gltf-transform/core, Attribute: POSITION, NORMAL, COLOR_0, _PARTID, _MASK) + Metadaten JSON (Bounding Box, Footprint-Check, Triangle-Count je LOD, Part-Pivots). Tests (Vitest): Geometrie-Validität, Dreiecksbudgets, deterministischer Export (gleicher Input → gleiche Bytes).
2. content/models/<fraktion>/<unit>.ts — ein Modell pro Datei, default export defineModel({...}); Registry + CLI 'pnpm models' (baut alle nach content/models/dist/*.glb + manifest.json).
3. apps/model-viewer (Vite, three.js erlaubt): Galerie aller Modelle je Fraktion (Raster mit Namen/ID/Tri-Count), Einzelansicht mit Drehteller, Teamfarbe umschaltbar (8 Farben), Distanz-Slider inkl. Umschaltung auf das Strategic Icon ab iconThreshold, Größenvergleich nebeneinander (Maßstab laut roster), Silhouetten-Modus (schwarz auf hell).
4. tools/model-shots: Playwright-Skript, das je Fraktion einen Kontaktabzug (alle Modelle, 3/4-Ansicht, Teamfarbe blau) und Einzelbilder nach /private/tmp/claude-501/faf-models/<fraktion>/ rendert, plus Silhouetten-Kontaktabzug.
5. content/icons: gemeinsame Strategic-Icon-Grammatik als SVG (Grundformen je Klasse aus faction.md: Land/Luft/Struktur/Engineer/Commander/…, Tech-Striche 1–3, Rollen-Symbole, Blip/Ghost-Varianten), Übersichtsseite im Viewer.
6. Ein Beispielmodell (Varkan-Kampfpanzer „Punze“ core:lnd_t1_tank) als Referenz für alle anderen Autoren, inkl. Screenshot.
Dokumentiere die DSL knapp in content/models/README.md (Konventionen: Einheit 1 = 1 WU, +Z vorne, Y oben, Pivots, Part-Namen, Budgets, Materialpalette je Fraktion). Selbsttest: typecheck, Tests, 'pnpm models', Screenshot-Skript einmal laufen lassen. Bericht.`, { label: 'fundament', phase: 'Fundament' })
}

const GROUPS = [
  { key: 'cmd-eco', text: 'Commander, Engineers (alle Tech-Stufen), Eco- und Fabrik-Strukturen (Mex, Pgen, Hydro, Storage, Fabriken Land/Luft T1–T3 inkl. Upgrade-Varianten)' },
  { key: 'land', text: 'alle mobilen Landeinheiten (T1–T3: Späher, Panzer/Bots, Artillerie, mobile AA, Raketenwerfer, mobile Schilde, schwere Einheiten)' },
  { key: 'air', text: 'alle Lufteinheiten (Späher, Abfangjäger, Bomber, Gunships, Transporter falls im Roster) — mit Rotor-/Triebwerks-Parts' },
  { key: 'def', text: 'Verteidigung und Support-Strukturen: Punktverteidigung, AA-Türme, SAM, Mauern, Radar T1–T3, Schildgeneratoren, stationäre Artillerie' },
]
const work = FACTIONS.flatMap(f => GROUPS.map(g => ({ f, g })))

phase('Modelle')
const made = await pipeline(
  work,
  w => agent(`${COMMON}

Fraktion ${w.f.slug} (Design: ${w.f.dir}/faction.md, Einheiten: ${w.f.dir}/roster.json). Deine Gruppe: ${w.g.text}.
Lies content/models/README.md und das Referenzmodell. Erstelle für JEDEN Roster-Eintrag deiner Gruppe ein Modell unter content/models/${w.f.slug}/<unit-id-ohne-präfix>.ts gemäß Kitbash-Beschreibung, Maßstab/Footprint und Silhouetten-Regeln der Fraktion. Tech-Varianten derselben Rolle teilen Grundform (wie im Roster beschrieben), unterscheiden sich lesbar (Größe, Zusatzteile, Tech-Merkmale). Drehbare Teile (Turm, Rohre, Beine, Rotoren) als benannte Parts mit Pivot. Budgets einhalten.
Andere Agenten arbeiten parallel an anderen Gruppen/Fraktionen: lege NUR Dateien deiner Einheiten an; die Registry wird automatisch aus den Dateien gebaut (falls nicht: nicht anfassen, sondern im Bericht melden).
Rendere Einzelbilder deiner Modelle mit tools/model-shots (nur deine Einheiten, falls Filter vorhanden) und sieh sie dir mit Read an; bessere nach, bis sie gut und im Fraktionsstil aussehen. Tests deiner Modelle (Budget/Validität) laufen lassen. Bericht: Liste der Modelle mit Tri-Count, Auffälligkeiten.`, { label: `modell:${w.f.slug}:${w.g.key}`, phase: 'Modelle' }),
)

phase('Review')
const reviews = await parallel(FACTIONS.map(f => () => agent(`${COMMON}

Visuelles Review der Fraktion ${f.slug}. Führe 'pnpm models' und tools/model-shots für diese Fraktion aus (über ${HEAVY}), sieh dir Kontaktabzug, Silhouetten-Kontaktabzug und Einzelbilder (Read) an. Prüfe gegen ${f.dir}/faction.md: Stil-Einheit, Silhouetten eindeutig je Rolle (Pflichtpaare aus faction.md!), Tech-Stufen lesbar, Teamfarbe sichtbar, Proportionen/Maßstab, Budgets. Behebe Mängel DIREKT in content/models/${f.slug}/. Wiederhole Rendern/Prüfen bis gut. Bericht: was geändert, verbleibende Schwächen, Pfad des finalen Kontaktabzugs.`, { label: `review:${f.slug}`, phase: 'Review' })))

phase('Abschluss')
const fin = await agent(`${COMMON}

Abschluss. Über ${HEAVY}: pnpm typecheck, pnpm lint, pnpm vitest run packages/modelkit content (bzw. passende Pfade), pnpm models, Viewer-Build. Fehler beheben. docs/design/models.md schreiben (Kit, Konventionen, Stand je Fraktion: Anzahl Modelle, Tri-Budgets, bekannte Schwächen, Integrationsplan: welcher Meilenstein nutzt welche Modelle, wie Blueprints view.mesh darauf zeigen). README-Abschnitt „Modelle ansehen“ (Viewer-Befehl). Dann git add -A && git commit -m "feat(models): Kitbash-Modellkit, Viewer und Modelle (${FACTIONS.map(f => f.slug).join(', ')})" mit Leerzeile + "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Kein push.
Berichte (deutsch, ≤ 15 Zeilen): Anzahl Modelle je Fraktion, Pfade der Kontaktabzüge, wie man den Viewer startet, offene Punkte.

Review-Berichte:\n${reviews.filter(Boolean).join('\n\n---\n\n')}`, { label: 'abschluss', phase: 'Abschluss' })
return fin
