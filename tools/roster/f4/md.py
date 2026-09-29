# Erzeugt docs/design/factions/f4/roster.md aus roster.json (f4) und zum Vergleich docs/design/roster.json (Varkan).
# Vorlage: tools/roster/md.py. Aufruf: python3 md.py (nach gen.py).
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
D = json.load(open(ROOT / 'docs/design/factions/f4/roster.json'))
V = json.load(open(ROOT / 'docs/design/roster.json'))
U = D['units']
VID = {u['id']: u for u in V['units']}


def n(x, d=None):
    if x is None: return '–'
    if isinstance(x, bool): return 'ja' if x else 'nein'
    if isinstance(x, int) or (isinstance(x, float) and x.is_integer() and d is None):
        return f'{int(x):,}'.replace(',', '.')
    if d is None: d = 2
    s = f'{x:.{d}f}'
    if '.' in s: s = s.rstrip('0').rstrip('.')
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
        sp = f", Splash {n(w['splash'], 1)}" if w.get('splash') else ''
        lay = ' [Luft]' if w['layers'] == ['air'] else ''
        out.append(f"`{w['ref'].split(':')[1]}` {w['type']}: {sal}{n(w['damage'])} / {n(w['reloadS'], 1)} s = **{n(w['dps'], 1)} DPS**, "
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
    msc = f"Maßstab {n(sc['xz'], 2)}" if sc['xz'] == sc['y'] else f"Maßstab xz {n(sc['xz'], 2)} / y {n(sc['y'], 2)}"
    st = (f"{k['techStripes']} Tonpunkt{'e' if k['techStripes'] > 1 else ''} ({'Pechglas' if k['techStripeMat'] == 'body' else 'Perlglas'})"
          if k['techStripes'] else 'keine Tonpunkte')
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
            bits.append(f"Death: `{dw['ref'].split(':')[1]}` {n(dw['damage'])}/r{n(dw['radius'], 1)} ({dw['note']})")
    if u.get('shield'):
        sh = u['shield']
        bits.append(f"Schild {n(sh['hp'])} HP, r {n(sh['radius'])}, Regen {n(sh['regenPerSec'])}/s ab {n(sh['regenStartS'])} s nach dem letzten Treffer, Neuaufbau {n(sh['rechargeS'])} s, {n(sh['upkeepEnergyPerSec'])} E/s")
    e = u['economy']; eco = []
    if e.get('buildPower'): eco.append(f"BP {n(e['buildPower'])}")
    if e.get('massPerSec'): eco.append(f"+{n(e['massPerSec'])} M/s")
    if e.get('energyPerSec'): eco.append(f"+{n(e['energyPerSec'])} E/s")
    if e.get('upkeepEnergyPerSec') and not u.get('shield'): eco.append(f"−{n(e['upkeepEnergyPerSec'])} E/s")
    if e.get('storageMass'): eco.append(f"Speicher {n(e['storageMass'])} M")
    if e.get('storageEnergy'): eco.append(f"Speicher {n(e['storageEnergy'])} E")
    if eco: bits.insert(0, ' · '.join(eco))
    if s['notes'] and s['notes'] != '—': bits.append(s['notes'])
    for pm in s.get('postMvp', []):
        bits.append(f"**⚑ {pm['feature']}:** {pm['behavior']} (ohne Feature: {pm['mvp']})")
    return '<br>'.join(bits)


def hk(u):
    h = u['hotbuild']
    return f"{h['menu']}: {h['slot']}" if h else '–'


def mv(u):
    m = u['motion']
    return '–' if m.get('structure') else f"{n(m['speed'], 1)} / {n(m['turnRateDeg'])}°"


def fp(u):
    m = u['motion']
    return f"{m['footprint'][0]}×{m['footprint'][1]}" + (f" / s{m['sizeClass']}" if 'sizeClass' in m else '')


def intel(u):
    i = u['intel']; s = n(i.get('vision'))
    if i.get('radar'): s += f" / R {n(i['radar'])}"
    return s


L = []; A = L.append
UID = {u['id']: u for u in U}
OTHER = {}
for _slug in ('f2', 'f3'):
    _p = ROOT / f'docs/design/factions/{_slug}/roster.json'
    if _p.exists():
        OTHER.update({u['id']: u['name']['de'] + f' ({_slug})' for u in json.load(open(_p))['units']})
def nm(i): return UID[i]['name']['de'] if i in UID else VID[i]['name']['de'] + ' (Varkan)' if i in VID else OTHER.get(i, i)
c = D['counts']

A('# Roster: Aurith-Chor (Fraktion f4, MVP)')
A('')
A('> **Status:** Startwerte für alle MVP-Blueprints der Fraktion f4 auf Basis von `docs/design/factions/f4/faction.md`. Maschinenlesbar in '
  '`docs/design/factions/f4/roster.json` (Schema `faf-roster/1`, wie Varkan). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und '
  'Kitbash-Parts** der Fraktion; dieses Dokument ist daraus erzeugt (`tools/roster/f4/md.py`), `faction.md` §7.4, §9 und §11.1 sind daran angeglichen.')
A(f"> **Umfang:** **{c['total']} Blueprints** ({c['mobile']} mobil, {c['structures']} Gebäude, jede Upgrade-Stufe einzeln), davon **{c['ms9Core']} im MS9-Kern (●)**, "
  f"Rest bis MS14 (○). Zielbänder PLAN: MS9 25–30, MS14 45–55. {c['visuals']} Visuals, {c['iconGlyphs']} Icon-Glyphen (dieselben wie Varkan, keine neue). "
  'Ein Blueprint weniger als Varkan: Späher und leichter Sturmläufer fallen im Pfiff zusammen. Waffen-, Projektil- und Basis-BPs sind nicht mitgezählt.')
A('> **Ausgeschlossen (Post-MVP laut features.json):** wie Varkan – TML/TMD, Nukes/SMD, Transporter (U13), T3-Luft (U12), Marine und Torpedos (U17/U18), '
  'Experimentals, Mass Fabricator (E15), SACU (U15), ACU-Enhancements (U14), Stealth/Omni (I4/I5). Vorbild-Asymmetrien, die solche Features brauchen, '
  'sind pro Einheit mit **⚑ Feature-ID** markiert (`special.postMvp`, Übersicht §17.2) und rein additiv.')
A('> **Balancing:** Referenz ist die **Vorbild-Fraktion** (FA-Blueprints `XS*`, dazu die FAF-Einheit `DSLK004`), nicht die Varkan-Referenz. Gates wie Varkan: '
  'DPS/Mass und HP/Mass je ±25 % (hart, PLAN U3), vom Generator strenger erzwungen: Einzelachsen, **Produkt** und **Pulk-DPS/Mass** der Artillerie je ±15 %, '
  '**Treffer-bis-Tod-Matrix** exakt wie die Vorbild-Referenz (§14). Die Asymmetrie gegenüber Varkan entsteht allein dadurch, dass die Vorbild-Relationen übernommen werden (§17).')
A('')
A('---')
A('')
A('## 1. Quellen und Methodik')
A('')
A('- **FA-Daten:** [FAForever/spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json` (Datenstand „3810“, derselbe wie bei Varkan), '
  'extrahiert mit `tools/roster/f4/ref.py` nach `tools/roster/f4/fa_ref.json` (49 Referenz-Blueprints, nur Zahlen). DPS nach `app/js/dps.js` '
  '(Nachladezeit auf 0,1-s-Ticks abgerundet, Salven über Racks/`MuzzleSalvoSize`, Strahl-Pulse über `BeamLifetime`).')
A('- **Stichprobe gegen FAF `develop`** ([FAForever/fa](https://github.com/FAForever/fa) `units/*/…_unit.bp`, abgerufen 2026-09-29): T1-Gleiter-Referenz, '
  'T2-Stoßgleiter, Kommandant (HP 11.500, Regeneration 10, Tod 2.000/r30 + 500/r40) und Schildgeneratoren sind identisch. **Abweichungen seit 3810:** '
  'T2-Strahlverteidigung 50 statt 55 Schaden pro Puls (≈ 137,5 statt 151,25 DPS), Präzisionsläufer RW 60/70 statt 55/65. Der T3-Belagerungsgleiter hat in `develop` '
  'zwei Direktwaffen 57 / 0,5 s und die Indirektwaffe 625 / 3,4 s (≈ 412 DPS ohne Torpedo); 3810 kommt mit zwei Direktwaffen 64 / 0,5 s und 625 / 4,0 s auf dieselben ≈ 412 DPS. '
  'Das ist also keine Balance-Änderung, sondern war ein Extraktionsfehler (nächster Punkt). Das Roster bleibt wie Varkan auf 3810; Nachziehen vor dem MS9-Balancing (§19).')
A('- **Doppelwaffen (`WeaponNumber`, Review R1):** spooky-db fasst identische Waffen (links/rechts) zu einem Eintrag mit `WeaponNumber` zusammen. `ref.py` wertet das Feld seit dem Review aus '
  '(`fa_ref.json` → `weapons[].count`, DPS × count). Betroffen in f4: T3-Belagerungsgleiter (2 Direktwaffen, Referenz-DPS ohne Torpedo 284 → 412), T2-Gunship (2 Bordwaffen, 57 → 114), '
  'T2-Jagdbomber (2 Luftwaffen, 200 → 275). Gegenprobe gegen FAF `develop`: dort stehen jeweils zwei getrennte Waffen-Einträge.')
A('- **Schild-Regeneration** fehlt in spooky-db. Werte für `checks.shieldBreak` aus FAF `develop`: T2-Schild 153/s, T3-Schild 168/s, mobiler Schild 133/s, '
  'Regenerations-Verzögerung überall 3 s (Varkan-Vorbild: 3/3/1 s).')
A('- **Referenzwahl:** je Rolle die Einheit der Vorbild-Fraktion (`faReference.bp`). Die Vorbild-Fraktion hat keinen reinen T1-Bot und keinen T2-Mobilschild; '
  'beide Rollen gehen in Pfiff bzw. Stille auf (faction.md §9.2 A1/A5). T3-Flugabwehr: FAF-Einheit `DSLK004`. T3-Radar: Omni-Sensor der Vorbild-Fraktion, '
  'ohne Omni halbiert wie beim Varkan-Horcher III. **Nur Blueprint-IDs und generische Rollenbezeichnungen, keine FA-Eigennamen**; `faReference` ist dev-only.')
A('- **Referenz-DPS mit Auswahl (`balance.fa.dpsWeapons`):** Kantor nur Hauptwaffe (wie Vogt). Grollen ohne Torpedo, weil U18 Post-MVP ist. '
  'Diskant nur schneller Modus, weil sich die Modi ausschließen (spooky-db addiert beide). Zimbel und Schwärmer: beide Waffen, wie in der Referenz.')
A('- **Einheiten, Waffen, Abweichung, Produkt, Pulk, Treffer bis Tod:** Definitionen identisch zu Varkan (`docs/design/roster.md` §1). '
  'Neu: **Strahlwaffen** (Gabel II, Zimbel) sind als Hitscan-Pulse notiert, `salvo` = Pulse pro Zyklus, `damage` = Schaden pro Puls (Vorschlag für K1, §19).')
A('- **Kitbash:** Parts aus `faction.md` §3.3; ⟳ = animierter Part (≤ 2), `[mat]` = Material-Slot (`team`, `amber`, `glow`, `pearl`, sonst `body` = Pechglas). '
  'Der Dreipass-Sockel sind drei `lens`-Parts (Teamfarbe nur als Randmaske). Budget wie Varkan: mobil ≤ 7 Parts, Strukturen ≤ 9, ≤ 350 Tris; Superset pro Visual mobil ≤ 8, Strukturen ≤ 9. '
  'Lints im Generator: Resonanz-Monopol (`crystal`/`glow` nur ECONOMIC, FACTORY, ENGINEER), Form-Monopole (Gabel nur DIRECTFIRE, Trichter nur Artillerie/Indirekt, '
  'Pfeife nur ANTIAIR, Spindel nur SILO/ANTIAIR, Sichel und Perlglas nur ENGINEER), ≥ 1 Team-Part, `buildPower` bei upgradebaren Gebäuden, `regenStartS` bei Schilden, keine neue Icon-Glyphe.')
A('- **Tonpunkte (`kitbash.techStripes`):** Feldname wie Varkan, Bedeutung bei f4: 1–3 Tonpunkte auf dem hinteren Kamm (Perlglas, bei Engineers Pechglas). Kantor und Grat ohne.')
A('- **Prüfung:** `tools/roster/f4/gen.py` erzwingt alle Gates beim Erzeugen; `tools/roster/f4/validate.py` rechnet unabhängig aus `fa_ref.json` nach '
  '(Δ, Produkt, Pulk, Treffer-Matrix, Schema-Konsistenz) und endet bei Verstößen mit Exit-Code 1.')
A('- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein laut PLAN §5 · RW = Reichweite · s = sizeClass · Sicht / R = Radar · ⚑ = Post-MVP-Asymmetrie.')
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
    if not us: continue
    cum += len(us)
    A(f"| {m} | {len(us)} (Σ {cum}) | " + ', '.join(f"{dot(u)} {u['name']['de']}" for u in us) + ' |')
A('')
A(f"**MS9-Kern ({c['ms9Core']}):** " + ', '.join(u['name']['de'] for u in U if u['ms9Core']) + '.')
A('')
A('- 11 mobile Kern-Einheiten (Varkan: 11) und **dieselben 15 Kern-Strukturen wie Varkan**. Daten-Vorgriffe wie bei Varkan: Lichtkammer ab MS6 (Aufschrei braucht ≥ 7.500 E Vorrat), '
  'Bernsteinkammer und Äolsharfe (ohne neue Mechanik).')
A('- **Brüller ist Kern**, weil der schwere T2-Läufer die Front der Fraktion trägt (A3); dafür entfällt der separate T1-Bot. Der **Pfiff** ist die erste Fabrik-Einheit im Opening (MS6) wie der Varkan-Stichel.')
A('- **Hochorgel (SAM)** ist Kern wie der Varkan-Hochrost: B5 nimmt in MS8 „PD, Mauern, SAM“ ab; gespawnt per Konsole, baubar ab dem Vorsänger (MS13).')
A('')
A('### 2.1 Abgrenzungen und Abweichungen gegenüber Varkan')
A('')
A('| Punkt | Festlegung | Grund |')
A('|---|---|---|')
A('| `lnd_t1_bot` | nicht belegt | Pfiff (`lnd_t1_scout`) deckt Späher und LAB ab (A1); Icon `land_bot_t1`, Hotbuild A und S. |')
A('| `lnd_t2_shield` → `lnd_t3_shield` | Stille erst auf T3 | Vorbild hat keinen T2-Mobilschild (A5). Varkans Schürze ist ebenfalls ○ (MS13), der Meilenstein verschiebt sich nicht. |')
A('| `lnd_t3_bot` → `lnd_t3_tank` | Grollen statt T3-Läufer | Hybrid Direkt + Indirekt (A6); ID-Token `tank`, weil die Bauform ein Gleiter ist. |')
A('| `lnd_t2_bot` | ● statt ○ | Linienanker der Fraktion (Varkan-Zange ist Roster-Auffüllung MS14). |')
A('| Hallen | ein gemeinsames Visual `v_fac` | Grund- und Himmelshalle teilen Apsis und Kristalle, nur Rampe/Landereif unterscheiden sich (Rollenbit). Hält die Visual-Zahl bei 28 trotz separatem `v_sam`. |')
A('| Namespace | `f4:` | Varkan bleibt `core:`; Vereinheitlichung offen (§19). |')
A('')
A('---')
A('')
A('## 3. Hotbuild-Raster (QWERT / ASDFG / ZXCVB, ohne Rebinding)')
A('')
A(D['hotbuildGrid']['rule'])
A('')
g = D['hotbuildGrid']
for menu, title in (('Grundhalle', 'Grundhalle (Fabrik-Menü Land)'), ('Himmelshalle', 'Himmelshalle (Fabrik-Menü Luft)'), ('Bau', 'Bau-Menü (Kantor und Engineers)')):
    A(f'**{title}**')
    A('')
    A('| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |')
    A('|---|---|---|---|---|---|')
    for keys, lab in (('QWERT', 'Reihe 1'), ('ASDFG', 'Reihe 2'), ('ZXCVB', 'Reihe 3')):
        cells = [f"**{k}** {g[menu][k]}" if k in g[menu] else '–' for k in keys]
        if all(x == '–' for x in cells): continue
        A(f'| {lab} | ' + ' | '.join(cells) + ' |')
    A('')

GROUPS = [('cmd', '4. Kantor und Engineers'), ('land1', '5. Landarmee T1'), ('land2', '6. Landarmee T2'),
          ('land3', '7. Landarmee T3'), ('air', '8. Luftwaffe T1–T2'), ('eco', '9. Wirtschaft'), ('fac', '10. Hallen'),
          ('def', '11. Verteidigung'), ('intel', '12. Intel und Schilde'), ('arty', '13. Artilleriestellungen')]
grp = lambda u: f"land{u['tech']}" if u['group'] == 'land' else u['group']
for key, title in GROUPS:
    us = [u for u in U if grp(u) == key]
    A('---'); A(''); A(f'## {title}'); A('')
    A('**Stammdaten**'); A('')
    A('| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |')
    A('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for u in us:
        e = u['economy']; f = u['faReference']
        A(f"| {dot(u)} | `{u['id']}` | **{u['name']['de']}** / {u['name']['en']} | {u['role']['de']} / {u['role']['en']} | {f['role']} (`{f['bp']}`) | {u['msFirst']} | "
          f"{n(e['mass'])} / {n(e['energy'])} / {n(e['buildTime'])} | {n(u['health']['max'])} | {mv(u)} | {fp(u)} | {intel(u)} | {hk(u)} | `{u['icon']}` |")
    A('')
    A('**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)'); A('')
    A('| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |')
    A('|---|---|---|---|---|---|---|')
    for u in us:
        b = u['balance']; fa = b['fa']
        hpb = ' (inkl. Schild)' if b['hpBasis'] != 'HP' else ''
        pk = f"<br>Pulk-DPS/Mass {n(b['pulk']['pulkDpsPerMass'], 3)} (FA {n(b['pulk']['faPulkDpsPerMass'], 3)}): {pct(b['pulk']['devPct'])}" if b.get('pulk') else ''
        A(f"| `{u['id'].split(':')[1]}` | {weapons(u)}{pk} | {n(b['dpsPerMass'], 3)} ({n(fa['dpsPerMass'], 3)}) | {pct(b['devDpsPerMassPct'])} | "
          f"{n(b['hpPerMass'], 3)} ({n(fa['hpPerMass'], 3)}){hpb} | {pct(b['devHpPerMassPct'])} | {pct(b['devProductPct'])} |")
    A('')
    A('**Kategorien, Besonderheiten, Kitbash**'); A('')
    A('| ID | Kategorien / buildableBy | Besonderheiten | Kitbash (Parts) | MS-Hinweis |')
    A('|---|---|---|---|---|')
    for u in us:
        bb = f"<br>*von:* `{u['buildableBy'].replace('|', chr(92) + '|')}`" if u['buildableBy'] else ''
        A(f"| `{u['id'].split(':')[1]}` | {' '.join(u['categories'])}{bb} | {special(u)} | {u['kitbash']['description']}<br>{parts(u)} | {u['msNote']} |")
    A('')

# ---------------------------------------------------------------- 14 Balance
A('---'); A(''); A('## 14. Balance-Übersicht und Gates'); A('')
devs_d = [(u['balance']['devDpsPerMassPct'], u['name']['de']) for u in U if u['balance']['devDpsPerMassPct'] is not None]
devs_h = [(u['balance']['devHpPerMassPct'], u['name']['de']) for u in U]
devs_p = [(u['balance']['devProductPct'], u['name']['de']) for u in U if u['balance']['devProductPct'] is not None]
mx = lambda xs: max(xs, key=lambda x: abs(x[0]))
avg = lambda xs: round(sum(d for d, _ in xs) / len(xs), 1)
pulks = [(u['balance']['pulk']['devPct'], u['name']['de']) for u in U if u['balance'].get('pulk')]
A(f"- **DPS/Mass:** {len(devs_d)} bewaffnete Einträge, größte Abweichung {pct(mx(devs_d)[0])} ({mx(devs_d)[1]}), Mittelwert {pct(avg(devs_d))}.")
A(f"- **HP/Mass:** {len(devs_h)} Einträge, größte Abweichung {pct(mx(devs_h)[0])} ({mx(devs_h)[1]}), Mittelwert {pct(avg(devs_h))}.")
A(f"- **Produkt DPS/Mass × HP/Mass:** größte Abweichung {pct(mx(devs_p)[0])} ({mx(devs_p)[1]}), Mittelwert {pct(avg(devs_p))}. Gate ±15 %.")
A(f"- **Pulk-DPS/Mass (Artillerie):** größte Abweichung {pct(mx(pulks)[0])} ({mx(pulks)[1]}). Gate ±15 %.")
A(f"- **Globale Verschiebung wie Varkan:** HP/Mass im Mittel {pct(avg(devs_h))}, DPS/Mass {pct(avg(devs_d))} gegenüber der Vorbild-Referenz (Varkan gegenüber seiner Referenz: "
  f"ebenfalls leicht zäher). Tötungszeiten verlängern sich im Mittel um ≈ {n(round((1 + avg(devs_h) / 100) / (1 + avg(devs_d) / 100) * 100 - 100, 1), 1)} %; die Breakpoints (unten) bleiben exakt.")
A('- **Keine 1:1-Kopien:** Werte weichen meist um 1–6 % von der Referenz ab. Exakt gleich bleiben nur Werte, die ein Breakpoint erzwingt (Pfiff 4 Schaden → Chorist 32 Treffer) '
  'oder die fraktionsübergreifend gleich sind (Kantor wie Vogt: Hauptwaffe, Aufschrei-Formel, Tod).')
A('- **Maßstabs-Sonderfall Großhorn:** wie Varkan-Hochofen – FA-RW 825 WU auf RW 200 skaliert, Kosten ≈ 66 %, Einzelschuss 4.900 (FA 5.000, Schild-Burst), Feuerrate ×⅔; DPS/Mass und HP/Mass ±2 %.')
A('')
A('**Pulk-DPS/Mass (Artillerie, Gate ±15 %)**'); A('')
A('| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |')
A('|---|---|---|---|---|---|')
for u in U:
    p = u['balance'].get('pulk')
    if not p: continue
    w = u['weapons'][0]
    A(f"| {u['name']['de']} | {(str(w['salvo']) + '×') if w['salvo'] > 1 else ''}{n(w['damage'])} / {n(w['reloadS'], 1)} s | {n(p['splash'], 1)} ({n(p['faSplash'], 1)}) | "
      f"{n(p['pulkDpsPerMass'], 3)} ({n(p['faPulkDpsPerMass'], 3)}) | {pct(p['devPct'])} | {pct(u['balance']['devDpsPerMassPct'])} |")
A('')
A(f"**Treffer-bis-Tod-Matrix ({len(D['checks']['hitsToKill'])} Paare, Pflicht: exakt wie die Vorbild-Referenz)**"); A('')
A('| Angreifer (Waffe) → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |')
A('|---|---|---|---|---|---|')
for h in D['checks']['hitsToKill']:
    f = h['fa']
    A(f"| {nm(h['attacker'])} (`{h['weapon'].split(':')[1]}`) → {nm(h['target'])} | {n(h['salvoDamage'])} / {n(h['targetHp'])} | {h['hits']} ({n(h['ttkS'], 1)} s) | "
      f"{n(f['salvoDamage'])} / {n(f['targetHp'])} | {f['hits']} ({n(f['ttkS'], 1)} s) | {'✓' if h['match'] else '✗'} |")
A('')
A('**Breakpoints, die sich gegenüber Varkan bewusst ändern** (faction.md §9.2): Horn → Chorist 3 (Varkan Kelle → Lehrling 2), Horn → Triller 7 (Kelle → Punze 3), '
  'Heuler → Triller 2 (Meißel → Punze 5 Salven), Kantor → Pfiff 1 (Vogt → Funke 1, → Stichel 1). Die Aurith-Artillerie räumt Engineers und Pulks, bricht aber keine Linie; '
  'der Heuler tötet T1-Gleiter in zwei Schüssen.')
A('')
A('**Schildbrechen (Info, ein einzelner Schütze, mit Regenerations-Verzögerung `regenStartS`)**'); A('')
A('| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild |')
A('|---|---|---|')
for s in D['checks']['shieldBreak']:
    ours = f"{s['shots']} ({n(s['timeS'])} s)" if s['shots'] else 'bricht allein nicht'
    theirs = f"{s['faShots']} ({n(s['faTimeS'])} s)" if s['faShots'] else 'bricht allein nicht'
    A(f"| {nm(s['attacker'])} → {nm(s['target'])} | {ours} | {theirs} |")
A('')
A('Fanfare und Heerhorn brechen einen Dämpfer II allein nicht (Regeneration 150/s über 17 bzw. 7 s Pause), genau wie im Vorbild; sie brauchen Masse oder Unterstützung. '
  'Das Großhorn braucht wegen der ×⅔-Feuerrate gegen Dämpfer III einen Schuss mehr als im Vorbild (7 statt 6) – Folge der Kartenskalierung, wie beim Varkan-Hochofen.')
A('')

# ---------------------------------------------------------------- 15 Eco
A('---'); A(''); A('## 15. Ökonomie-Kennzahlen (Kurzreferenz)'); A('')
A('Identisch zur Varkan-Ökonomie (gleiche FA-Relationen in allen Fraktionen): Mass-Ertrag, Unterhalt, Upgrade-Kosten und Adjacency stimmen mit Varkan überein, '
  'nur HP und kleine Kostenrundungen unterscheiden sich. Amortisation = Upgrade-Mass / Mehrproduktion; die zweite Zahl rechnet den Energy-Mehrbedarf als anteiligen Resonator I ein (20 E/s ≙ 75 Mass).')
A('')
A('| Gebäude | Ertrag | Unterhalt | Amortisation (Mass) | inkl. E-Mehrbedarf | Upgrade zur nächsten Stufe | Adjacency (FA-Relation) |')
A('|---|---|---|---|---|---|---|')
for i in ('str_t1_mex', 'str_t2_mex', 'str_t3_mex', 'str_t1_pgen', 'str_t2_pgen', 'str_t3_pgen', 'str_t1_hydro', 'str_t1_mstore', 'str_t1_estore'):
    u = UID['f4:' + i]; e = u['economy']; ert = []
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
    A(f"| {u['name']['de']} | {', '.join(ert)} | {('−' + n(e['upkeepEnergyPerSec']) + ' E/s') if e.get('upkeepEnergyPerSec') else '–'} | {amort} | {amort2} | {upg} | {u['special']['adjacency'] or '–'} |")
A('')
A('Weitere Upgrade-Dauern (buildTime der Zielstufe / buildPower der Vorstufe): ' + '; '.join(
    f"{u['name']['de']} → {UID[u['special']['upgradesTo']]['name']['de']} {n(UID[u['special']['upgradesTo']]['economy']['buildTime'] / u['economy']['buildPower'], 0)} s"
    for u in U if u['special']['upgradesTo'] and 'STRUCTURE' in u['categories'] and u['id'] not in ('f4:str_t1_mex', 'f4:str_t2_mex')) + '.')
A('')
A('Kantor: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10 (wie Vogt).')
A('')

# ---------------------------------------------------------------- 16 Silhouetten / Visuals / Glyphen
A('---'); A(''); A('## 16. Silhouetten-Pflichtpaare, Visuals, Glyphen'); A('')
sp = D['silhouettePairs']
A('**Pflichtpaare MS9 (nur ●, 5 von 5 Testern müssen unterscheiden):** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['ms9']) + '.')
A('')
A('**Pflichtpaare MS14:** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['ms14']) + '.')
A('')
A('**Fraktionsübergreifend (neu, `silhouettePairs.crossFaction`):** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['crossFaction']) +
  '. Im Schattenriss dieselbe Rolle (Winkel-Code), im Graustufenbild verschiedene Fraktionen (Höhe, Kurve gegen Kante).')
A('')
A('**Visuals** (Superset-Mesh pro Rolle, Tech-Bitmaske pro Vertex wie Varkan; Vereinigung nach Part und Material):'); A('')
A('| Visual | Mitglieder | Superset-Parts | ≈ Tris |')
A('|---|---|---|---|')
for vid, v in D['visuals'].items():
    A(f"| `{vid}` | {', '.join(nm(i) for i in v['members'])} | {v['supersetParts']} | {v['trisEstimate']} |")
A('')
A(f"**Draw-Budget:** {c['visuals']} Visuals wie Varkan (28). Im 1v1 zweier verschiedener Fraktionen sind bis zu 56 Visuals aktiv (DECISIONS 17 rechnet mit 40) – Prüfung im Render-Bench (§19).")
A('')
A(f"**Icon-Glyphen ({len(D['iconGlyphs'])} Tokens):** " + ', '.join(f"`{x}`" for x in D['iconGlyphs']) +
  '. Exakt der Varkan-Atlas (Generator-Lint), keine neue Grundform, keine neue Glyphe. Kantor (`cmd_commander`) und Grat (`wall`) ohne Glyphe.')
A('')

# ---------------------------------------------------------------- 17 Asymmetrien
A('---'); A(''); A('## 17. Asymmetrie gegenüber Varkan'); A('')
A('### 17.1 Relationen je Rolle (aus beiden `roster.json`)'); A('')
A('Beide Fraktionen liegen je Einheit innerhalb ±15 % ihrer FA-Referenz. Die Unterschiede zwischen ihnen sind deshalb die Unterschiede zwischen den FA-Vorbildern – '
  'die Asymmetrie ist übernommen, nicht erfunden. Δ = Aurith / Varkan − 1.')
A('')
A('| Rolle | Aurith | Varkan | Mass | Δ DPS/Mass | Δ HP/Mass | Δ Produkt | Lesart |')
A('|---|---|---|---|---|---|---|---|')
MAP = {'lnd_t3_tank': ['lnd_t3_bot'], 'lnd_t3_shield': ['lnd_t2_shield'], 'lnd_t1_scout': ['lnd_t1_scout', 'lnd_t1_bot']}
NOTE = {
    ('lnd_t1_scout', 'lnd_t1_scout'): 'bewaffneter Späher (A1)', ('lnd_t1_scout', 'lnd_t1_bot'): 'Raider fast auf LAB-Niveau, billiger als Späher + LAB',
    'lnd_t1_engineer': 'fragile Engineers (A9)', 'lnd_t2_engineer': 'A9', 'lnd_t3_engineer': 'A9',
    'lnd_t1_tank': 'Linie etwas stärker', 'lnd_t1_arty': 'Streuklang: teuer, fragil (A2)', 'lnd_t2_tank': 'schnell, Alpha-Schuss, weniger zäh (A3)',
    'lnd_t2_bot': 'schwerer Linienanker (A3)', 'lnd_t2_mml': 'eine schwere Rakete, RW 64 (A4)', 'lnd_t3_tank': 'Hybrid Direkt + Indirekt (A6); stärkster T3-Körper, langsam',
    'lnd_t3_sniper': 'zwei Modi (A6)', 'lnd_t3_aa': 'trifft auch Boden (A6)', 'lnd_t3_shield': 'Großschild erst T3 (A5)',
    'air_t1_bomber': 'eine Bombe, großer Splash (A10)', 'air_t2_gunship': 'teuer und zäh (A10), Referenz mit 2 Bordwaffen (R1)', 'air_t2_fbomber': 'schwere Einzelbombe, schwächerer Luftkampf (A10); FA-Relation ≈ −46 % Produkt',
    'str_t2_pd': 'Strahl, RW 50 (A7)', 'str_t2_shield': 'stärkerer Schild (A8)', 'str_t3_shield': 'A8', 'str_t2_aa': 'Vorbild-Flak schwächer',
    'str_t2_arty': 'teurer, fragiler', 'cmd_commander': 'wie Vogt, HP −4 % (A11)',
}
def dpm(x): return (x['balance']['dps'] or 0) / x['economy']['mass']
def hpm(x): return (x['health']['max'] + ((x['shield'] or {}).get('hp', 0))) / x['economy']['mass']
for u in U:
    s = u['id'].split(':')[1]
    for vs in MAP.get(s, [s]):
        v = VID.get('core:' + vs)
        if not v: continue
        dd = (dpm(u) / dpm(v) - 1) * 100 if dpm(u) and dpm(v) else None
        dh = (hpm(u) / hpm(v) - 1) * 100
        dp = ((1 + dd / 100) * (1 + dh / 100) - 1) * 100 if dd is not None else None
        note = NOTE.get((s, vs), NOTE.get(s, ''))
        if u['group'] in ('eco', 'fac', 'intel') and not note and abs(dh) < 25: continue
        A(f"| {u['role']['de']} | {u['name']['de']} | {v['name']['de']} | {n(u['economy']['mass'])} / {n(v['economy']['mass'])} | {pct(round(dd, 1) if dd is not None else None)} | "
          f"{pct(round(dh, 1))} | {pct(round(dp, 1) if dp is not None else None)} | {note} |")
A('')
eco_d = []
for u in U:
    s_ = u['id'].split(':')[1]; v = VID.get('core:' + s_)
    if v and u['group'] in ('eco', 'fac', 'intel') and not NOTE.get(s_):
        eco_d.append((hpm(u) / hpm(v) - 1) * 100)
A(f"Wirtschafts-, Hallen- und Intel-Gebäude ohne Eintrag haben dieselben Erträge und Upgrade-Zeiten wie Varkan, Kosten ±2 % und {pct(round(min(eco_d), 1))} … {pct(round(max(eco_d), 1))} HP/Mass "
  "(Vorbild-Gebäude etwas fragiler, am stärksten der Resonator III). Wirtschaft und Tech-Tempo sind damit symmetrisch. Die Varkan-Zange ist ein leichter FAF-Sturm-Bot (Roster-Auffüllung), "
  "kein direkter Gegenpart zum Brüller; der Vergleich zeigt nur die Gewichtsklasse.")
A('')
A('### 17.2 Post-MVP-Asymmetrien (⚑, rein additiv)'); A('')
A('| Feature-ID | Einheit | Vorbild-Verhalten | MVP-Verhalten ohne Feature |')
A('|---|---|---|---|')
for u in U:
    for pm in u['special'].get('postMvp', []):
        A(f"| **{pm['feature']}** | {u['name']['de']} | {pm['behavior']} | {pm['mvp']} |")
A('| **I5** | – (Reserve) | Tarnfeld-Generator als T2-Gebäude | nicht im Roster |')
A('| **U15 / U16 / U12** | – (Reserve) | Unterkantor, Experimental *Hymne*, T3-Luft *Kadenz* | nicht im Roster |')
A('')
A('Alle Werte in §4–§14 sind ohne diese Features gemessen. **K10 über das MVP hinaus** braucht die Fraktion nicht: nur Bubble-Schilde (Stille, Dämpfer), keine Personal Shields.')
A('')

# ---------------------------------------------------------------- 18 Abgleich faction.md
A('---'); A(''); A('## 18. Abgleich mit den vorläufigen Zielwerten aus `faction.md`'); A('')
A('Die Zielwerte in `faction.md` §9.2 und §11.1 stammten direkt aus der FA-Referenz. Das Roster weicht wie bei Varkan um einige Prozent ab und hält dabei alle Breakpoints; '
  '`faction.md` ist entsprechend angeglichen.')
A('')
A('| Einheit | Zielwert (faction.md, vorläufig) | Roster | Grund |')
A('|---|---|---|---|')
for r in [
    ('Triller', 'HP 280, 32 / 1,3 s', 'HP 285, 33 / 1,3 s', 'Triller → Triller 9 Treffer wie FA (30 Schaden hätte 10 ergeben), PD I 6, Horn 7'),
    ('Horn', 'HP 170, 45 / 2,8 s, Splash 1,5', 'HP 180, 44 / 2,8 s, Splash 1,6', 'Pulk +7,8 %, Einzelziel −2,2 %; Chorist 3 und Triller 7 Treffer bleiben'),
    ('Chorist', 'HP 125', 'HP 128', 'Pfiff → Chorist 32 Treffer (4 Schaden) wie FA; Horn 3, Triller 4, Kantor 2 bleiben'),
    ('Pfiff', 'HP 35', 'HP 36, RW 18', 'Pfiff ↔ Pfiff 9 Treffer wie FA'),
    ('Heuler', '200 / 3,3 s, HP 1.350', '210 / 3,5 s, HP 1.400', 'Alpha-Schuss etwas schwerer, gleiche DPS; Triller 2 Schüsse'),
    ('Brüller', 'HP 2.500, DPS 117', 'HP 2.550, 37 / 0,3 s = 123 DPS', 'Brüller → Triller 8 Treffer wie FA (36 Schaden hätte 9 ergeben)'),
    ('Posaune', '405 / 6 s, RW 65', '400 / 6 s, RW 64', 'Gabel II fällt nach 6 Raketen wie FA'),
    ('Stille', 'Schild 10.000', 'Schild 9.600, HP 450', 'HP+Schild/Mass −3,4 %'),
    ('Grollen', 'DPS/Mass +20 % zum Fallhammer (erste Fassung), dann +12 %', '+64 % (DPS 414)', 'Referenz ohne Torpedo (U18) mit beiden Direktwaffen (R1): 2×66 / 0,5 s + 600 / 4,0 s'),
    ('Diskant', 'DPS/Mass +78 % zur Reißnadel', '−3 % (schneller Modus), HP/Mass +19 %', 'Referenz-DPS nur ein Modus; spooky-db addiert beide Modi'),
    ('Zimbel', 'Luft 240 / Boden 56 DPS', 'Luft 233 / Boden 52,5 DPS', 'Zimbel → Schwebfliege 9 Treffer wie FA'),
    ('Schwebfliege', 'HP 1.800, 2×21 / 0,7 s', 'HP 1.850, 4×21 / 0,7 s = 120 DPS', 'Hochorgel → Schwebfliege 2 Salven wie FA; Referenz mit 2 Bordwaffen (R1)'),
    ('Schwärmer', 'Bombe 1.250, Luft 3×24 / 1 s', 'Bombe 1.200 / 10 s, Luft 6×24 / 1 s, HP 1.050', 'Produkt +0,8 %; Referenz mit 2 Luftwaffen (R1)'),
]:
    A('| ' + ' | '.join(r) + ' |')
A('')

# ---------------------------------------------------------------- 19 Offene Punkte
A('---'); A(''); A('## 19. Offene Punkte'); A('')
A('1. **Namespace:** `f4:` gegen `core:` (Varkan). Vor den Blueprints entscheiden, ob alle Fraktionen `f1…f4` bekommen; die Umbenennung ist dann ein Suchen/Ersetzen in `roster.json` und `gen.py` (`NS`).')
A('2. **Strahlwaffe (K1):** Gabel II und Zimbel sind als Hitscan-Pulse notiert (`salvo` = Pulse). Vor MS8 im Waffenmodell entscheiden; Fallback für Gabel II steht in der Waffennotiz (Projektil 600 / 4,0 s).')
A('3. **Draw-Budget:** 28 Visuals pro Fraktion, im 1v1 zweier Fraktionen bis zu 56 aktiv (DECISIONS 17: 40). Render-Bench vor MS14.')
A('4. **FA-Datenstand:** spooky-db 3810 gegen FAF `develop` weicht bei zwei Referenzen ab (§1: Strahl-PD −9 % DPS, Präzisionsläufer RW +5; der Belagerungsgleiter war ein Extraktionsfehler, R1). '
  'Vor MS9 mit dem dann aktuellen Stand nachziehen (`ref.py` gegen neue Daten, dann `gen.py` und `validate.py`).')
A('5. **Luft-Balance zwischen den Fraktionen:** Nach R1 liegt die Schwebfliege bei Δ Produkt ≈ −12 % zur Varkan-Krähe (vorher −56 %). '
  'Der Schwärmer liegt nach der Varkan-Korrektur (Elster-Luftkanonen 2 × 70, fraktionsübergreifender Abgleich `docs/design/factions/README.md` §5.4) bei ≈ −44 % Produkt zur Elster; '
  'das entspricht der FA-Relation der Referenzen (≈ −46 %). Der Schwärmer ist also bewusst der schwächere Luftkämpfer mit der schwereren Bombe (A10). MS12 prüft im Spiegel- und Kreuz-Match.')
A('6. **Modus-Toggle (Diskant):** braucht C17 „Modus“ neben Schild/Stealth/Auto-Overcharge.')
A('7. **Abgleich mit f2/f3:** erledigt (§20 und fraktionsübergreifender Abgleich, `docs/design/factions/README.md` §4): Namenskollisionen behoben, Formbedeutungen konsistent, Kreuz-Silhouettenpaare ergänzt. '
  'Perlglas ist auf kühles Eisweiß `#D5DCE2` gesetzt (vorher `#E6E0D2`, fast gleich dem warmen Perlmutt der f3). Amber (≈ 37°, 25–35 % Fläche) und das Gold der f3 (≈ 43°, ≤ 8 % Kanten) bleiben: '
  'Die Fraktionen trennen sich über das dominante Material (Bernstein auf Pechglas gegen helles Perlmutt) und die Leuchtfarbe (Phasenblau gegen Goldlicht/Jade). Der Graustufen-Test Triller ↔ Kauri und Horn ↔ Dünung (§16) bleibt MS9-Abnahme.')
A('8. **Schema:** `special.postMvp`, `balance.fa.dpsWeapons`, `checks.hitsToKill[].fa.weaponIdx` und `silhouettePairs.crossFaction` sind Erweiterungen gegenüber dem Varkan-JSON (optional, rückwärtskompatibel). '
  'Dazu die Placeholder-Erweiterungen aus `faction.md` §3.6 (neue PartKeys, `legs.count`, Kristall ohne Spitze für die Bernsteinkammer).')
A('9. **Superset-Zählung:** Wie bei Varkan zählt die Vereinigung nach (Part, Material); gleiche Parts an verschiedenen Positionen (z. B. Pfeifen gestufter Länge) beim Mesh-Bau erneut prüfen.')
A('10. **Namen:** Markenrecherche „Aurith“ und aller Rufnamen offen; FA-Namens-Grep erledigt (faction.md §7.1).')
A('11. ~~**`WeaponNumber` in den anderen Fraktionen**~~ erledigt im fraktionsübergreifenden Abgleich (`docs/design/factions/README.md` §5.4): `fa_ref.json` von Varkan, f2 und f3 zählen '
  '`DEA0202`, `URA0102` und `UAA0102` jetzt doppelt (gegen FAF `develop` geprüft); Elster, Bremse (f2) und Raubmöwe (f3) sind nachgezogen. §17.1 ist neu erzeugt.')
A('')

# ---------------------------------------------------------------- 20 Review-Entscheidungen
A('---'); A(''); A('## 20. Review-Entscheidungen (2026-09-29)'); A('')
A('Kritisches Review nach dem ersten Roster-Stand: Balance nachgerechnet, Lesbarkeit, Eigenständigkeit gegenüber FA, Vollständigkeit. '
  'Berechtigte Punkte sind eingearbeitet (`gen.py`, `md.py`, `ref.py`, `validate.py`, `faction.md`); danach `gen.py → md.py → validate.py` ohne Verstöße.')
A('')
A('| # | Bereich | Befund | Entscheidung | Wirkung |')
A('|---|---|---|---|---|')
for r in [
    ('R1', 'Balance / Daten', 'spooky-db speichert gleiche Doppelwaffen als **einen** Eintrag mit `WeaponNumber` 2; `ref.py` ignorierte das Feld. '
     'Drei f4-Referenzen waren untergezählt: T3-Belagerungsgleiter 284 statt 412 DPS, T2-Gunship 57 statt 114, T2-Jagdbomber 200 statt 275. '
     'Die im ersten Bericht als „FAF-Änderung +45 %“ gemeldete Abweichung des Belagerungsgleiters war genau dieser Fehler.',
     '`ref.py` multipliziert mit `WeaponNumber` und schreibt `weapons[].count`. Grollen: Gabel feuert beide Zinken (2×66 / 0,5 s). '
     'Schwebfliege: Bauchgabel 4×21 / 0,7 s. Schwärmer: Luftwaffe aus beiden Gondeln 6×24 / 1 s. Kitbash unverändert.',
     'Grollen 282 → 414 DPS (Δ FA +0,4 %), Schwebfliege 60 → 120 (+5 %), Schwärmer 192 → 264 (−4 %). Kreuz-Relation Luft: −56 % → −12 % (Krähe), −46 % → −26 % (Elster). Varkan/f2/f3 betroffen (§19 Nr. 11).'),
    ('R2', 'Balance: T1-Rush gegen Kommandant', 'Simulation (Kommandant 100 Schaden/s auf das vorderste Ziel, Regeneration 10/s, ohne Aufschrei): '
     '18 Triller (972 M) töten den Vogt in 49 s, 19 Punzen (1.064 M) töten den Kantor in 42 s (Vogt: 47 s). Artillerie außerhalb der Kommandanten-RW (540 M): '
     '10 Hörner gegen Vogt 82 s, 15 Kellen gegen Kantor 73 s.',
     'Keine Änderung. Kantor bleibt bei HP 11.500 (FA-Relation, wie f2/f3 ihre Kommandanten ebenfalls nach Vorbild setzen). Der Aurith-Tank-Rush ist ≈ 9 % billiger, '
     'der Kantor fällt ≈ 11 % schneller: das hebt sich im Rahmen der ±15-%-Methodik auf.',
     'Rush-Timing symmetrisch innerhalb ±12 %. MS9-KI-Test: Rush-Abwehr mit Aufschrei in beiden Richtungen.'),
    ('R3', 'Balance: Opening ohne I5', 'Der Pfiff ist der schwächere Raider (Produkt −25 % zum Stichel, seit dem FA-gleichen Stichel −23 %) und verliert im MVP seine Vorbild-Kompensation (Tarnung, I5). '
     'Gleichzeitig sind Aurith-Engineers anfälliger: Stichel → Chorist 5,4 s, Pfiff → Lehrling 11,7 s. `faction.md` §9.3 behauptete das Gegenteil '
     '(„Pfiffe töten Engineers, Gegner braucht früh PD“).',
     'Keine Wertänderung: Pfiff ↔ Pfiff 9 und Pfiff → Chorist 32 Treffer pinnen HP 36 und Schaden 4; Mass 19 hätte Produkt +14 % (zu nah am Gate). '
     'Konter statt Kompensation: Der Triller tötet einen Stichel in 2 Schüssen (1,3 s; vor dem fraktionsübergreifenden Abgleich 3 Schüsse bei 70 HP), der Stichel braucht 41 Treffer (12 s). §9.3 korrigiert.',
     'MS9-Kriterium: Aurith-Engineer-Verluste bis 5:00 im Kreuz-Match gegen ein LAB-Opening ≤ 1,5 × Spiegel-Match. Sonst Hebel: Pfiff Mass 19 oder Triller-Eskorte in der KI.'),
    ('R4', 'Balance: Eco-Kurve', 'Engineers, Stimmstock, Resonator, Hallen, Upgrades: gleiche Kosten, Erträge, Build Power und Upgrade-Zeiten wie Varkan (§15); nur HP 0 … −21 %. '
     'T2-Durchsatz an Halle II: Brüller 360 M / 40 s = 9,0 M/s, Varkan-Meißel 200 M / 22,5 s = 8,9 M/s.', 'Keine Änderung.', 'Eco- und Tech-Tempo symmetrisch.'),
    ('R5', 'Balance: Konter T3', 'Nach R1 ist Grollen Δ Produkt +47 % zum Varkan-Fallhammer. Einordnung: f2-T3-Läufer ≈ +49 %, f3 ≈ +11 % zum Fallhammer; der Fallhammer ist der Ausreißer nach unten.',
     'Wert bleibt (Vorbild-Relation), Konter dokumentiert: langsam (2,8), RW 22/28 gegen Heerhorn (RW 88) und Präzisionsläufer (RW 55–65); keine Flugabwehr.',
     'MS13-Prüfpunkt: T3-Kreuz-Match; Hebel wäre die Indirektwaffe (Nachladezeit), nicht die Gabel.'),
    ('R6', 'Lesbarkeit: Winkel-Code', '`faction.md` §5.1 sagte „Mast = Intel … nie mit Reif“, Stille und Dämpfer sind aber Mast + Reif; der Gunship trägt senkrechte Reifen.',
     'Präzisiert: Mast + Muschel-Schale = Intel, Mast + **waagerechter** Reif = Schild, Reif ohne Mast = Flow-Anschluss, **senkrechte** Reifen nur als Luft-Antrieb.', 'Keine Datenänderung.'),
    ('R7', 'Lesbarkeit: Pflichtpaare', 'Pfiff und Triller sind beide ● Direktfeuer-Gleiter auf demselben Kiel, aber sehr verschiedene Bedrohungen; das Paar fehlte.',
     'MS9-Pflichtpaar Pfiff ↔ Triller ergänzt (kleinster Kiel mit hohem Mast und kurzer Gabel gegen lange Gabel über die Kielspitze).', '11 MS9-Paare (Varkan 9).'),
    ('R8', 'Lesbarkeit: Pfiff-Icon', 'Glyphe `bot` zeigt Beinstriche, der Pfiff gleitet.',
     'Bleibt `land_bot_t1`: `land_direct_t1` würde mit dem Triller verschmelzen, `intel` würde den Raider verstecken. Gelesen wird die Glyphe fraktionsübergreifend als „leichter Direktfeuer-Raider“.',
     'Vorschlag für die gemeinsame Grammatik (Varkan `faction.md` §6.3): Bedeutung von `bot` so formulieren.'),
    ('R9', 'Lesbarkeit: fraktionsübergreifend', 'f3 nutzt dieselben Formbedeutungen (Horn = Artillerie, Sichel = Bauen, senkrecht = Flugabwehr) und ebenfalls schwebende, helle Körper.',
     'Kreuz-Paare ergänzt: Triller ↔ f2-T1-Panzer, Triller ↔ f3-T1-Panzer, Horn ↔ f3-T1-Artillerie.', 'Formbedeutung konsistent (gut); Farbnähe zu f3 als §19 Nr. 7 offen.'),
    ('R10', 'Eigenständigkeit: Namen', 'Zwei Kollisionen mit den Parallel-Fraktionen: „Hummel“ (f2-Gunship) und „Muschel“ (f3-Mobilschild).',
     'T1-Bomber **Maikäfer / Cockchafer** (breite Deckflügel = Fächer-Silhouette). Radar **Widerhall I–III / Reverb I–III**. „Echo“ verworfen (FA-Sonarname). IDs unverändert.',
     '`validate.py` prüft jetzt Namensgleichheit gegen alle vorhandenen Fraktions-Roster.'),
    ('R11', 'Eigenständigkeit: Begriffe', '`faction.md` nannte in §10.2 FA-Fraktionsnamen und in §2.4 konkrete FA-Waffen-Wortstämme; „Kettenblitz“ übersetzte das Konzept der FAF-Referenzeinheit.',
     'FA-Namen durch neutrale Beschreibungen ersetzt, Wortstamm-Liste durch Verweis auf den Grep (§7.1). Projektiltyp der Zimbel heißt jetzt „Entladungsbogen“.', 'Kein FA-Eigenname mehr in f4-Texten außerhalb `faReference` (dev-only).'),
    ('R12', 'Passung zum Vorbild', 'Amber/Blauleuchten, geschwungene Körper, Gleiter, Hybride, wenige große Einheiten treffen die Vorbild-Designsprache. Kein Design ist kopiert: Kommandant als armloses Dreibein, Lore als Ureinwohner, echte DE/EN-Wörter.',
     'Keine Änderung. Die Assoziation „Chor“ ↔ Engelschöre ist ein allgemeines Motiv, kein FA-Inhalt; §2.3 schließt Heiligenpathos aus.', '–'),
    ('R13', 'Vollständigkeit', 'Alle Varkan-Feature-IDs und Rollen sind belegt; `lnd_t1_bot`, `lnd_t2_shield`, `lnd_t3_bot` sind auf Pfiff, Stille und Grollen abgebildet (§2.1). Keine MVP-Rolle fehlt.',
     'Keine Änderung.', '49 Blueprints, 26 ●, 28 Visuals, 19 Glyphen.'),
]:
    A('| ' + ' | '.join(r) + ' |')
A('')
(ROOT / 'docs/design/factions/f4/roster.md').write_text('\n'.join(L) + '\n')
print(len(L), 'Zeilen')
