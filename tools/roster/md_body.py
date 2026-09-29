L = []
A = L.append
UID = {u['id']: u for u in U}
def nm(i): return UID[i]['name']['de']

A('# Roster: Varkan-Kompakt (MVP)')
A('')
A('> **Status:** Startwerte für alle MVP-Blueprints (U3) auf Basis von `docs/design/faction.md`, überarbeitet nach Balance- und Lesbarkeits-Review (§17). Maschinenlesbar in `docs/design/roster.json` (Schema `faf-roster/1`). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts**; dieses Dokument und `faction.md` §7.4 sind daraus abgeleitet. Später Grundlage der Blueprints (`content/blueprints/core/…`).')
c = D['counts']
A(f"> **Umfang:** **{c['total']} Blueprints** ({c['mobile']} mobil, {c['structures']} Gebäude, jede Upgrade-Stufe einzeln), davon **{c['ms9Core']} im MS9-Kern (●)**, Rest bis MS14 (○). Zielbänder PLAN: MS9 25–30, MS14 45–55. {c['visuals']} Visuals (ein Superset-Mesh pro Rolle, Tech per Kitbash), {c['iconGlyphs']} Icon-Glyphen. Waffen-, Projektil- und Basis-BPs (`core:base_*`) sind nicht mitgezählt.")
A('> **Ausgeschlossen (Post-MVP laut features.json):** TML/TMD, Nukes/SMD, Transporter (U13), T3-Luft (U12), Marine und Torpedobomber (U17/U18), Experimentals, Mass Fabricator (E15), SACU (U15), ACU-Enhancements (U14), Stealth/Omni (I4/I5, damit auch der Stealth-Teil von U6). Kein T3-Panzer (Reservename *Amboss*).')
A('> **Balancing:** Hartes Gate PLAN U3: DPS/Mass und HP/Mass je ±25 % der FA-Referenz. Der Generator erzwingt strenger: Einzelachsen, **Produkt** (DPS/Mass × HP/Mass) und **Pulk-DPS/Mass** der Artillerie je ±15 %, dazu eine **Treffer-bis-Tod-Matrix**, die exakt der FA-Referenz entspricht (§14). Die Zahlen sind Startwerte für das Balancing in MS8/MS9, keine Endwerte.')
A('')
A('---')
A('')
A('## 1. Quellen und Methodik')
A('')
A('- **FA-Daten:** [FAForever/spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json` (Datenstand „3810“, 503 Blueprints), abgerufen 2026-09-29. DPS nach der dortigen Formel `app/js/dps.js` (Nachladezeit auf 0,1-s-Ticks abgerundet, Salven über `MuzzleSalvoSize`/Racks, DoT und Initialschaden addiert). Das Balance-Review hat alle 50 Referenzen (Kosten, HP, Waffen), die Adjacency-Tabelle und die Abstich-Konstanten gegen spooky-db 3810 und FAF `develop` bestätigt.')
A('- **Stichprobe gegen den aktuellen FAF-Stand** ([FAForever/fa](https://github.com/FAForever/fa) `develop`, `units/*/…_unit.bp`): T1-Panzer, LAB und ACU sind identisch; T2-Flak, T2-PD und der FAF-T2-Gatling-Bot haben seither leicht geänderte Feuerraten. Vor dem MS9-Balancing einmal gegen den dann aktuellen FAF-Stand nachziehen (§18).')
A('- **Adjacency:** Werte aus `lua/sim/AdjacencyBuffs.lua` (FAF `develop`), ACU-Lotbruch und Abstich-Formel aus `units/UEL0001/UEL0001_unit.bp` bzw. `lua/sim/projectiles/OverchargeProjectile.lua`.')
A('- **Referenzwahl:** primär die UEF-Einheit der Rolle (Allrounder wie unsere Fraktion), Cybran als Gegenprobe (`crossCheckBp` im JSON). Fehlt eine UEF-Rolle (Sniper), wird eine andere FA-Fraktion genommen. **Nur Blueprint-IDs und generische Rollenbezeichnungen werden zitiert, keine FA-Eigennamen.** Das Feld `faReference` ist **dev-only** (`devOnly: true`): Der Blueprint-Build entfernt es per Lint, es landet nie in `view.json` oder i18n.')
A('- **Einheiten:** 1 WU = 1 FA-Ogrid (20-km-Karte = 1.024 WU, DECISIONS „Setons“). Reichweite in WU, Tempo in WU/s, Drehrate in °/s. `buildTime` in FA-Semantik: Sekunden = buildTime / Build Power des Erbauers; Upgrade-Dauer = buildTime der Zielstufe / `buildPower` der Vorstufe. Bei Upgrade-Stufen sind Kosten Upgrade-Kosten.')
A('- **Waffen:** `reloadS` ist ein Vielfaches von 0,1 s (10-Hz-Sim). DPS = Schaden × Salve / Nachladezeit. Bomber-DPS = Salve pro Anflug / Nachladezeit (theoretisch). Abstich (Overcharge) geht nicht in die DPS/Mass ein.')
A('- **Abweichung:** Δ = (unser Wert / FA-Wert − 1) × 100. Bei Schild-Einheiten wird HP + Schild-HP verglichen (Mobiler Schild, Schildgeneratoren, T3-Belagerungsläufer gegen eine FA-Referenz mit Personal-Schild).')
A('- **Produkt:** Δ Produkt = (DPS/Mass ÷ FA) × (HP/Mass ÷ FA) − 1. Es bestimmt die Stärke im direkten Gefecht und fängt Verschiebungen ab, die auf beiden Einzelachsen knapp im Band liegen.')
A('- **Pulk-DPS/Mass (Artillerie):** Schaden × Salve × Ziele / Nachladezeit / Mass mit Ziele = π · (Splash + 0,5)² / 4. Rechenannahme: ein Ziel pro 4 WU² (2 WU Abstand), Zielradius 0,5 WU. Gilt für alle Einträge mit Kategorie `ARTILLERY`.')
A('- **Treffer bis Tod:** Salven bis zum Tod = ⌈Ziel-HP / Salvenschaden⌉. Die Pflichtpaare in `checks.hitsToKill` müssen exakt der FA-Referenz entsprechen (FA-Salve aus spooky-DPS × Nachladezeit).')
A('- **Kitbash:** Parts aus dem Katalog `faction.md` §3.3; ⟳ = animierter Part (≤ 2), `[mat]` = Material-Slot (`team`, `glow`, `copper`, `ceramic`, sonst `body`). Tris-Schätzung aus den Katalogwerten, `legs` mit ≈ 60 angesetzt. Budget: mobil ≤ 7 Parts, Strukturen ≤ 9, ≤ 350 Tris; Superset pro Visual mobil ≤ 8 Parts (PartStream-Limit), Strukturen ≤ 9. Lints im Generator: Glut-Monopol (`stack`/`glow` nur bei ECONOMIC, FACTORY, ENGINEER), mindestens ein Team-Part pro Blueprint, `buildPower` bei upgradebaren Gebäuden, `regenStartS` bei Schilden.')
A('- **Maßstab (`kitbash.scale`):** mobil uniform T1 1,0 / T2 1,3 / T3 1,7, bei 1×1-Footprint höchstens 1,4. Strukturen: xz = Footprint-Kante / Footprint-Kante der niedrigsten Stufe des Visuals (Sockel füllt 100 % des Footprints), y = xz × Höhenfaktor (T1 1,0 / T2 1,2 / T3 1,4) relativ zur Basisstufe. In-Place-Upgrades wachsen also nur in der Höhe.')
A('- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein, in dem der Blueprint laut PLAN §5 gebraucht wird · RW = Reichweite · s = sizeClass · Sicht / R = Radar.')
A('')
A('---')
A('')
A('## 2. Zählung nach Meilenstein')
A('')
order = ['MS4', 'MS5', 'MS6', 'MS7', 'MS8', 'MS10', 'MS12', 'MS13', 'MS14']
A('| MS | neu gebraucht | Blueprints |')
A('|---|---|---|')
cum = 0
for m in order:
    us = [u for u in U if u['msFirst'] == m]
    cum += len(us)
    A(f"| {m} | {len(us)} (Σ {cum}) | " + ', '.join(f"{dot(u)} {u['name']['de']}" for u in us) + ' |')
A('')
A(f"**MS9-Kern ({c['ms9Core']}):** " + ', '.join(u['name']['de'] for u in U if u['ms9Core']) + '.')
A('')
A('- 23 davon folgen direkt aus PLAN MS4–MS8 (U1, U2, U4, U5, U6, B4, B5, E5, E6). Die übrigen drei sind **Daten-Vorgriffe** ohne neue Mechanik: Glutspeicher (ab MS6, weil der Abstich ≥ 7.500 E Vorrat braucht), Erzspeicher (Speicherlimit E4 existiert ab MS4) und Dampfquelle (Spot-Regel wie beim Mex). Die Abnahme von E9/E10/E11 bleibt in MS10.')
A('- **Hochrost (SAM)** gehört zum Kern, weil PLAN §5.3 B5 „MS8 (PD, Mauern, SAM)“ abnimmt. In MS8 wird er per Konsole/Test-Szenario gespawnt (Lenkflugkörper, K11); im Spiel baubar ist er erst mit dem Meister (MS13).')
A('')
A('### 2.1 Abgrenzungen und Abweichungen')
A('')
A('| Punkt | Festlegung | Grund |')
A('|---|---|---|')
A('| MS9-Kern ohne Luft und Radar | Lerche, Turmfalke, Dohle, Luftwerk I und Horcher I sind ○; dafür Glutkessel II, Riegel II, Rost II und Hochrost ● | Luft (U11, AirMovers) kommt erst in MS12, Radar (I3) in MS10. PD/AA/SAM fordert B5 in MS8, Pgen T2 die T2-Tech-Leiter (E6, KI bis T2 in MS9). |')
A('| Horcher III | `core:str_t3_radar` enthalten | PLAN §5.3: Rest I3 = T3-Radar in MS13 |')
A('| U6-Stealth | entfällt | I5 ist „Später“; U6 gilt mit der Schürze (mobiler Schild) als erfüllt. |')
A('| Glutkessel, Riegel, Rost | kein In-Place-Upgrade; T2/T3 werden neu gebaut | wie FA; generisches B8 ist Post-MVP. Upgrades nur bei Zapfstelle, Werken, Horcher, Schirm. |')
A('| `faction.md` §7.4 / §10.1 | an dieses Roster angeglichen (Review A3) | `roster.json` ist die einzige Quelle für Zahlen und ●/○. |')
A('')
A('---')
A('')
A('## 3. Hotbuild-Raster (QWERT / ASDFG / ZXCVB, ohne Rebinding)')
A('')
A('Gleiche Taste = gleiche Rolle über alle Tech-Stufen. Mehrfaches Drücken wechselt **nur die Tech-Stufe** (höchste baubare zuerst), nie den Typ. Upgrade-Stufen laufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die fünfte Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen.')
A('')
g = D['hotbuildGrid']
for menu in ('Landwerk', 'Luftwerk', 'Bau'):
    title = {'Landwerk': 'Landwerk (Fabrik-Menü)', 'Luftwerk': 'Luftwerk (Fabrik-Menü)', 'Bau': 'Bau-Menü (Vogt und Engineers)'}[menu]
    A(f'**{title}**')
    A('')
    A('| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |')
    A('|---|---|---|---|---|---|')
    rows = [('QWERT', 'Reihe 1'), ('ASDFG', 'Reihe 2'), ('ZXCVB', 'Reihe 3')]
    for keys, lab in rows:
        cells = [f"**{k}** {g[menu][k]}" if k in g[menu] else '–' for k in keys]
        if all(x == '–' for x in cells): continue
        A(f'| {lab} | ' + ' | '.join(cells) + ' |')
    A('')

GROUPS = [('cmd', '4. Kommandant und Engineers'), ('land1', '5. Landarmee T1'), ('land2', '6. Landarmee T2'),
          ('land3', '7. Landarmee T3'), ('air', '8. Luftwaffe T1–T2'), ('eco', '9. Wirtschaft'), ('fac', '10. Fabriken'),
          ('def', '11. Verteidigung'), ('intel', '12. Intel und Schilde'), ('arty', '13. Artilleriestellungen')]

def grp(u):
    if u['group'] == 'land': return f"land{u['tech']}"
    return u['group']

for key, title in GROUPS:
    us = [u for u in U if grp(u) == key]
    A('---')
    A('')
    A(f'## {title}')
    A('')
    A('**Stammdaten**')
    A('')
    A('| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |')
    A('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for u in us:
        e = u['economy']; f = u['faReference']
        ref = f"{f['role']} (`{f['bp']}`" + (f", Gegenprobe `{f['crossCheckBp']}`" if f.get('crossCheckBp') else '') + ')'
        A(f"| {dot(u)} | `{u['id']}` | **{u['name']['de']}** / {u['name']['en']} | {u['role']['de']} / {u['role']['en']} | {ref} | {u['msFirst']} | "
          f"{n(e['mass'])} / {n(e['energy'])} / {n(e['buildTime'])} | {n(u['health']['max'])} | {mv(u)} | {fp(u)} | {intel(u)} | {hk(u)} | `{u['icon']}` |")
    A('')
    A('**Waffen und Balance** (Δ gegenüber FA-Referenz)')
    A('')
    A('| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |')
    A('|---|---|---|---|---|---|---|')
    for u in us:
        b = u['balance']; fa = b['fa']
        hpb = ' (inkl. Schild)' if b['hpBasis'] != 'HP' else ''
        pk = f"<br>Pulk-DPS/Mass {n(b['pulk']['pulkDpsPerMass'],3)} (FA {n(b['pulk']['faPulkDpsPerMass'],3)}): {pct(b['pulk']['devPct'])}" if b.get('pulk') else ''
        A(f"| `{u['id'].split(':')[1]}` | {weapons(u)}{pk} | {n(b['dpsPerMass'],3)} ({n(fa['dpsPerMass'],3)}) | {pct(b['devDpsPerMassPct'])} | "
          f"{n(b['hpPerMass'],3)} ({n(fa['hpPerMass'],3)}){hpb} | {pct(b['devHpPerMassPct'])} | {pct(b['devProductPct'])} |")
    A('')
    A('**Kategorien, Besonderheiten, Kitbash**')
    A('')
    A('| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |')
    A('|---|---|---|---|---|')
    for u in us:
        bb = f"<br>*von:* `{u['buildableBy'].replace('|', chr(92)+'|')}`" if u['buildableBy'] else ''
        A(f"| `{u['id'].split(':')[1]}` | {' '.join(u['categories'])}{bb} | {special(u)} | {u['kitbash']['description']}<br>{parts(u)} | {u['msNote']} |")
    A('')

# ---------------------------------------------------------------- 14 Balance
A('---')
A('')
A('## 14. Balance-Übersicht und Gates')
A('')
devs_d = [(u['balance']['devDpsPerMassPct'], u['name']['de']) for u in U if u['balance']['devDpsPerMassPct'] is not None]
devs_h = [(u['balance']['devHpPerMassPct'], u['name']['de']) for u in U]
devs_p = [(u['balance']['devProductPct'], u['name']['de']) for u in U if u['balance']['devProductPct'] is not None]
mx = lambda xs: max(xs, key=lambda x: abs(x[0]))
avg = lambda xs: round(sum(d for d, _ in xs) / len(xs), 1)
A(f"- **DPS/Mass:** {len(devs_d)} bewaffnete Einträge, größte Abweichung {pct(mx(devs_d)[0])} ({mx(devs_d)[1]}), Mittelwert {pct(avg(devs_d))}.")
A(f"- **HP/Mass:** {len(devs_h)} Einträge, größte Abweichung {pct(mx(devs_h)[0])} ({mx(devs_h)[1]}), Mittelwert {pct(avg(devs_h))}.")
A(f"- **Produkt DPS/Mass × HP/Mass:** größte Abweichung {pct(mx(devs_p)[0])} ({mx(devs_p)[1]}), Mittelwert {pct(avg(devs_p))}. Gate ±15 %.")
A(f"- **Bewusste globale Verschiebung:** HP/Mass liegt im Mittel bei {pct(avg(devs_h))}, DPS/Mass bei {pct(avg(devs_d))}. Jede Tötungszeit verlängert sich dadurch im Mittel um ≈ {n(round((1 + avg(devs_h)/100) / (1 + avg(devs_d)/100) * 100 - 100, 1), 1)} %. Das ist gewollt (etwas längere Gefechte, mehr Zeit zum Mikro) und bleibt klein genug, dass die Rolle-gegen-Rolle-Relationen und Breakpoints (Tabelle unten) unverändert bleiben.")
A('- **Fraktions-Signatur (bewusst, klein):** Stellungen etwas zäher (Riegel, Mauer, Radar +8–11 % HP/Mass), T2-Panzer und -Flak leicht zäher bei gleicher Feuerkraft, Artillerie mit etwas größerem Splash bei langsamerem Takt (Kelle 1,1 statt 1 bei 9,0 statt 8,3 s; Pfanne 4,4 statt 4). Die Breakpoints der T1-Linie (Vogt, Riegel I, Meißel gegen Punze und Stichel) sind exakt FA.')
A('- **Maßstabs-Sonderfall Hochofen:** FA-Reichweite 825 WU ist auf 256–512-WU-Karten nicht spielbar. Reichweite 200, gleicher Einzelschuss wie FA (5.500, Splash 6) für den Schild-Burst, Feuerrate ×⅔, Kosten ≈ 67 %; DPS/Mass und HP/Mass ±0. Das Compiler-Gate (≤ 40 % der kleinsten Kartendiagonale) verlangt Karten ≥ 354 WU (§18).')
A('- **Relationen, die das Balancing im Blick behalten muss:** LAB-DPS/Mass ≈ 1,75× Panzer (Raider), Flak ≈ 3× T2-Panzer DPS/Mass gegen Luft, Radar extrem fragil (FA 10 HP), Mauer 183 HP/Mass.')
A('')
A('**Pulk-DPS/Mass (Artillerie, Gate ±15 %)**')
A('')
A('| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |')
A('|---|---|---|---|---|---|')
for u in U:
    p = u['balance'].get('pulk')
    if not p: continue
    w = u['weapons'][0]
    A(f"| {u['name']['de']} | {(str(w['salvo'])+'×') if w['salvo']>1 else ''}{n(w['damage'])} / {n(w['reloadS'],1)} s | {n(p['splash'],1)} ({n(p['faSplash'],1)}) | {n(p['pulkDpsPerMass'],3)} ({n(p['faPulkDpsPerMass'],3)}) | {pct(p['devPct'])} | {pct(u['balance']['devDpsPerMassPct'])} |")
A('')
A('**Treffer-bis-Tod-Matrix (Pflicht: exakt FA)**')
A('')
A('| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |')
A('|---|---|---|---|---|---|')
for h in D['checks']['hitsToKill']:
    f = h['fa']
    A(f"| {nm(h['attacker'])} → {nm(h['target'])} | {n(h['salvoDamage'])} / {n(h['targetHp'])} | {h['hits']} ({n(h['ttkS'],1)} s) | {n(f['salvoDamage'])} / {n(f['targetHp'])} | {f['hits']} ({n(f['ttkS'],1)} s) | {'✓' if h['match'] else '✗'} |")
A('')
A('Rush-Simulation (Review-Skript, Panzer gegen Vogt, Regen 10 HP/s): FA braucht 19 T1-Panzer ohne und 22 mit Overcharge (13,9k E Start, +120 E/s); das Roster jetzt ebenfalls 19 / 22 (vorher 16 / 19).')
A('')
A('**Schildbrechen (Info, ein einzelner Schütze, mit Regenerations-Verzögerung `regenStartS`)**')
A('')
A('| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild-HP |')
A('|---|---|---|')
for s in D['checks']['shieldBreak']:
    ours = f"{s['shots']} ({n(s['timeS'],1)} s)" if s['shots'] else 'bricht allein nicht'
    theirs = f"{s['faShots']} ({n(s['faTimeS'],1)} s)" if s['faShots'] else 'bricht allein nicht'
    A(f"| {nm(s['attacker'])} → {nm(s['target'])} | {ours} | {theirs} |")
A('')

# ---------------------------------------------------------------- 15 Eco
A('---')
A('')
A('## 15. Ökonomie-Kennzahlen (Kurzreferenz)')
A('')
A('Beim Mex-Upgrade ersetzt die neue Stufe die alte Produktion. Amortisation = Upgrade-Mass / Mehrproduktion; die zweite Zahl rechnet den Energy-Mehrbedarf als anteiligen Glutkessel I ein (20 E/s ≙ 75 Mass).')
A('')
A('| Gebäude | Ertrag | Unterhalt | Amortisation (Mass) | inkl. E-Mehrbedarf | Upgrade zur nächsten Stufe | Adjacency (FA-Relation) |')
A('|---|---|---|---|---|---|---|')
for i in ('core:str_t1_mex', 'core:str_t2_mex', 'core:str_t3_mex', 'core:str_t1_pgen', 'core:str_t2_pgen', 'core:str_t3_pgen', 'core:str_t1_hydro', 'core:str_t1_mstore', 'core:str_t1_estore'):
    u = UID[i]; e = u['economy']
    ert = []
    if e.get('massPerSec'): ert.append(f"{n(e['massPerSec'])} M/s")
    if e.get('energyPerSec'): ert.append(f"{n(e['energyPerSec'])} E/s")
    if e.get('storageMass'): ert.append(f"+{n(e['storageMass'])} M Speicher")
    if e.get('storageEnergy'): ert.append(f"+{n(e['storageEnergy'])} E Speicher")
    amort = amort2 = '–'
    if e.get('massPerSec'):
        prev = UID[u['special']['upgradeFrom']]['economy'] if u['special']['upgradeFrom'] else {}
        dm = e['massPerSec'] - prev.get('massPerSec', 0)
        de = e.get('upkeepEnergyPerSec', 0) - prev.get('upkeepEnergyPerSec', 0)
        amort = f"{n(e['mass'] / dm, 0)} s" + (f" (Δ {n(dm)} M/s)" if prev else '')
        amort2 = f"≈ {n((e['mass'] + de / 20 * 75) / dm, 0)} s (+{n(de)} E/s)"
    upg = '–'
    if u['special']['upgradesTo']:
        t = UID[u['special']['upgradesTo']]
        upg = f"{t['name']['de']}: {n(t['economy']['buildTime'])} / BP {n(e['buildPower'])} = {n(t['economy']['buildTime'] / e['buildPower'], 0)} s"
    A(f"| {u['name']['de']} | {', '.join(ert)} | {('−'+n(e['upkeepEnergyPerSec'])+' E/s') if e.get('upkeepEnergyPerSec') else '–'} | {amort} | {amort2} | {upg} | {u['special']['adjacency'] or '–'} |")
A('')
A('Weitere Upgrade-Dauern (buildTime der Zielstufe / buildPower der Vorstufe): ' + '; '.join(
    f"{u['name']['de']} → {UID[u['special']['upgradesTo']]['name']['de']} {n(UID[u['special']['upgradesTo']]['economy']['buildTime'] / u['economy']['buildPower'], 0)} s"
    for u in U if u['special']['upgradesTo'] and 'STRUCTURE' in u['categories'] and u['id'] not in ('core:str_t1_mex', 'core:str_t2_mex')) + '.')
A('')
A('Vogt: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10. Adjacency-Größenklassen nach FA: 2×2 = SIZE4, 6×6 = SIZE12, 8×8 = SIZE16; der Bonus hängt von der Größe des *empfangenden* Gebäudes ab (Glutspeicher: 0,25 / 0,125 / 0,0833 / 0,0625 / 0,05 für SIZE4/8/12/16/20).')
A('')

# ---------------------------------------------------------------- 16 Silhouetten / Visuals / Glyphen
A('---')
A('')
A('## 16. Silhouetten-Pflichtpaare, Visuals, Glyphen')
A('')
sp = D['silhouettePairs']
A('**Pflichtpaare MS9 (nur ●, 5 von 5 Testern müssen unterscheiden):** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['ms9']) + '.')
A('')
A('**Pflichtpaare MS14:** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['ms14']) + '.')
A('')
A('**Visuals:** Ein Visual ist ein Superset-Mesh pro Rolle. Jeder Vertex trägt eine Tech-Bitmaske (T1/T2/T3); der Vertex-Shader kollabiert Parts, die für die Tech der Instanz nicht gelten. So bleibt es bei einem Draw pro (Visual, LOD), ohne PartStream-Slots für ausgeblendete Parts. Vereinigung nach (Part, Material):')
A('')
A('| Visual | Mitglieder | Superset-Parts | ≈ Tris |')
A('|---|---|---|---|')
for vid, v in D['visuals'].items():
    A(f"| `{vid}` | {', '.join(nm(i) for i in v['members'])} | {v['supersetParts']} | {v['trisEstimate']} |")
A('')
A(f"**Icon-Glyphen ({len(D['iconGlyphs'])} Tokens):** " + ', '.join(f"`{x}`" for x in D['iconGlyphs']) + '. Vogt (`cmd_commander`) und Mauer (`wall`) haben keine Glyphe. Formen und Maße: `faction.md` §6.')
A('')
