import json
from pathlib import Path
DOCS = Path(__file__).resolve().parents[2] / 'docs' / 'design'
D = json.load(open(DOCS / 'roster.json'))
U_ALL = D['units']
U = [u for u in U_ALL if u['tech'] != 4]   # MVP (§1–§18)
T4 = [u for u in U_ALL if u['tech'] == 4]  # Experimentals (§19, Post-MVP)

def n(x, d=None):
    if x is None: return '–'
    if isinstance(x, bool): return 'ja' if x else 'nein'
    if isinstance(x, (int,)) or (isinstance(x, float) and x.is_integer() and d is None):
        s = f'{int(x):,}'.replace(',', '.')
        return s
    if d is None: d = 2
    s = f'{x:.{d}f}'.rstrip('0').rstrip('.') if '.' in f'{x:.{d}f}' else f'{x:.{d}f}'
    return s.replace('.', ',')

def pct(x):
    if x is None: return '–'
    return ('+' if x > 0 else '±' if x == 0 else '−') + n(abs(x), 1) + ' %'

def dot(u): return '●' if u['ms9Core'] else '○'

def weapons(u):
    out = []
    for w in u['weapons']:
        sal = f"{w['salvo']}×" if w['salvo'] > 1 else ''
        rng = (n(w['rangeMin']) + '–' if w.get('rangeMin') else '') + n(w['range'])
        sp = f", Splash {n(w['splash'],1)}" if w.get('splash') else ''
        lay = ' [Luft]' if w['layers'] == ['air'] else ''
        out.append(f"`{w['ref'].split(':')[1]}` {w['type']}: {sal}{n(w['damage'])} / {n(w['reloadS'],1)} s = **{n(w['dps'],1)} DPS**, "
                   f"RW {rng}, {w['projectile']}{sp}{lay}")
    return '<br>'.join(out) if out else '–'

def parts(u):
    ps = []
    for p in u['kitbash']['parts']:
        s = p['part']
        if p.get('note'): s += f"({p['note'].replace('_', ' ')})"
        if p.get('anim'): s += f" ⟳{p['anim']}"
        if p.get('mat'): s += f" [{p['mat']}]"
        ps.append(s)
    k = u['kitbash']; sc = k['scale']
    msc = f"Maßstab {n(sc['xz'],2)}" if sc['xz'] == sc['y'] else f"Maßstab xz {n(sc['xz'],2)} / y {n(sc['y'],2)}"
    st = f"{k['techStripes']} Streifen ({'graphit' if k['techStripeMat'] == 'graphite' else 'keramik'})" if k['techStripes'] else 'keine Streifen'
    return f"{', '.join(ps)} — {k['partCount']} Parts, {k['animatedParts']} anim., ≈ {k['trisEstimate']} Tris · {msc} · {st}"

def special(u):
    s = u['special']; bits = []
    if s['upgradeFrom']: bits.append(f"Upgrade von `{s['upgradeFrom']}`")
    if s['upgradesTo']: bits.append(f"upgradesTo `{s['upgradesTo']}`")
    if s['toggles']: bits.append('Toggles: ' + ', '.join(s['toggles']))
    if s['adjacency']: bits.append('Adjacency: ' + s['adjacency'])
    dw = s['deathWeapon']
    if dw:
        if 'inner' in dw:
            bits.append(f"Death: `{dw['ref'].split(':')[1]}` {n(dw['inner']['damage'])}/r{n(dw['inner']['radius'])} + {n(dw['outer']['damage'])}/r{n(dw['outer']['radius'])} ({dw['note']})")
        else:
            bits.append(f"Death: `{dw['ref'].split(':')[1]}` {n(dw['damage'])}/r{n(dw['radius'],1)} ({dw['note']})")
    if u.get('shield'):
        sh = u['shield']
        bits.append(f"Schild {n(sh['hp'])} HP, r {n(sh['radius'])}, Regen {n(sh['regenPerSec'])}/s ab {n(sh['regenStartS'])} s nach dem letzten Treffer, Neuaufbau {n(sh['rechargeS'])} s" + (f" (danach {n(sh['rechargeFraction'] * 100)} %)" if sh.get('rechargeFraction') else '') + f", {n(sh['upkeepEnergyPerSec'])} E/s")
    e = u['economy']
    eco = []
    if e.get('buildPower'): eco.append(f"BP {n(e['buildPower'])}")
    if e.get('massPerSec'): eco.append(f"+{n(e['massPerSec'])} M/s")
    if e.get('energyPerSec'): eco.append(f"+{n(e['energyPerSec'])} E/s")
    if e.get('upkeepEnergyPerSec') and not u.get('shield'): eco.append(f"−{n(e['upkeepEnergyPerSec'])} E/s")
    if e.get('storageMass'): eco.append(f"Speicher {n(e['storageMass'])} M")
    if e.get('storageEnergy'): eco.append(f"Speicher {n(e['storageEnergy'])} E")
    if eco: bits.insert(0, ' · '.join(eco))
    if s['notes'] and s['notes'] != '—': bits.append(s['notes'])
    return '<br>'.join(bits)

def hk(u):
    h = u['hotbuild']
    return f"{h['menu']}: {h['slot']}" if h else '–'

def mv(u):
    m = u['motion']
    if m.get('structure'): return '–'
    return f"{n(m['speed'],2)} / {n(m['turnRateDeg'])}°"

def fp(u):
    m = u['motion']
    f = f"{m['footprint'][0]}×{m['footprint'][1]}"
    return f + (f" / s{m['sizeClass']}" if 'sizeClass' in m else '')

def intel(u):
    i = u['intel']
    s = n(i.get('vision'))
    if i.get('radar'): s += f" / R {n(i['radar'])}"
    return s

L = []
A = L.append
UID = {u['id']: u for u in U_ALL}
def nm(i): return UID[i]['name']['de']

A('# Roster: Varkan-Kompakt (MVP)')
A('')
A('> **Status:** Startwerte für alle MVP-Blueprints (U3) auf Basis von `docs/design/faction.md`, überarbeitet nach Balance- und Lesbarkeits-Review (§17). Maschinenlesbar in `docs/design/roster.json` (Schema `faf-roster/1`). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts**; dieses Dokument und `faction.md` §7.4 sind daraus abgeleitet. Später Grundlage der Blueprints (`content/blueprints/core/…`).')
c = D['counts']
A(f"> **Umfang:** **{c['mvp']} MVP-Blueprints** ({c['mobile']} mobil, {c['structures']} Gebäude, jede Upgrade-Stufe einzeln), davon **{c['ms9Core']} im MS9-Kern (●)**, Rest bis MS14 (○). Zielbänder PLAN: MS9 25–30, MS14 45–55. {c['visuals']} Visuals (ein Superset-Mesh pro Rolle, Tech per Kitbash), {c['iconGlyphs']} Icon-Glyphen. Waffen-, Projektil- und Basis-BPs (`core:base_*`) sind nicht mitgezählt. Dazu kommen **{c['experimental']['total']} Experimentals (T4, Post-MVP)** in §19, Design in [`experimentals.md`](experimentals.md).")
A('> **Ausgeschlossen (Post-MVP laut features.json):** TML/TMD, Nukes/SMD, Transporter (U13), T3-Luft (U12), Marine und Torpedobomber (U17/U18), Experimentals (nur als Post-MVP-Daten in §19), Mass Fabricator (E15), SACU (U15), ACU-Enhancements (U14), Stealth/Omni (I4/I5, damit auch der Stealth-Teil von U6). Kein T3-Panzer (Reservename *Amboss*).')
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
for menu in ('Landwerk', 'Luftwerk', 'Bau', 'Großguss'):
    title = {'Landwerk': 'Landwerk (Fabrik-Menü)', 'Luftwerk': 'Luftwerk (Fabrik-Menü)', 'Bau': 'Bau-Menü (Vogt und Engineers)', 'Großguss': 'Großguss (T4-Untermenü über Bau: G, nur Meister, Post-MVP)'}[menu]
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
    ours = f"{s['shots']} ({n(s['timeS'])} s)" if s['shots'] else 'bricht allein nicht'
    theirs = f"{s['faShots']} ({n(s['faTimeS'])} s)" if s['faShots'] else 'bricht allein nicht'
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
    if all(UID[i]['tech'] == 4 for i in v['members']): continue
    A(f"| `{vid}` | {', '.join(nm(i) for i in v['members'])} | {v['supersetParts']} | {v['trisEstimate']} |")
A('')
A(f"**Icon-Glyphen ({len(D['iconGlyphs'])} Tokens):** " + ', '.join(f"`{x}`" for x in D['iconGlyphs']) + '. Vogt (`cmd_commander`) und Mauer (`wall`) haben keine Glyphe. Formen und Maße: `faction.md` §6.')
A('')
# ---------------------------------------------------------------- 17 Review-Entscheidungen
A('---')
A('')
A('## 17. Review-Entscheidungen')
A('')
A('Zwei Reviews vom 2026-09-29: **Balance** (Breakpoints, Splash, Methodik) und **Lesbarkeit/Vollständigkeit** (Features, Silhouetten, Icons, Namen). ✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = verworfen.')
A('')
A('### 17.1 Balance-Review')
A('')
A('| Nr | Punkt | | Entscheidung und Begründung |')
A('|---|---|---|---|')
BAL = [
 ('1', 'Punze HP 330 reißt Breakpoints', '✓', 'Punze HP 300, Tempo 3,3, BT 300; Riegel I 50 / 0,3 s. Breakpoints wieder FA (3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven), Rush-Simulation nachgerechnet: 19 / 22 Panzer wie FA.'),
 ('2', 'Vogt HP 11.000', '✓', 'HP 12.000 (±0 %).'),
 ('3', 'Meißel 2×32 tötet keinen Stichel', '✓', '2×35 / 1,3 s: Stichel 1 Salve, Punze 5 Salven.'),
 ('4', 'Hochofen ohne Burst', '✓', '5.500 / 15 s, Splash 6, 48.000 M, 900.000 E, BT 76.700, HP 10.000; Schirm III fällt nach 5 Schüssen (60 s). Streichen verworfen: K13 (T2/T3-Artillerie) ist MVP, das Reichweiten-Gate bleibt offener Punkt §18.'),
 ('5', 'Schilde ohne Regenerations-Verzögerung', '✓', '`regenStartS` 3 / 3 / 1 für Schürze, Schirm II, Schirm III; Generator-Lint.'),
 ('6', 'Kelle Splash 1,5 + 110 Schaden', '◐', 'Mass 36, Energy 180, BT 200 übernommen. Statt 90 / 8,0 s / Splash 1,2 gilt **100 / 9,0 s / Splash 1,1**: 90 Schaden hätte den Breakpoint Kelle → Punze auf 4 statt 3 Treffer verschoben, und Splash 1,2 läge mit Pulk +20 % über dem neuen ±15-%-Gate. Ergebnis: Einzelziel −7,8 %, Pulk +4,9 %, Produkt −5,6 %.'),
 ('7', 'Pfanne und Tiegel: Splash-Inflation', '◐', 'Pfanne 700 / 10 s übernommen, **Splash 4,4 statt 4,5** (4,5 ergibt Pulk +15,2 % und reißt das Gate; 4,4 ergibt +10,7 %). Tiegel 2.100 / Splash 3 übernommen, **Nachladezeit 21 statt 22 s**: Mit `regenStartS` 3 regeneriert Schirm II bei 22 s 2.090 HP pro Zyklus, ein Tiegel käme netto nur 10 HP pro Schuss voran (FA 130); bei 21 s sind es 120. DPS/Mass +5,6 %, Produkt +11,4 %. Ein Schuss tötet Zapfstelle II und Riegel I, Glutkessel II braucht zwei.'),
 ('8', 'Rinne 2×280 gegen Riegel II', '✓', '2×300 / 10 s: 4 Salven wie FA. Zusätzlich **Splash 1,5 → 1,0**: Das neue Pulk-Gate zeigte +78 %.'),
 ('9', 'Eco-Tabelle falsch', '✓', '§15 rechnet mit der Mehrproduktion (225 s bzw. 375 s) und zeigt den Energy-Mehrbedarf separat (≈ 232 s bzw. ≈ 389 s).'),
 ('10', '`buildPower` bei Upgrade-Gebäuden', '✓', 'Zapfstelle I 10, Zapfstelle II 15, Horcher I 13, Horcher II 20, Schirm II 20; Generator-Lint. Upgrade-Dauern in §15.'),
 ('11', 'Luft gegen Flugabwehr', '✓', 'Turmfalke 2×25 / 1,0 s (Produkt −5,1 %), Krähe 16 / 0,3 s (Produkt +0,1 %), Rost I 2×20 / 0,6 s (Lerche 1 Salve), Hochrost 6×200 / 3,5 s (Krähe und Elster 1 Salve).'),
 ('12', 'Abstich-Formel unvollständig', '✓', 'FAF-Formel in der Waffennotiz des Vogts (Schaden = E/6, Drain = 6 × Schaden, clamp auf max. HP im Umkreis 2,7 WU, 1.250 … 15.000).'),
 ('13', 'Zange RW 26 = Riegel I', '✓', 'RW 30, HP 650 (Produkt +6,9 %).'),
 ('14', 'Horcher III 1.000 E/s', '◐', 'Unterhalt 400 E/s übernommen. Streichen verworfen: PLAN §5.3 verlangt das T3-Radar als Rest von I3 in MS13.'),
 ('15', 'Glutspeicher-Adjacency zu eng', '✓', 'Bufft alle Energieproduzenten: +25 % (SIZE4), +8,3 % (SIZE12: Glutkessel II, Dampfquelle), +6,25 % (SIZE16: Glutkessel III); Werte aus `AdjacencyBuffs.lua` bestätigt.'),
 ('D', 'Gate erweitern', '✓', 'Produkt-Gate ±15 %, Treffer-bis-Tod-Matrix (20 Paare, alle exakt FA), Pulk-DPS/Mass ±15 % für `ARTILLERY`, alles im Generator erzwungen; globale Verschiebung als Entscheidung in §14. Durch die neuen Gates zusätzlich geändert: **Sieb HP 300 → 310** (Vogt-Breakpoint 4 statt 3 Treffer wie FA) und **Riegel I HP 1.400 → 1.350** (Produkt +16,9 % → +12,7 %).'),
]
for r in BAL: A('| ' + ' | '.join(r) + ' |')
A('')
A('### 17.2 Lesbarkeits- und Vollständigkeits-Review')
A('')
A('| Nr | Punkt | | Entscheidung und Begründung |')
A('|---|---|---|---|')
LES = [
 ('A1', 'SAM für B5 erst ab MS13 baubar', '✓', 'Hochrost ist ● (Kern 26); `msNote`: in MS8 per Konsole/Test-Szenario gespawnt, baubar ab MS13.'),
 ('A2', 'U6-Stealth nicht dokumentiert', '✓', '§2.1 und `faction.md` §7.4: U6-Stealth entfällt (I5 = Später).'),
 ('A3', 'faction.md und roster.md widersprechen sich', '✓', '`faction.md` Kopfzeile, §7.4 und §10.1 angeglichen; `roster.json` ist die einzige Quelle (`sourceOfTruth`).'),
 ('A4', 'Visual-Zahl unklar', '◐', 'Superset-Mesh pro Rolle übernommen, aber mit **Tech-Bitmaske pro Vertex** statt Skalierung einzelner Parts pro Instanz (braucht keine PartStream-Slots). Generator prüft Superset ≤ 8 Parts mobil / ≤ 9 Strukturen und ≤ 350 Tris: 28 Visuals (Hochofen teilt jetzt `v_arty_struct`), größte: `v_fac_land` 9, `v_bot`/`v_tank`/`v_aa` 8. DECISIONS 17 (40 Visuals ⇒ 309 Draws) bleibt gültig.'),
 ('B1', 'Glut-Monopol durch `stack` verletzt', '✓', 'Stacks aus Fallhammer, Pfanne, Reißnadel, Hochrost, Horcher III, Schirm III und Hochofen entfernt, dazu der Heckschlot der Zapfstelle III; „Schlot am Heck“ aus `faction.md` §3.4 gestrichen. Lint: `stack`/`glow` nur bei ECONOMIC, FACTORY, ENGINEER.'),
 ('B2', 'Pflicht-Teamfarbe fehlt', '✓', 'Engineers: Kessel `team` (Bauchband), Kranarm `copper`; Funke: Wanne `team`; Rost I/II und Hochrost: `grate` `team`. Lint: ≥ 1 Team-Part pro Blueprint.'),
 ('B3', 'Mauer mit Tech-Streifen', '✓', '`techStripes` 0 (auch Vogt).'),
 ('B4', 'Engineer-Streifen unsichtbar', '✓', 'Graphit auf Keramik (`techStripeMat`); Streifenmaß 0,10 WU × Maßstab, Abstand 0,10 WU, hinteres Drittel.'),
 ('B5', 'Tech-Maßstab gegen Footprint', '◐', 'Upgrade-Strukturen: Sockel füllt den Footprint, nur die Höhe wächst (1,2 / 1,4). Neubauten mit Footprint-Sprung: xz = Footprint-Verhältnis (Glutkessel II 3,0, III 4,0, Riegel II 2,0, Hochofen 4,0). Mobil: Deckel 1,4 bei 1×1 übernommen (Meister, Reißnadel, Trommelsieb). **Verworfen:** die Regel „Modelllänge ≤ 1,25 × Footprint-Kante“ – schon die Punze (1,4 WU auf 1×1) verletzt sie; der Footprint ist eine Pathing-Zelle, auch FA-Modelle überragen ihn. Werte in `kitbash.scale`.'),
 ('B6', 'Mindestgröße gegen iconThreshold', '◐', 'Variante „iconThreshold mobil ≥ 25 px“ übernommen (12 % von 25 px = 3 px). Die konkreten Maße sind an die 12-%-Regel angepasst statt 0,12 WU (das wären bei 25 px nur 2,1 px): AA-Rohr Ø ≥ 0,17 WU, Raketenkasten-/Kellenrohr-Breite ≥ 0,34 WU, Kranarm ≥ 0,17 WU (Basis Punze 1,4 WU). PLAN §3.9 nennt im Beispiel `iconThreshold:14` – Anpassung ist offener Punkt §18.'),
 ('C1', 'Rinne ↔ Rüttelsieb', '✓', 'Rinne mit einem Raketenkasten 0,5 × 0,25 × 1,1 WU bei 50°, AA-Rohre ≥ 75° (Differenz ≥ 25°); Paar in der MS9-Pflichtliste.'),
 ('C2', 'Hochofen ↔ Glutkessel III', '✓', 'Hochofen = Tiegel-Silhouette (Sockel, Lafette, Kelle Ø 3,0, Steilrohr 7 × 0,6 WU, Gegengewicht, 5 Parts, kein Schlot). Artillerie hat damit zwei Signaturen: Kelle und Raketenkasten.'),
 ('C3', 'Glutspeicher ↔ Glutkessel I', '✓', 'Glutspeicher = zwei stehende, flache Trommeln; Glutkessel = liegender Kessel mit Schlot ≥ 1,5 × Kessel-Ø.'),
 ('C4', 'Zapfstelle III ↔ Dampfquelle', '✓', 'Gelöst durch B1 (kein Heckschlot) und B5 (Zapfstelle bleibt 2×2).'),
 ('C5', 'Horcher ↔ Schirm, Funke ↔ Schürze', '✓', 'Radar trägt eine rechteckige Platte (`wing`-Prisma 1,6 × 0,8 × 0,1 WU, 35°) statt eines Rings – kein neues Primitiv nötig. Schild-Ring Ø ≥ 0,8 × Footprint-Kante, Schürzen-Ring Ø ≥ 1,2 × Rumpfbreite, Funken-Mast ≥ 1,0 × Rumpflänge.'),
 ('C6', 'Turmfalke ↔ Elster, Lerche ↔ Dohle', '✓', 'Elster mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 %; Dohlen-Kessel ≥ 1,4 × Flügeltiefe. „Krähe ↔ Elster“ ersetzt durch „Turmfalke ↔ Elster“.'),
 ('C7', 'Pflichtpaare nur ●', '✓', '`silhouettePairs.ms9` (9 Paare, vom Generator auf ● geprüft) und `silhouettePairs.ms14` (7 Paare), §16.'),
 ('C8', 'Vogt-Größe', '✓', 'Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU.'),
 ('D1', 'Radar-Blip verrät Vogt', '✓', 'Blips nur Achteck (Land inkl. Engineer und Vogt), Dreieck (Luft), Sechseck (Gebäude), einheitlich 1,0×.'),
 ('D2', 'Achteck ↔ Kreis', '✓', 'Land = Quadrat mit Fase ≤ 4 DE, Engineer = Kreis Ø 28 DE.'),
 ('D3', 'Kerben unter 3 px', '◐', 'Mindeststrich 5 DE, Kerben 5 × 9 DE übernommen; Späher-Faktor **1,0 statt 0,8** (bei 0,8 hätten 5-DE-Striche nur 2,5 px). Mauer bleibt 0,6, sie hat weder Glyphe noch Kerben.'),
 ('D4', 'LAB und Panzer mit gleichem Icon', '✓', 'Glyphe `bot` (Punkt + 2 Beinstriche), `land_bot_t1..t3` für Stichel, Zange, Fallhammer.'),
 ('D5', 'Glyphen-Zahl', '✓', '19 Tokens (`iconGlyphs`), Tabelle mit IDs in `faction.md` §6.3; Jagdbomber als Sanduhr (^ über v, je 6 DE, 2 DE Abstand).'),
 ('D6', 'Hotbuild-Prinzip gebrochen', '◐', 'Reißnadel auf **F statt D** (D ist Schürze, sonst teilten sich wieder zwei Rollen eine Taste). S = Bots (Stichel → Zange → Fallhammer), Q = Panzer (Punze → Meißel). Bau-Menü: Glutspeicher auf **T statt F**; Schirm bleibt F, Tiegel/Hochofen V. Grund: 13 Rollen passen nicht auf 12 Tasten; der Vorschlag hätte die Artilleriestellungen verdrängt.'),
 ('E1', 'Grep gegen FA-Namen', '✓', 'Durchgeführt gegen alle 357 Einheitennamen aus spooky-db 3810: kein Treffer. Einzige Teilwort-Übereinstimmung „Master“ (in „Burst Master“) ist ein generisches Wort und bleibt. Markenrecherche bleibt offen (§18).'),
 ('E2', '„Hydrocarbon Plant“', '✓', 'Rolle jetzt „Dampfkraftwerk / Geothermal Plant“; ID `hydro` bleibt intern.'),
 ('E3', '`faReference.role` zitiert FA-Strings', '✓', '`faReference.devOnly: true`; Lint entfernt das Feld beim Blueprint-Build.'),
 ('E4', 'Vogt-Layout = FA-ACU-Schema', '✓', 'Glocke auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter; Lot-Kopf bleibt Hauptmerkmal.'),
 ('E5', 'Rollenbezeichnungen', '✓', 'Rost I „Flugabwehrturm“, Krähe „Kampfschweber“.'),
]
for r in LES: A('| ' + ' | '.join(r) + ' |')
A('')

# ---------------------------------------------------------------- 18 Offene Punkte
A('---')
A('')
A('## 18. Offene Punkte')
A('')
A('1. **FA-Datenstand:** spooky-db „3810“ ist nicht der aktuelle FAF-Patch. Vor MS9 alle 50 Referenzen gegen den dann aktuellen `FAForever/fa`-Stand prüfen (Skript: Referenz-IDs aus `roster.json` → DPS-Formel → Δ, Produkt, Pulk und Treffer-Matrix neu rechnen).')
A('2. **Kartenpool und Hochofen:** Enthält der MVP-Pool eine 256-WU-Karte, schlägt das Reichweiten-Gate (200 > 145) fehl. Entweder Pool ≥ 354 WU oder Hochofen per Karten-Restriktion sperren. Mit 48.000 Mass ist er auf kleinen Karten ohnehin ein Spätspiel-Ziel.')
A('3. **Abstich als Integer-Tabelle:** Die FAF-Formel steht fest (Waffennotiz des Vogts). Für den Determinismus wird sie in MS6 als ganzzahlige Umrechnung E ↔ Schaden festgelegt (MS6-Golden).')
A('4. **Vogt-Wrack** (`faction.md` §10.2) bleibt offen, `wreck` ist beim Vogt noch nicht gesetzt.')
A('5. **Luft-Drehraten:** FA gibt `Air.TurnSpeed` in eigener Einheit an. Die `turnRateDeg`-Werte der Luft sind Entwurfswerte für das kinematische Modell und werden in MS12 getunt.')
A('6. **Beschleunigung (`accel`)** ist ein Entwurfswert pro Klasse (Panzer 2,2–2,5, Bots 2,6–4,0, Artillerie 1,8–2,2); FA liefert dafür keine direkt übertragbare Zahl. Tuning mit SPK2/MS3.')
A('7. **Schema:** `roster.json` enthält Felder, die `UnitSchema` heute nicht kennt (Waffen, Ökonomie, Schilde inkl. `regenStartS`, Toggles, Adjacency, `kitbash.parts`/`scale`/`techStripeMat`, Tech-Bitmaske der Visuals). Die Übernahme folgt dem Schema-Ausbau in MS4–MS8.')
A('8. **iconThreshold:** PLAN §3.9 zeigt im Blueprint-Beispiel `iconThreshold:14`. Für die Mindestgröße gilt jetzt 25 px (mobil, bezogen auf die Bildschirmlänge der Einheit); das muss bei der Blueprint-Übernahme bzw. in DECISIONS nachgezogen werden.')
A('9. **Pulk-Gate für Bomber und Flak:** Das Pulk-Gate gilt nur für `ARTILLERY`. Bomben (Dohle, Elster) und Flak (Rüttelsieb, Rost II) werden in MS12 mit demselben Modell nachgerechnet.')
A('10. **Superset-Zählung:** Die Visual-Vereinigung zählt nach (Part, Material). Sitzen gleiche Parts auf verschiedenen Positionen (Punze-Rohr mittig, Meißel-Rohre parallel), zählen sie beim Mesh-Bau doppelt; die Grenzen (8 / 9 Parts) dann erneut prüfen und notfalls das Visual teilen.')
A('11. **Namen:** Markenrecherche zu allen Rufnamen, „Varkan“ und „Kessa“ steht aus; der FA-Namens-Grep ist erledigt (§17.2 E1).')
A('')

# ---------------------------------------------------------------- 19 Experimentals (T4, Post-MVP)
X = D['checks']['experimentals']
A('---')
A('')
A('## 19. Experimentals (T4, Post-MVP)')
A('')
A('> **Nicht Teil des MVP.** U16 (erstes Land-Experimental) ist Post-MVP, U21 (volles Roster, Game-Ender) und E17 (Endgame-Eco) sind „Später“. Die Einträge stehen als vollständige Daten bereit (`tech: 4`, `postMvp: true`, Meilenstein PM1–PM3), damit Modelle, Icons und Balancing-Relationen früh prüfbar sind. Design, Mechaniken und Konter: [`experimentals.md`](experimentals.md). Gleiche Gates wie das MVP gegen die FA-T4-Referenz (±25 % hart, ±15 % Ziel inkl. Produkt/Pulk) plus T3-Äquivalent-Relation (±25 %). Review vom 2026-09-29 eingearbeitet (Mantel-Regeneration und -Neuaufbau, Konverter-Streuung, -Warnung und -Signatur, Baustellen- und Pathing-Regeln): [`experimentals.md`](experimentals.md) §10.')
A('')
A('**Stammdaten**')
A('')
A('| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht | Hotbuild | Icon |')
A('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for u in T4:
    e = u['economy']; f = u['faReference']
    ref = f"{f['role']} (`{f['bp']}`" + (f", Gegenprobe `{f['crossCheckBp']}`" if f.get('crossCheckBp') else '') + ')'
    A(f"| T4 | `{u['id']}` | **{u['name']['de']}** / {u['name']['en']} | {u['role']['de']} / {u['role']['en']} | {ref} | {u['msFirst']} | "
      f"{n(e['mass'])} / {n(e['energy'])} / {n(e['buildTime'])} | {n(u['health']['max'])} | {mv(u)} | {fp(u)} | {intel(u)} | {hk(u)} | `{u['icon']}` |")
A('')
A('**Waffen und Balance** (Δ gegenüber der FA-T4-Referenz; Vergleichsbasis in der letzten Spalte)')
A('')
A('| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | Vergleich |')
A('|---|---|---|---|---|---|---|---|')
for u in T4:
    b = u['balance']; fa = b['fa']
    hpb = ' (inkl. Schild)' if b['hpBasis'] != 'HP' else ''
    pk = f"<br>Pulk-DPS/Mass {n(b['pulk']['pulkDpsPerMass'],4)} (FA {n(b['pulk']['faPulkDpsPerMass'],4)}): {pct(b['pulk']['devPct'])}" if b.get('pulk') else ''
    A(f"| `{u['id'].split(':')[1]}` | {weapons(u)}{pk} | {n(b['dpsPerMass'],4)} ({n(fa['dpsPerMass'],4)}) | {pct(b['devDpsPerMassPct'])} | "
      f"{n(b['hpPerMass'],4)} ({n(fa['hpPerMass'],4)}){hpb} | {pct(b['devHpPerMassPct'])} | {pct(b['devProductPct'])} | {u['experimental']['faCompare']} |")
A('')
A('**Besonderheiten, Mechaniken, Kitbash**')
A('')
A('| ID | Kategorien / buildableBy | Besonderheiten | Feature-IDs · neue Mechaniken | Kitbash (Parts) |')
A('|---|---|---|---|---|')
for u in T4:
    x = u['experimental']
    cr = x['crush']
    crs = ''
    if cr:
        crs = f"<br>Crush: Mauern {'ja' if cr['walls'] else 'nein'}, Wracks {'ja' if cr['wrecks'] else 'nein'}, schiebt sizeClass ≤ {cr['pushSizeClassMax']}" + (
            f", Fußtritt {n(cr['footfallDamage'])}/r{n(cr['footfallRadius'],1)}" if cr['footfallDamage'] else '')
    dw = u['special']['deathWeapon']
    dl = f" (Verzögerung {n(dw['delayS'],1)} s)" if dw and dw.get('delayS') else ''
    A(f"| `{u['id'].split(':')[1]}` | {' '.join(u['categories'])}<br>*von:* `{u['buildableBy']}` | {special(u)}{dl}{crs}<br>Wrack {n(x['wreck']['mass'])} Mass<br>**Konter:** {'; '.join(x['counters'])} | "
      f"{', '.join(x['features'])} · {', '.join(x['newMechanics'])} | {u['kitbash']['description']}<br>{parts(u)} · Budget {'/'.join(str(t) for t in u['kitbash']['trisBudget'])} Tris |")
A('')
A('**Neue Mechaniken (Vorschlag, noch ohne Eintrag in `features.json`)**')
A('')
A('| Code | Mechanik | gebraucht von |')
A('|---|---|---|')
for k, v in D['experimentalMechanics'].items():
    A(f"| {k} | {v} | {', '.join(u['name']['de'] for u in T4 if k in u['experimental']['newMechanics'])} |")
A('')
A('**T3-Äquivalent** (gleiche Mass in der stärksten T3-Einheit derselben Rolle; Relation T4/T3 von DPS/Mass bzw. HP/Mass gegen dasselbe Verhältnis in FA, Gate ±25 %)')
A('')
A('| T4 → T3 | Anzahl T3 für gleiche Mass (FA) | Pool-DPS / Pool-HP der T3 | T4/T3 DPS/Mass (FA) | Δ | T4/T3 HP/Mass (FA) | Δ |')
A('|---|---|---|---|---|---|---|')
for r in X['t3Equivalent']:
    A(f"| {nm(r['t4'])} → {nm(r['t3'])} | {n(r['t3Count'],1)} ({n(r['faT3Count'],1)}) | {n(r['t3PoolDps'],0) if r['t3PoolDps'] else '–'} / {n(r['t3PoolHp'])} | "
      f"{n(r['dpsRatio'],3) if r['dpsRatio'] else '–'} ({n(r['faDpsRatio'],3) if r['faDpsRatio'] else '–'}) | {pct(r['devDpsRatioPct'])} | {n(r['hpRatio'],3)} ({n(r['faHpRatio'],3)}) | {pct(r['devHpRatioPct'])} |")
A('')
eco = [r for r in X['t3Equivalent'] if r.get('eco')]
for r in eco:
    e = r['eco']
    A(f"**Tiefenstich als Mass-Quelle:** Deckel {n(e['maxMassPerSec'])} M/s ≙ {n(e['t3MexForMax'],1)} Zapfstellen III (Kette I→III je 5.436 Mass, zusammen {n(e['t3MexCostForMax'])} Mass und {n(round(e['t3MexForMax']))} Spots); Amortisation bei vollem Bedarf {n(e['paybackAtMaxS'])} s (`XAB1401` bei gleichem Verbrauch {n(e['faPaybackAt750S'])} s).")
    A('')
A('**Bauzeit mit N Meistern** (Build Power 32 je Meister; Mass-/Energy-Fluss, den die Baustelle dann zieht; FA mit T3-Engineer BP 32,5)')
A('')
A('| Einheit | BT | 1 Meister | 10 | 20 | 40 | Fluss bei 20 Meistern |')
A('|---|---|---|---|---|---|---|')
for r in X['buildTime']:
    rows = {x['engineers']: x for x in r['rows']}
    def c_(k):
        x = rows[k]; fa_ = f" (FA {n(x['faSeconds'])} s)" if x['faSeconds'] else ''
        return f"{n(x['seconds'])} s{fa_}"
    x20 = rows[20]
    A(f"| {nm(r['unit'])} | {n(r['buildTime'])} | {c_(1)} | {c_(10)} | {c_(20)} | {c_(40)} | {n(x20['massPerSec'],0)} M/s, {n(x20['energyPerSec'])} E/s |")
A('')
A('**Schildbrechen mit T4** (ein Schütze, Hauptwaffe, Regeneration nach `regenStartS`)')
A('')
A('| Angreifer → Schild | Salven (Zeit) |')
A('|---|---|')
for s in X['shieldBreak']:
    A(f"| {nm(s['attacker'])} → {nm(s['target'])} | {str(s['shots']) + ' (' + n(s['timeS'],1) + ' s)' if s['shots'] else 'bricht allein nicht'} |")
A('')
A('**Silhouetten-Pflichtpaare T4** (Rollen-Verwandte gleicher Grammatik; getrennt durch Größe ≥ 2,5×, Keramik-Klammer und Icon-Klammer): ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in D['silhouettePairs']['t4']) + '.')
A('')
A('**Todeswaffen** (Friendly Fire, K8/K14; FA-Relation)')
A('')
A('| Einheit | Schaden / Radius (FA) | Verzögerung | tötet Fallhammer | tötet Glutkessel III |')
A('|---|---|---|---|---|')
for d in X['deathWeapons']:
    A(f"| {nm(d['unit'])} | {n(d['damage'])} / r{n(d['radius'])} ({n(d['faDamage'])} / r{n(d['faRadius'])}) | {n(d['delayS'],1)} s | {'ja' if d['killsT3Bot'] else 'nein'} | {'ja' if d['killsT3Pgen'] else 'nein'} |")
A('')
open(DOCS / 'roster.md', 'w').write('\n'.join(L) + '\n')
print(len(L))
