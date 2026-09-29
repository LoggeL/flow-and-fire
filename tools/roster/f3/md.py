# Erzeugt docs/design/factions/f3/roster.md aus docs/design/factions/f3/roster.json (Fraktion f3 „Orden von Sael“).
# Aufbau wie tools/roster/md.py (Varkan); Aufruf: python3 tools/roster/f3/md.py
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
D = json.load(open(ROOT / 'docs/design/factions/f3/roster.json'))
VK = json.load(open(ROOT / 'docs/design/roster.json'))
U = D['units']
UID = {u['id']: u for u in U}
VKID = {u['id']: u for u in VK['units']}
ALL = {**UID, **VKID}


def n(x, d=None):
    if x is None: return '–'
    if isinstance(x, bool): return 'ja' if x else 'nein'
    if isinstance(x, (int,)) or (isinstance(x, float) and x.is_integer() and d is None):
        return f'{int(x):,}'.replace(',', '.')
    if d is None: d = 2
    s = f'{x:.{d}f}'.rstrip('0').rstrip('.') if '.' in f'{x:.{d}f}' else f'{x:.{d}f}'
    if '.' in s:
        a, b = s.split('.')
        a = f'{int(a):,}'.replace(',', '.') if a.lstrip('-').isdigit() else a
        return a + ',' + b
    return f'{int(s):,}'.replace(',', '.')


def pct(x):
    if x is None: return '–'
    return ('+' if x > 0 else '±' if x == 0 else '−') + n(abs(x), 1) + ' %'


def dot(u): return '●' if u['ms9Core'] else '○'
def nm(i): return ALL[i]['name']['de']
def fx(i): return 'Sael' if i.startswith('f3:') else 'Varkan'


def weapons(u):
    out = []
    for w in u['weapons']:
        sal = f"{w['salvo']}×" if w['salvo'] > 1 else ''
        rng = (n(w['rangeMin']) + '–' if w.get('rangeMin') else '') + n(w['range'])
        sp = f", Splash {n(w['splash'], 2)}" if w.get('splash') else ''
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
    st = f"{k['techStripes']} Streifen (Tiefjade)" if k['techStripes'] else 'keine Streifen'
    hv = f" · Schwebehöhe {n(u['motion']['hoverHeightView'], 2)} WU" if u['motion'].get('hoverHeightView') else ''
    return f"{', '.join(ps)} — {k['partCount']} Parts, {k['animatedParts']} anim., ≈ {k['trisEstimate']} Tris · {msc} · {st}{hv}"


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
    for p in s.get('postMvp', []):
        if p['feature'] == 'M13' and p['what'].startswith('Schweben über Wasser'):
            continue  # Sammelhinweis in §16
        bits.append(f"**Post-MVP {p['feature']}:** {p['what']} — *MVP:* {p['fallback']}")
    return '<br>'.join(bits)


def hk(u):
    h = u['hotbuild']
    return f"{h['menu']}: {h['slot']}" if h else '–'


GAIT = {'hover': 'Schweber', 'walker': 'Läufer', 'air': 'Luft'}


def mv(u):
    m = u['motion']
    if m.get('structure'): return '–'
    g = f" · {GAIT[m['gait']]}" if m.get('gait') else ''
    return f"{n(m['speed'], 1)} / {n(m['turnRateDeg'])}°{g}"


def fp(u):
    m = u['motion']
    f = f"{m['footprint'][0]}×{m['footprint'][1]}"
    return f + (f" / s{m['sizeClass']}" if 'sizeClass' in m else '')


def intel(u):
    i = u['intel']
    s = n(i.get('vision'))
    if i.get('radar'): s += f" / R {n(i['radar'])}"
    return s


def hp_s(u):
    k10 = next((p for p in u['special'].get('postMvp', []) if p['feature'] == 'K10'), None)
    return n(u['health']['max']) + (' (HP+Schild)' if k10 else '')


L = []
A = L.append
c = D['counts']
A('# Roster: Orden von Sael (Fraktion f3, MVP)')
A('')
A('> **Status:** Startwerte für alle MVP-Blueprints der dritten Fraktion auf Basis von `docs/design/factions/f3/faction.md`, überarbeitet nach dem Review vom 2026-09-29 (§21). Maschinenlesbar in `docs/design/factions/f3/roster.json` (Schema `faf-roster/1`, dasselbe wie Varkan). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts**; dieses Dokument ist daraus generiert (`tools/roster/f3/md.py`). Später Grundlage der Blueprints (`content/blueprints/f3/…`).')
A(f"> **Umfang:** **{c['total']} Blueprints** ({c['mobile']} mobil, {c['structures']} Gebäude, jede Upgrade-Stufe einzeln), davon **{c['ms9Core']} im MS9-Kern (●)**, Rest bis MS14 (○). Rollen, Rollen-Tokens, Icon-IDs, Hotbuild-Slots, Visual-IDs und ●/○-Status sind **identisch zu Varkan** (`docs/design/roster.md`); der Generator erzwingt das. {c['visuals']} Visuals, {c['iconGlyphs']} Icon-Glyphen. Waffen-, Projektil- und Basis-BPs sind nicht mitgezählt.")
A('> **Ausgeschlossen (Post-MVP laut features.json):** wie Varkan (TML/TMD, Nukes/SMD, Transporter U13, T3-Luft U12, Marine U17/U18, Experimentals, E15, SACU U15, ACU-Enhancements U14, Stealth/Omni I4/I5). Reservenamen: *Nautilus* (T3-Schwebepanzer), *Perle* (Experimental).')
A('> **Balancing:** Hartes Gate PLAN U3: DPS/Mass und HP/Mass je ±25 % der FA-Referenz **der Vorbild-Fraktion**. Der Generator erzwingt strenger: Einzelachsen, Produkt und Pulk-DPS/Mass der Artillerie je ±15 %, eine Treffer-bis-Tod-Matrix exakt nach Vorbild und **Kreuz-Breakpoints gegen Varkan** (`faction.md` §9.4). Asymmetrien mit Post-MVP-Mechanik sind je Blueprint in `special.postMvp` markiert; die Kern-Balance gilt mit dem MVP-Fallback.')
A('')
A('---')
A('')
A('## 1. Quellen und Methodik')
A('')
A('- **Methodik:** wie Varkan (`docs/design/roster.md` §1): Δ = (unser Wert / FA-Wert − 1) × 100, Produkt, Pulk-Modell π · (Splash + 0,5)² / 4, Treffer bis Tod = ⌈Ziel-HP / Salvenschaden⌉, `reloadS` auf 0,1-s-Ticks, Maßstabsregeln, Superset-Visuals. Unterschiede stehen unten.')
A('- **FA-Referenz:** die Einheit der **Vorbild-Fraktion** derselben Rolle, aus `tools/roster/f3/fa_ref.json` ([spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json`, Datenstand 3810, DPS nach `app/js/dps.js`). Die Varkan-Referenz derselben Rolle steht als Gegenprobe in `faReference.crossCheckBp`. Wo das Vorbild keine Einheit hat (T2-Läufer, Jagdbomber, T3-Präzision), steht die Wahl in `faReference.role`. Nur Blueprint-IDs und generische Rollenbezeichnungen werden zitiert; `faReference` ist dev-only.')
A('- **Personal-Schilde:** Bei Zielen mit Personal-Schild (Vorbild-T2-Panzer, T3-Läufer; Varkan-Seite: T3-Referenz) zählt der Schild in der FA-Treffer-Rechnung zur Ziel-HP. Im Roster steckt er bis K10 in `health.max` (Fallback, §16).')
A('- **Kreuz-Breakpoints:** `checks.crossHitsToKill` rechnet Waffen der einen Fraktion gegen Ziele der anderen: unsere Werte (Sael-Roster bzw. Varkan-`roster.json`) gegen die FA-Referenzen beider Rollen (`tools/roster/f3/fa_ref.json` bzw. `tools/roster/fa_ref.json`). `required: true` muss exakt passen; `required: false` sind Info-Paare, bei denen Varkan selbst von FA abweicht.')
A('- **Prüfung:** `tools/roster/f3/gen.py` erzeugt `roster.json` und bricht bei jedem Gate-Verstoß ab; `tools/roster/f3/validate.py` rechnet alles unabhängig aus den Rohfeldern nach (auch Kreuz-Breakpoints, Monopol-Lints, FA-Begriffe in Anzeigefeldern) und endet mit Exit 1 bei Verstoß.')
A('- **Kitbash:** Parts aus `faction.md` §3.3; `[mat]` = `team`, `gold`, `glow`, `jade`, sonst `body` (Perlmutt). Tris: `shell` 60, `hoverpad` 32, `legs` 60, `orb` 80, `lance` 12, `horn` 32, `spine` 10, `sickle` 48, `ring` 72, `arch` 36, `mast` 24, `fan` 16, `lantern` 64, `wing` 16. Lints (§5.3 Nr. 6): `spine` nur Flugabwehr am Boden, `horn` nur `ARTILLERY`, `lance` nur mit `orb`, höchstens eine `orb`, `orb` ohne `lance` nur in Flow-Kategorien, `lantern`/`sickle`/`glow` nur ECONOMIC, FACTORY, ENGINEER, `hoverpad` genau bei Schwebern, mindestens ein Team-Part.')
A('- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein laut PLAN §5 · RW = Reichweite · s = sizeClass · Sicht / R = Radar · Gangart Schweber/Läufer/Luft (`motion.gait`).')
A('')
A('### 1.1 Prüfung der auffälligen spooky-Werte gegen FAF `develop`')
A('')
A('Geprüft gegen [FAForever/fa](https://github.com/FAForever/fa) `develop`, `units/<BP>/<BP>_unit.bp` (Stand 2026-09-29). Korrekturen stehen in `conventions.faOverrides` und werden von Generator und Prüfer gleich angewendet.')
A('')
A('| BP | Rolle | spooky 3810 | develop | Ergebnis |')
A('|---|---|---|---|---|')
for r in D['conventions']['faDevelopCheck']:
    A(f"| `{r['bp']}` | `{r['role']}` | {r['spooky']} | {r['develop']} | {r['verdict']} |")
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
A('- Dieselbe Herleitung wie Varkan: 23 Blueprints folgen aus PLAN MS4–MS8, drei sind Daten-Vorgriffe (Schrein ab MS6 für den Glanzstoß, Zisterne, Quellbogen). Hochlilie ist ●, in MS8 per Konsole/Test-Szenario gespawnt, baubar ab MS13 (Kustos).')
A('- **Kreuz-Matches** (U19/U22) setzen beide Kerne voraus; der Sael-Kern deckt dieselben 26 Rollen ab wie der Varkan-Kern.')
A('')
A('### 2.1 Abgrenzungen und Abweichungen')
A('')
A('| Punkt | Festlegung | Grund |')
A('|---|---|---|')
A('| Rollen, ●/○, Hotbuild, Icons, Visual-IDs | identisch zu Varkan | Muskelgedächtnis und gemeinsame Icon-Grammatik (`faction.md` §6, §7.3); vom Generator erzwungen |')
A('| Perlmutt III | Upgrade von Perlmutt II wie Varkan | gleicher Hotbuild-Weg; das Vorbild baut den T3-Schild neu. Kosten = Vorbild-Neubaukosten als Upgrade-Kosten (Gesamt 2.880 statt 2.400 Mass). |')
A('| Languste (T2-Läufer) | Relation der schnellen T2-Sturmeinheit des Vorbilds (Schwebepanzer) | Vorbild hat keinen T2-Bot; Asymmetrie A7 |')
A('| Raubmöwe (Jagdbomber) | FAF-T2-Jagdbomber als Referenz (wie Varkan), Vorbild-T2-Luftkampf als Gegenprobe | Vorbild hat keinen Jagdbomber |')
A('| Konus | schwebt statt zu laufen | Sael-Identität; Icon `land_sniper_t3` bleibt (Glyphe = Rolle) |')
A('| DoT-Waffen des Vorbilds (Woge, Brandung, Sintflut) | ein Einschlag mit derselben Schadenssumme | kein DoT-System im MVP; Breakpoints und Pulk bleiben gleich |')
A('')
A('---')
A('')
A('## 3. Hotbuild-Raster (identische Slots wie Varkan)')
A('')
A(D['hotbuildGrid']['rule'])
A('')
g = D['hotbuildGrid']
for menu in ('Landkapitel', 'Luftkapitel', 'Bau'):
    title = {'Landkapitel': 'Landkapitel (Fabrik-Menü)', 'Luftkapitel': 'Luftkapitel (Fabrik-Menü)', 'Bau': 'Bau-Menü (Prior und Engineers)'}[menu]
    A(f'**{title}**')
    A('')
    A('| | Q / A / Z | W / S / X | E / D / C | R / F / V | T / G / B |')
    A('|---|---|---|---|---|---|')
    for keys, lab in (('QWERT', 'Reihe 1'), ('ASDFG', 'Reihe 2'), ('ZXCVB', 'Reihe 3')):
        cells = [f"**{k}** {g[menu][k]}" if k in g[menu] else '–' for k in keys]
        if all(x == '–' for x in cells): continue
        A(f'| {lab} | ' + ' | '.join(cells) + ' |')
    A('')

GROUPS = [('cmd', '4. Prior und Engineers'), ('land1', '5. Landarmee T1'), ('land2', '6. Landarmee T2'),
          ('land3', '7. Landarmee T3'), ('air', '8. Luftwaffe T1–T2'), ('eco', '9. Wirtschaft'), ('fac', '10. Kapitel (Fabriken)'),
          ('def', '11. Verteidigung'), ('intel', '12. Intel und Schilde'), ('arty', '13. Artilleriestellungen')]


def grp(u):
    return f"land{u['tech']}" if u['group'] == 'land' else u['group']


for key, title in GROUPS:
    us = [u for u in U if grp(u) == key]
    A('---'); A(''); A(f'## {title}'); A('')
    A('**Stammdaten**'); A('')
    A('| | ID | DE / EN | Rolle | FA-Referenzrolle (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Footprint | Sicht / Radar | Hotbuild | Icon |')
    A('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for u in us:
        e = u['economy']; f = u['faReference']
        ref = f"{f['role']} (`{f['bp']}`" + (f", Gegenprobe `{f['crossCheckBp']}`" if f.get('crossCheckBp') else '') + ')'
        A(f"| {dot(u)} | `{u['id']}` | **{u['name']['de']}** / {u['name']['en']} | {u['role']['de']} / {u['role']['en']} | {ref} | {u['msFirst']} | "
          f"{n(e['mass'])} / {n(e['energy'])} / {n(e['buildTime'])} | {hp_s(u)} | {mv(u)} | {fp(u)} | {intel(u)} | {hk(u)} | `{u['icon']}` |")
    A('')
    A('**Waffen und Balance** (Δ gegenüber FA-Referenz der Vorbild-Fraktion)'); A('')
    A('| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt |')
    A('|---|---|---|---|---|---|---|')
    for u in us:
        b = u['balance']; fa = b['fa']
        hpb = ' (inkl. Schild)' if b['hpBasis'] != 'HP' else ''
        pk = f"<br>Pulk-DPS/Mass {n(b['pulk']['pulkDpsPerMass'], 3)} (FA {n(b['pulk']['faPulkDpsPerMass'], 3)}): {pct(b['pulk']['devPct'])}" if b.get('pulk') else ''
        wn = ''.join(f"<br>*{w['ref'].split(':')[1]}:* {w['notes']}" for w in u['weapons'] if w.get('notes'))
        A(f"| `{u['id'].split(':')[1]}` | {weapons(u)}{pk}{wn} | {n(b['dpsPerMass'], 3)} ({n(fa['dpsPerMass'], 3)}) | {pct(b['devDpsPerMassPct'])} | "
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
A('---'); A('')
A('## 14. Balance-Übersicht und Gates'); A('')
devs_d = [(u['balance']['devDpsPerMassPct'], u['name']['de']) for u in U if u['balance']['devDpsPerMassPct'] is not None]
devs_h = [(u['balance']['devHpPerMassPct'], u['name']['de']) for u in U]
devs_p = [(u['balance']['devProductPct'], u['name']['de']) for u in U if u['balance']['devProductPct'] is not None]
mx = lambda xs: max(xs, key=lambda x: abs(x[0]))
avg = lambda xs: round(sum(d for d, _ in xs) / len(xs), 1)
A(f"- **DPS/Mass:** {len(devs_d)} bewaffnete Einträge, größte Abweichung {pct(mx(devs_d)[0])}, Mittelwert {pct(avg(devs_d))}. Die Waffen folgen der Vorbild-Relation exakt; Feinabstimmung läuft nur über HP.")
A(f"- **HP/Mass:** {len(devs_h)} Einträge, größte Abweichung {pct(mx(devs_h)[0])} ({mx(devs_h)[1]}), Mittelwert {pct(avg(devs_h))}.")
A(f"- **Produkt DPS/Mass × HP/Mass:** größte Abweichung {pct(mx(devs_p)[0])} ({mx(devs_p)[1]}), Mittelwert {pct(avg(devs_p))}. Gate ±15 %.")
A(f"- **Globale Verschiebung wie Varkan:** HP/Mass im Mittel {pct(avg(devs_h))} (Varkan +4,3 %), DPS/Mass {pct(avg(devs_d))} (Varkan −1 %). Beide Fraktionen verlängern Gefechte also um ungefähr gleich viel; die Kreuz-Relationen bleiben erhalten.")
A('- **HP-Werte mit Breakpoint-Bindung:** Knallkrebs 116 (17 Stichel-, 5 Punze-Treffer), Kauri 170 (7 Punze-, 4 Riegel-I-, 2 Vogt-Treffer), Triton 2.750 (40 Meißel-, 28 Vogt-, 14 Riegel-II-Salven), Riff I 1.300 (13 Kelle-, 7 Dünung-Treffer), Raubmöwe 1.200 (1 Hochlilie-/Hochrost-Salve).')
A('- **Größte HP-Aufschläge** liegen bei winzigen Werten (Seeschwalbe 28 statt 25, Warte 11 statt 10, Glimmer 22 statt 20), wie bei Varkan. Sie ändern keinen Breakpoint.')
A('')
A('**Pulk-DPS/Mass (Artillerie, Gate ±15 %)**'); A('')
A('| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |')
A('|---|---|---|---|---|---|')
for u in U:
    p = u['balance'].get('pulk')
    if not p: continue
    w = u['weapons'][0]
    A(f"| {u['name']['de']} | {(str(w['salvo']) + '×') if w['salvo'] > 1 else ''}{n(w['damage'])} / {n(w['reloadS'], 1)} s | {n(p['splash'], 2)} ({n(p['faSplash'], 2)}) | {n(p['pulkDpsPerMass'], 3)} ({n(p['faPulkDpsPerMass'], 3)}) | {pct(p['devPct'])} | {pct(u['balance']['devDpsPerMassPct'])} |")
A('')


def htk_table(rows, cross=False):
    A('| ' + ('Pflicht | ' if cross else '') + 'Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |')
    A('|' + ('---|' if cross else '') + '---|---|---|---|---|---|')
    for h in rows:
        f = h['fa']
        who = f"{nm(h['attacker'])} ({fx(h['attacker'])}) → {nm(h['target'])} ({fx(h['target'])})" if cross else f"{nm(h['attacker'])} → {nm(h['target'])}"
        req = ('ja | ' if h.get('required', True) else 'Info | ') if cross else ''
        A(f"| {req}{who} | {n(h['salvoDamage'])} / {n(h['targetHp'])} | {h['hits']} ({n(h['ttkS'], 1)} s) | {n(f['salvoDamage'])} / {n(f['targetHp'])} | {f['hits']} ({n(f['ttkS'], 1)} s) | {'✓' if h['match'] else '✗'} |")
    A('')


A('**Treffer-bis-Tod-Matrix (Pflicht: exakt Vorbild)**'); A('')
htk_table(D['checks']['hitsToKill'])
x = D['checks']['crossHitsToKill']
A(f"**Kreuz-Breakpoints gegen Varkan (`checks.crossHitsToKill`, `faction.md` §9.4)** — {sum(h['match'] for h in x if h['required'])}/{sum(h['required'] for h in x)} Pflichtpaare exakt, "
  f"{sum(h['match'] for h in x if not h['required'])}/{sum(not h['required'] for h in x)} Info-Paare exakt.")
A('')
htk_table(x, cross=True)
A('Die zwei abweichenden Info-Paare gehen auf den Konflikt zwischen Varkans Punze (28 statt 24 Schaden) und der Kauri-HP zurück: Stichel → Kauri braucht 25 statt 23 Treffer, Punze → Dünung 6 statt 7. Sie auf Sael-Seite zu „reparieren“ würde Pflichtpaare brechen (Kauri: Punze verlangt HP 169–196, Stichel 155–161). Der dritte Punkt (Sturmvogel → Turmfalke 6 statt 7) ist im fraktionsübergreifenden Abgleich behoben: Turmfalke 295 HP wie FA, Sturmvogel 285 HP wie FA (`docs/design/factions/README.md` §5.4, N×N-Prüfer `tools/roster/cross.py`).')
A('')
A('**Schildbrechen (Info, ein einzelner Schütze, mit Regenerations-Verzögerung)** — zeigt Asymmetrie A5: Sael-Schilde halten Varkans Takt-Artillerie, Sael-Einzelschüsse brechen Varkan-Schilde schneller.')
A('')
A('| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild-HP |')
A('|---|---|---|')
for s in D['checks']['shieldBreak']:
    ours = f"{s['shots']} ({n(s['timeS'])} s)" if s['shots'] else 'bricht allein nicht'
    theirs = f"{s['faShots']} ({n(s['faTimeS'])} s)" if s['faShots'] else 'bricht allein nicht'
    A(f"| {nm(s['attacker'])} ({fx(s['attacker'])}) → {nm(s['target'])} ({fx(s['target'])}) | {ours} | {theirs} |")
A('')

rs = D['checks']['rush']
A(f"**T1-Rush gegen den Kommandanten (`checks.rush`, Review 2026-09-29)** — {sum(r['match'] for r in rs if r['required'])}/{sum(r['required'] for r in rs)} Pflicht-Paarungen wie FA, "
  f"{sum(r['match'] for r in rs if not r['required'])}/{sum(not r['required'] for r in rs)} Info-Paarungen wie FA. Mindestzahl gleichzeitig feuernder T1-Einheiten, die den Kommandanten im offenen Schlagabtausch töten; "
  "Modell in `tools/roster/f3/rush.py` (Regeneration 10 HP/s, Sonderschuss ab 7.500 E, Start 13.900 E, +120 E/s, kein Kiten).")
A('')
A('| Pflicht | Angreifer → Kommandant | ohne Sonderschuss | mit Sonderschuss | Mass (ohne / mit) | FA (ohne / mit) | ✓ |')
A('|---|---|---|---|---|---|---|')
for r in rs:
    A(f"| {'ja' if r['required'] else 'Info'} | {nm(r['attacker'])} ({fx(r['attacker'])}) → {nm(r['commander'])} ({fx(r['commander'])}) | {r['n']} | {r['nOc']} | "
      f"{n(r['mass'])} / {n(r['massOc'])} | {r['fa']['n']} / {r['fa']['nOc']} | {'✓' if r['match'] else '✗'} |")
A('')
A('Lesart: Sael braucht für den Vogt 21–22 Kauri (≈ 1.130–1.190 Mass), Varkan für den Prior 18–19 Punzen (≈ 1.010–1.060 Mass). Der Prior ist also rund 11 % billiger zu überrennen, wie das Vorbild-ACU (8 % weniger HP). Ausgleich: Kauri (RW 26) überreichen beide Kommandanten (RW 22) und können kiten, Punzen (RW 18) nicht. Die absoluten Zahlen hängen am Sonderschuss-Modell (Varkan-Review nannte 19 / 22); gegated wird nur die Gleichheit zur FA-Paarung.')
A('')

# ---------------------------------------------------------------- 15 Asymmetrie-Nachweis
A('---'); A('')
A('## 15. Asymmetrie-Nachweis gegen Varkan'); A('')
A('Verhältnis Sael ÷ Varkan pro Rolle, direkt aus beiden `roster.json`. Soll-Werte aus `faction.md` §9.2 (Vorbild-Relation). HP inkl. Schild.')
A('')
A('| # | Rolle | Sael ↔ Varkan | Mass | HP/Mass | DPS/Mass | max. RW | Tempo | Soll (§9.2) |')
A('|---|---|---|---|---|---|---|---|---|')
SOLL = {'lnd_t1_tank': ('A1', 'RW +44 %, HP/Mass −46 %, DPS/Mass +8 %, Tempo −12 %'), 'lnd_t1_bot': ('A2', 'Mass +40 %, HP/Mass +37 %, DPS/Mass −17 %'),
        'lnd_t2_tank': ('A3', 'Mass +82 %, DPS/Mass +23 %, (HP+Schild)/Mass +1 %'), 'lnd_t3_bot': ('A3', 'Mass +75 %, DPS/Mass +22 %'),
        'lnd_t2_mml': ('A4', 'Einzelschuss 600 statt 2×300'), 'str_t2_pd': ('A4', '600 / 4 s, Splash 2 statt Schnellfeuer'),
        'str_t2_arty': ('A4', 'DPS/Mass +31 %'), 'lnd_t1_arty': ('A4', 'Präzisions-Mörser: DPS/Mass +730 % bei Splash 0,5 statt 1 (Stellungsbrecher)'),
        'str_t2_shield': ('A5', 'Schild/Mass +51 %, Radius −23 %'), 'lnd_t2_shield': ('A5', 'Schild/Mass +14 %, Tempo +14 %'),
        'str_t1_fac_land': ('A6', 'HP/Mass −20 %'), 'str_t1_pgen': ('A6', 'HP/Mass −12 %'), 'str_t1_mex': ('A6', 'HP/Mass −8 %'),
        'str_t1_mstore': ('A6', 'HP/Mass bis −19 %'), 'lnd_t1_engineer': ('A6', 'HP −20 %'),
        'lnd_t2_bot': ('A7', 'Tempo +48 %, HP/Mass +71 %, DPS/Mass −20 % (faction.md: +43 %, gerechnet mit nur einer der zwei Waffen der Varkan-Referenz)'), 'lnd_t1_scout': ('A8', 'Mass −33 %, RW 33 zu 26')}
VKU = {u['id'].split(':')[1]: u for u in VK['units']}


def rat(a, b): return pct(round((a / b - 1) * 100, 1)) if a and b else '–'


def rng(u): return max([w['range'] for w in u['weapons']] or [0]) or None
def spd(u): return '–' if u['motion'].get('structure') else n(u['motion']['speed'], 1)


for r, (tag, soll) in SOLL.items():
    s = UID['f3:' + r]; v = VKU[r]
    hs = s['health']['max'] + (s['shield'] or {}).get('hp', 0); hv = v['health']['max'] + (v['shield'] or {}).get('hp', 0)
    ms, mvk = s['economy']['mass'], v['economy']['mass']
    ds, dv = s['balance']['dps'], v['balance']['dps']
    A(f"| {tag} | `{r}` | {s['name']['de']} ↔ {v['name']['de']} | {rat(ms, mvk)} | {rat(hs / ms, hv / mvk)} | {rat(ds and ds / ms, dv and dv / mvk)} | "
      f"{n(rng(s))} ↔ {n(rng(v))} | {spd(s)} ↔ {spd(v)} | {soll} |")
A('')
A('Die Ist-Werte weichen von den Soll-Relationen nur so weit ab, wie Varkan und Sael jeweils innerhalb ±15 % um ihre FA-Referenz liegen (z. B. Kauri HP/Mass −41 % statt −46 %, weil Kauri +9,7 % und Punze ±0 % liegen).')
A('')

# ---------------------------------------------------------------- 16 Post-MVP
A('---'); A('')
A('## 16. Post-MVP-Markierungen (`special.postMvp`)'); A('')
hov = [u['name']['de'] for u in U if any(p['what'].startswith('Schweben über Wasser') for p in u['special']['postMvp'])]
A(f"**Schweben über Wasser — M13** ({len(hov)} Blueprints): {', '.join(hov)}. *MVP-Fallback:* Layer `land`; Schweben ist reine Optik (`motion.hoverHeightView`, Schattensaum, Schwebelicht). Tiefes Wasser bleibt unpassierbar wie für Varkan. Die Kategorie `HOVER` ist gesetzt, wirkt aber erst mit M13.")
A('')
A('| Blueprint | Feature | Was | MVP-Fallback (Kern-Balance) |')
A('|---|---|---|---|')
for u in U:
    for p in u['special']['postMvp']:
        if p['what'].startswith('Schweben über Wasser'): continue
        A(f"| {u['name']['de']} | {p['feature']} | {p['what']} | {p['fallback']} |")
A('| (kein Blueprint) | neue ID (B-Kategorie) | Hingabe: Engineer löst sich in einen Bau auf | entfällt |')
A('| (kein Blueprint) | K10 + neuer Schadenstyp | Schildbrecher | entfällt |')
A('| (kein Blueprint) | M13, U17, U18 | Schweber als Marine-Konter | entfällt |')
A('')
A('Keine Stealth-/Tarn-Asymmetrie (I5): das Vorbild setzt kaum darauf (`faction.md` §9.2).')
A('')

# ---------------------------------------------------------------- 17 Eco
A('---'); A('')
A('## 17. Ökonomie-Kennzahlen (Kurzreferenz)'); A('')
A('Produktion, Unterhalt und Adjacency sind fraktionsgleich (FA-Relation); Sael unterscheidet sich nur in HP/Mass (A6). Amortisation = Upgrade-Mass / Mehrproduktion; die zweite Zahl rechnet den Energy-Mehrbedarf als anteilige Laterne I ein (20 E/s ≙ 75 Mass).')
A('')
A('| Gebäude | Ertrag | Unterhalt | Amortisation (Mass) | inkl. E-Mehrbedarf | Upgrade zur nächsten Stufe | Adjacency (FA-Relation) |')
A('|---|---|---|---|---|---|---|')
for i in ('str_t1_mex', 'str_t2_mex', 'str_t3_mex', 'str_t1_pgen', 'str_t2_pgen', 'str_t3_pgen', 'str_t1_hydro', 'str_t1_mstore', 'str_t1_estore'):
    u = UID['f3:' + i]; e = u['economy']
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
        amort = f"{n(round(e['mass'] / dm))} s" + (f" (Δ {n(dm)} M/s)" if prev else '')
        amort2 = f"≈ {n(round((e['mass'] + de / 20 * 75) / dm))} s (+{n(de)} E/s)"
    upg = '–'
    if u['special']['upgradesTo']:
        t = UID[u['special']['upgradesTo']]
        upg = f"{t['name']['de']}: {n(t['economy']['buildTime'])} / BP {n(e['buildPower'])} = {n(round(t['economy']['buildTime'] / e['buildPower']))} s"
    A(f"| {u['name']['de']} | {', '.join(ert)} | {('−' + n(e['upkeepEnergyPerSec']) + ' E/s') if e.get('upkeepEnergyPerSec') else '–'} | {amort} | {amort2} | {upg} | {u['special']['adjacency'] or '–'} |")
A('')
A('Weitere Upgrade-Dauern: ' + '; '.join(
    f"{u['name']['de']} → {UID[u['special']['upgradesTo']]['name']['de']} {n(round(UID[u['special']['upgradesTo']]['economy']['buildTime'] / u['economy']['buildPower']))} s"
    for u in U if u['special']['upgradesTo'] and 'STRUCTURE' in u['categories'] and 'MASSEXTRACTION' not in u['categories']) + '.')
A('')
A('Prior: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10 (wie Vogt).')
A('')

# ---------------------------------------------------------------- 18 Silhouetten
A('---'); A('')
A('## 18. Silhouetten-Pflichtpaare, Visuals, Glyphen'); A('')
sp = D['silhouettePairs']
A('**Pflichtpaare MS9 (nur ●, 5 von 5 Testern):** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['ms9']) + '.')
A('')
A('**Pflichtpaare MS14:** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['ms14']) + '.')
A('')
A('**Kreuz-Fraktions-Paare (gleiche Rolle, Rolle muss trotz anderer Fraktion erkannt werden):** ' + ', '.join(f"{nm(a)} ↔ {nm(b)}" for a, b in sp['crossFaction']) + '.')
A('')
A('**Visuals:** dieselben 28 Visual-IDs wie Varkan, je ein Superset-Mesh pro Rolle mit Tech-Bitmaske pro Vertex. Vereinigung nach (Part, Material):')
A('')
A('| Visual | Mitglieder | Superset-Parts | ≈ Tris | Varkan-Tris |')
A('|---|---|---|---|---|')
for vid, v in D['visuals'].items():
    A(f"| `{vid}` | {', '.join(nm(i) for i in v['members'])} | {v['supersetParts']} | {v['trisEstimate']} | {VK['visuals'][vid]['trisEstimate']} |")
A('')
ts = sum(v['trisEstimate'] for v in D['visuals'].values()); tv = sum(v['trisEstimate'] for v in VK['visuals'].values())
A(f"Summe Superset-Tris: Sael ≈ {n(ts)}, Varkan ≈ {n(tv)} (Kugeln und Tori sind teurer als Boxen). Im Kreuz-Match sind 56 Visuals im Umlauf (§20).")
A('')
A(f"**Icon-Glyphen ({len(D['iconGlyphs'])} Tokens, identisch zu Varkan):** " + ', '.join(f"`{x}`" for x in D['iconGlyphs']) + '. Prior (`cmd_commander`) und Deich (`wall`) haben keine Glyphe. Schweben ändert kein Icon; Läufer tragen `bot`.')
A('')

# ---------------------------------------------------------------- 19 Entscheidungen
A('---'); A('')
A('## 19. Entscheidungen beim Aufstellen'); A('')
A('| Nr | Punkt | Entscheidung und Begründung |')
A('|---|---|---|')
DEC = [
    ('1', 'T1-Artillerie 100 DPS (spooky)', 'In FAF `develop` bestätigt (200 / 2,0 s, Splash 0,5). Übernommen als Sael-Identität „Stellungsbrecher“ (A4): 7 Treffer auf Riff I/Riegel I, 2 auf eine Punze. Gegen bewegte Ziele begrenzen Flugzeit, Splash 0,5 und Streuung die Wirkung; deshalb ist K1-Streuung für die Dünung Pflicht (§20).'),
    ('2', 'Luft-DPS weit unter Varkan', 'Abfangjäger: spooky-Fehler (zweite Waffe fehlte), Referenz 48 statt 24 DPS. Bomber: 40 DPS ist echt (eine Bombe 200, Splash 4); Sael-Bomber schlagen selten und breit zu. Lähmung (K18) als Post-MVP markiert.'),
    ('3', 'Triton-Schild', 'Rumpf 1.300 + Schild 1.450 = 2.750 statt 1.300 + 1.400 (faction.md §11.1): Nur 2.731–2.800 hält die 40 Meißel-Salven der FA-Relation.'),
    ('4', 'Knallkrebs HP', '116 statt eines runderen Werts: Nur 113–119 hält gleichzeitig 5 Punze- und 17 Stichel-Treffer.'),
    ('5', 'Riff I HP', '1.300 (±0 %) statt 1.350 wie Riegel I: sonst bräuchte die Kelle 14 statt 13 Treffer.'),
    ('6', 'Raubmöwe HP', '1.200 (±0 %): Mit mehr HP überlebte sie eine Hochlilie-/Hochrost-Salve (FA: 1 Salve).'),
    ('7', 'DoT-Waffen', 'Woge (15 × 95), Brandung (5 × 575) und Sintflut (2 × 6.000) schlagen als ein Einschlag bzw. Doppelschlag mit derselben Summe ein; Breakpoints und Pulk identisch.'),
    ('8', 'Sintflut-Maßstab', 'wie Varkans Hochofen: RW 200, Kosten ≈ 67 %, Feuerrate ×⅔, gleicher Doppelschlag; Δ ±0.'),
    ('9', 'Kitbash-Budget Engineers', 'Deckplatte als flaches `wing`-Prisma (16 Tris) statt zweiter `shell`, damit der Kustos mit drei Sicheln unter 350 Tris bleibt (332). Die Regel „eine Perle, ein Ring oder eine Sichel“ gilt für Kampfeinheiten; Engineers zeigen die Tech-Stufe über die Sichelzahl (§5.2).'),
    ('10', 'Einsiedler-Doppelaufbau', 'keine zweite Perle (Budget-Lint max. 1 `orb`), stattdessen zweite Lanze und gewundene Schale.'),
    ('11', 'Glanzstoß-Anzeige', 'Waffenbezeichnung ohne „Overcharge“ (faction.md §2.5); FAF-Formel nur in der dev-Notiz.'),
    ('12', 'Referenzstand', 'Wie Varkan spooky 3810; develop-Abweichungen (T1-Panzer 1,7 s, T2-PD 560, T3-Artilleriestellung 79.000 Mass) nur dokumentiert, Nachziehen gemeinsam vor MS9.'),
]
for r in DEC: A('| ' + ' | '.join(r) + ' |')
A('')

# ---------------------------------------------------------------- 20 Offene Punkte
A('---'); A('')
A('## 20. Offene Punkte'); A('')
A('1. **Gemeinsamer Validator:** `checks.crossHitsToKill` existiert jetzt im Sael-Roster; `tools/roster/f3/validate.py` rechnet es gegen Varkans `roster.json` nach. Für f2/f4 braucht es einen fraktionsübergreifenden Validator (alle Paare N × N) und eine Entscheidung zu den drei Varkan-bedingten Info-Abweichungen (§14).')
A('2. **Streuung (K1):** Das Feld `weapons[].firingRandomness` existiert jetzt (FA-Semantik, Pflicht für ballistische Artillerie, §21 B3). Offen: die Umrechnung in Sim-Einheiten in K1 und das MS7-Abnahmeszenario der Dünung (Zickzack-Trefferquote ≤ 30 %, Richtwert). Fallback, falls die Quote darüber liegt: Nachladezeit 2,0 → 3,0 s (Δ DPS/Mass −33 %, dann Referenz neu begründen). Varkan sollte das Feld für Kelle, Pfanne, Tiegel und Hochofen nachziehen.')
A('3. **Draw-Budget Kreuz-Match:** 56 statt 28 Visuals; DECISIONS hat 40 Visuals getestet. Render-Bench mit beiden Fraktionen vor U22.')
A('4. **Personal-Schild-Fallback** (Triton, Einsiedler) im Balance-Gate MS8/MS9 bestätigen; ab K10 Aufteilung in Rumpf und Schild ohne Änderung von (HP+Schild)/Mass.')
A('5. **FA-Datenstand:** vor MS9 alle 50 Referenzen gegen den dann aktuellen FAF-Stand nachziehen, zusammen mit Varkan (siehe §1.1).')
A('6. **Kartenpool und Sintflut:** Reichweiten-Gate wie beim Hochofen (Karten ≥ 354 WU).')
A('7. **Schema-Erweiterung** um `ellipsoid`, `cone`, `torus`-Bogen und den Schicht-Dissolve (faction.md §3.6); die Tris-Werte hier sind Katalog-Schätzungen.')
A('8. **Namen:** Markenrecherche zu „Sael“, Kapitel- und Rufnamen (Triton, Kauri); FA-Grep vor dem Einfrieren gegen den dann aktuellen FAF-Stand wiederholen (`fa_names.json` neu erzeugen). Der Prüfer checkt jetzt alle Rufnamen-Wörter gegen 357 FA-Einheiten- und 218 Waffennamen und hält Abstand ≥ 2 zu den Rufnamen aller anderen Roster (§21 E1, L2).')
A('9. **Gemeinsamer Namens-Durchgang aller vier Fraktionen:** „Horn“ ist bei Sael Artillerie-Merkmal (Part, Waffennamen Horn-Mörser, Hornrakete, Schweres Horn) und bei f4 ein Einheitenname (T1-Artillerie). Gleiche Rolle, daher kein Blocker; beim Einfrieren entscheiden, ob eine Seite ausweicht.')
A('10. **Rush-Modell für alle Fraktionen:** `tools/roster/f3/rush.py` in den gemeinsamen Validator übernehmen, damit alle Kommandanten-Paarungen (N × N) mit demselben Modell gegen FA gegated werden.')
A('')
# ---------------------------------------------------------------- 21 Review-Entscheidungen
A('---'); A('')
A('## 21. Review-Entscheidungen'); A('')
A('Kritisches Review vom 2026-09-29 in vier Richtungen: **Balance** (nachgerechnet, Konter, T1-Rush gegen Kommandanten, Eco-Kurve), **Lesbarkeit** (Silhouetten, Icons, Namen im Match), **Eigenständigkeit** gegenüber FA und Passung zum Vorbild-Stil, **Vollständigkeit** der Rollen. ✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = verworfen. Alle Gates danach erneut grün (`gen.py`, `validate.py`).')
A('')
REV = {
    'Balance': [
        ('B1', 'T1-Rush gegen den Kommandanten nicht nachgewiesen', '✓', '`tools/roster/f3/rush.py` und `checks.rush` (Generator-Gate, Prüfer rechnet nach). Kauri → Prior 21 / 22, Punze → Prior 18 / 19, Kauri → Vogt 22 / 23 Einheiten ohne / mit Sonderschuss, jeweils exakt wie die FA-Paarung. Der Prior ist gut 10 % billiger zu überrennen als der Vogt (Vorbild-Relation, 11.000 statt 12.000 HP); ausgeglichen durch die Kauri-Reichweite 26 gegen Kommandanten-RW 22 (Kiten). Keine Wertänderung nötig.'),
        ('B2', 'Eco-Kurve gleichwertig?', '✓', 'Brunnen, Laternen, Quellbogen, Speicher, Kapitel, Engineers und Prior haben dieselben Kosten, Bauzeiten, Build Power und Erträge wie Varkan; das Opening ist bis zur ersten Kampfeinheit identisch (Kauri 14,5 s statt 15 s pro Einheit bei BP 20). Brunnen III und Luftkapitel II sind im fraktionsübergreifenden Abgleich auf die Varkan-Werte gesetzt (FA-Eco ist in allen Fraktionen gleich; `docs/design/factions/README.md` §5.1), es gibt keine Abweichung mehr. Sael zahlt die Asymmetrie nur in HP (A6), nicht im Tempo.'),
        ('B3', 'Dünung 100 DPS hängt an Streuung ohne Schemafeld', '✓', 'Neues optionales Feld `weapons[].firingRandomness` (FA-Semantik, Werte aus FAF develop): Dünung 0,35, Woge 1,0, Brandung 2,0, Sintflut 0,35, Tölpel-Bombe 0. Der Prüfer verlangt es bei jeder ballistischen Artilleriewaffe. Die Dünung-Notiz enthält jetzt ein MS7-Abnahmeszenario (Zickzack-Trefferquote ≤ 30 %, Richtwert) mit dem Fallback 3,0 s.'),
        ('B4', '„Dünung gegen Kelle ist ausgeglichen“ (faction.md §9.5)', '✓', 'Falsch: Die Dünung tötet eine Kelle in 2 Treffern (2 s), die Kelle braucht 2 Treffer in 9 s; auch im Pulk-Modell liegt die Dünung pro Mass vorn. Wie im Vorbild gewinnt Sael das T1-Artillerie-Duell. Text korrigiert; Varkans Konter sind Stichel-Überfälle (4,3 gegen 2,7 Tempo, Mindest-RW 5) und Punzen-Vorstöße (6 Treffer auf eine Dünung).'),
        ('B5', 'Präzisionsschweber: develop-Stand abweichend', '◐', 'develop hat RW 65 und 6,7 s statt RW 60 und 6,6 s (spooky 3810). Dokumentiert in `conventions.faDevelopCheck`, Nachziehen gemeinsam vor MS9; Breakpoint gegen den Triton (3 Treffer) bleibt.'),
        ('B6', 'Drei abweichende Kreuz-Info-Paare reparieren', '✗', 'Ursache sind Varkan-Werte (Punze 28 statt 24 Schaden; Turmfalke 280 statt 295 HP ist im fraktionsübergreifenden Abgleich behoben, jetzt 2 statt 3 Paare). Auf Sael-Seite ginge das nur gegen Pflichtpaare (Kauri-HP-Fenster 169–196 gegen 155–161). Bleibt beim gemeinsamen Validator (§20.1).'),
        ('B7', 'Triton-Overkill gegen T1-Schwärme', '✗', '360 Schaden pro Schuss tötet jede T1-Einheit einzeln; gegen Stichel-Schwärme verfällt Schaden. Das ist die Vorbild-Identität (A3/A4) und Varkans Konter. Keine Änderung.'),
    ],
    'Lesbarkeit': [
        ('L1', 'Engineer: §5.2 verbietet die Perle, der Kitbash hat einen `orb`-Emitter', '✓', 'Regel in faction.md §5.2 präzisiert: verboten sind Perle mit Lanze und eine freie Perle; ein kleiner, von der Sichelspitze umschlossener Glow-Emitter ist erlaubt (Flow-Ausnahme wie §5.3 Nr. 6). Geometrie bleibt.'),
        ('L2', 'Namensverwechslung zwischen den Fraktionen', '✓', 'Regel 8 galt nur gegen Varkan. Treffer mit höchstens einem Buchstaben Abstand: Hummer ↔ Hummel (f2-Kampfschweber), Kegel ↔ Egel (f2-Massebohrung), Dorn ↔ Horn (f4-T1-Artillerie), EN Well ↔ Wall (Varkan-Mauer). Umbenannt in **Languste / Langouste**, **Konus / Conus**, **Seelilie I, II / Sea Lily I, II** und **Hochlilie / High Lily**, EN **Fountain I–III**. Waffen-IDs folgen (`wpn_langouste_lance_t2`, `wpn_conus_lance_t3`, `wpn_lily_*`). Der Prüfer hält jetzt Abstand ≥ 2 zu allen anderen Rostern. Belassen: Seeigel ↔ Igel (f2-SAM), gleiche Rolle, Abstand 3.'),
        ('L3', '„Horn“ doppelt belegt (Sael-Artilleriemerkmal, f4-Einheitenname)', '◐', 'Beide Male Artillerie, also kein Rollenkonflikt; der Part-Key ist Code, die Waffennamen stehen nur im Tooltip. Offen für den gemeinsamen Namens-Durchgang (§20.9).'),
        ('L4', 'Silhouetten, Icons, Teamfarbe', '✓', 'Nachgeprüft: 28 Visuals, 19 Glyphen und alle Icon-IDs gleich Varkan, Monopol-Lints, Budget (max. 348 Tris) und Team-Part grün. Die AA-Familie trägt jetzt durchgängig „See…“ (Seeigel, Seestern, Seelilie); Seelilie ist wie Seeigel und Seestern ein Stachelhäuter (Wortfeld unverändert).'),
    ],
    'Eigenständigkeit': [
        ('E1', 'FA-Grep deckte nur die Referenz-Einheiten ab', '✓', 'Volltext-Grep gegen alle 357 Einheiten- und 218 Waffennamen aus spooky-db 3810 (`tools/roster/fa_names.json`, dev-only): Treffer „Crab“ (FA-Einheit „Crab Egg“). **Krabbe / Crab → Knallkrebs / Pistol Shrimp** (Waffe `wpn_shrimp_lance_t1`; der Knall passt zur Pulslanze). Der Prüfer führt den Grep jetzt bei jedem Lauf aus (erlaubt nur Air, Land, High, Sea).'),
        ('E2', 'Palette und Ordensrahmen nah am Vorbild', '◐', 'Helles Perlmutt mit Jade-Licht und Gold sowie ein geistlicher Orden sind die gewollte Stil-Anlehnung. Eigenständig bleiben Motiv (Muschel, Perle, Meer, Mond), Formen (Schale auf Schwebeteller, Horn, Stachelkranz), Lore (Obhut statt Kreuzzug, kein Glaubensinhalt) und Klang (Klangschale statt Chor). Keine FA-Begriffe (§2.5), keine übernommenen Formen. Keine Änderung.'),
        ('E3', 'Passung zum Vorbild-Stil', '✓', 'Schweben (M13), starke kleine Schilde (A5, K10), Reichweite (A1), Einzelschuss-Präzision (A4) und wenige teure Einheiten (A3) sind alle im Roster nachgewiesen (§15). Keine Änderung.'),
    ],
    'Vollständigkeit': [
        ('V1', 'Rollenabdeckung', '✓', '50 Blueprints, dieselben Rollen-IDs, ●/○, MS, Hotbuild-Slots und Visuals wie Varkan (Generator-Gate). Post-MVP-Asymmetrien tragen ihre Feature-ID: M13 (15 Blueprints), K10 (Triton, Einsiedler), K18 (Tölpel), U14 (Prior); I5 wird nicht gebraucht.'),
    ],
}
for k, rows in REV.items():
    A(f'### {k}'); A('')
    A('| Nr | Punkt | | Entscheidung und Begründung |')
    A('|---|---|---|---|')
    for r in rows: A('| ' + ' | '.join(r) + ' |')
    A('')
out = ROOT / 'docs/design/factions/f3/roster.md'
open(out, 'w').write('\n'.join(L) + '\n')
print(out, len(L), 'Zeilen')
