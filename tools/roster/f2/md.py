# Erzeugt docs/design/factions/f2/roster.md aus roster.json (Skarn). Aufruf: python3 md.py (nach gen.py)
import json, os, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
P = os.path.join(ROOT, 'docs', 'design', 'factions', 'f2')
D = json.load(open(os.path.join(P, 'roster.json')))
CORE = json.load(open(os.path.join(ROOT, 'docs', 'design', 'roster.json')))
U = D['units']; E = {u['id']: u for u in U}; CE = {u['id']: u for u in CORE['units']}
N = lambda i: (E.get(i) or CE[i])['name']['de']


def f(x, nd=None):
    """Deutsche Zahl: Tausenderpunkt, Dezimalkomma."""
    if x is None: return '–'
    if isinstance(x, float) and nd is None:
        s = f'{x:,.3f}'.rstrip('0').rstrip('.')
    else:
        s = f'{x:,.{nd}f}' if nd is not None else f'{x:,}'
    return s.replace(',', 'X').replace('.', ',').replace('X', '.')


def pct(x):
    if x is None: return '–'
    return '±0 %' if abs(x) < 0.05 else f"{'+' if x > 0 else '−'}{f(abs(x), 1)} %"


def short(i): return i.split(':')[1]


L = []
w = L.append
n9 = [u for u in U if u['ms9Core']]
w('# Roster: Skarn-Geflecht (f2, MVP)')
w('')
w('> **Status:** Startwerte für alle MVP-Blueprints der zweiten Fraktion auf Basis von `docs/design/factions/f2/faction.md`. Maschinenlesbar in '
  '`docs/design/factions/f2/roster.json` (Schema `faf-roster/1`, identisch zu Varkan). **`roster.json` ist die einzige Quelle für Zahlen, ●/○-Status und '
  'Kitbash-Parts**; dieses Dokument ist daraus erzeugt (`tools/roster/f2/md.py`). Überarbeitet nach dem Review vom 2026-09-29 (§19).')
w(f"> **Umfang:** **{D['counts']['total']} Blueprints** ({D['counts']['mobile']} mobil, {D['counts']['structures']} Gebäude, jede Upgrade-Stufe einzeln), "
  f"davon **{D['counts']['ms9Core']} im MS9-Kern (●)**, Rest bis MS14 (○). Gleiche Rollen-IDs, Feature-IDs, Icons und Hotbuild-Tasten wie Varkan. "
  f"{D['counts']['visuals']} Visuals, {D['counts']['iconGlyphs']} Icon-Glyphen (dieselben wie Varkan). Dazu {D['counts']['reservedPostMvp']} reservierte "
  f"Post-MVP-Rollen (§16) und {D['counts'].get('experimentals', 0)} Experimentals (T4, §20), nicht mitgezählt.")
w('> **Ausgeschlossen:** wie Varkan (TML/TMD, Nukes, Transporter, T3-Luft, Marine, Experimentals, SACU, Enhancements, Stealth/Omni). Eigenheiten der '
  'Vorbild-Fraktion, die solche Mechaniken brauchen, sind pro Einheit als `special.postMvp` mit Feature-ID markiert (§16). Die Kern-Balance gilt ohne sie.')
w('> **Balancing:** gegen die **Vorbild-Fraktion** als FA-Referenz (nur über Blueprint-Präfix `UR*`/`DR*` referenziert, dev-only). Hartes Gate ±25 % '
  'DPS/Mass und HP/Mass; der Generator erzwingt Einzelachsen, Produkt und Pulk-DPS/Mass je ±15 %, eine Treffer-bis-Tod-Matrix exakt wie die '
  'Vorbild-Referenz und einen **Kreuz-Check gegen Varkan** (§14.4). Validierung: `tools/roster/f2/validate.py`.')
w('')
w('---')
w('')
w('## 1. Quellen und Methodik')
w('')
w('- **FA-Daten:** [FAForever/spooky-db](https://github.com/FAForever/spooky-db) `app/data/index.json` (Datenstand „3810“, 503 Blueprints), abgerufen '
  '2026-09-29, extrahiert mit `tools/roster/f2/fa_extract.py` nach `tools/roster/f2/fa_ref.json` (nur Zahlen, dev-only). DPS-Formel wie Varkan '
  '(`app/js/dps.js`: Nachladezeit auf 0,1-s-Ticks, Salven über Muzzle/Racks, Strahl-Waffen über Pulse).')
w('- **Referenzwahl (faction.md §9.2):** primär die Einheit der Vorbild-Fraktion in derselben Rolle (`faReference.bp`), Gegenprobe ist Varkans '
  'Referenz (`crossCheckBp`). Fehlt der Vorbild-Fraktion eine Rolle, gilt Varkans Referenz: **Mobiler Schild** (`UEL0307`, bewusst am unteren Bandrand) '
  'und **Präzisionsläufer** (`XAL0305`). **Schildkette:** Kokon II gegen Stufe 1 (`URB4202`), Kokon III gegen die erste T3-Stufe (`URB4206`); die zwei '
  'T2-Zwischenstufen der Vorbild-Kette entfallen, weitere Stufen kommen mit B8.')
w('- **Mehrwaffen-Einheiten:** Alle Waffen der Referenz werden addiert (wie spooky-db), unsere ebenso: Klette und Hagedorn mit schwacher Bodenwaffe, '
  'Tarantel mit Nahlinse, Stechmücke mit Luft- und Abwurfwaffe. Beim Rädelsführer zählt nur die Hauptwaffe (Überschlag nicht in DPS/Mass).')
w('- **Globale Verschiebung wie Varkan:** Varkan liegt im Mittel bei +4,3 % HP/Mass und −1 % DPS/Mass gegenüber seiner Referenz. Damit beide Fraktionen '
  'untereinander im FA-Verhältnis stehen, trägt Skarn dieselbe Verschiebung (HP ≈ +4 %, wo kein Breakpoint bricht). Die Skarn-Signatur (billiger, '
  'schneller, zerbrechlicher) steckt in den Relationen der Vorbild-Referenz selbst, nicht in Zusatz-Abschlägen.')
w('- **Einheiten, Waffen, Abweichung, Produkt, Pulk, Treffer bis Tod, Kitbash-Budget, Maßstab:** exakt wie Varkan (`docs/design/roster.md` §1). '
  'Tris-Schätzung **ohne Beine** (der Render-Pfad erzeugt sie, faction.md §3.3); `legs` zählt als 1 Part, die Beinzahl steht in `kitbash.legs` '
  '(2 leicht, 4 Linie, 6 T3/Rädelsführer).')
w('- **Lints (faction.md §5.3):** `spike` nur bei ANTIAIR/WALL, `tail` nur bei ARTILLERY, `lens` nur bei DIRECTFIRE, `spool`/`druse`/`glow` nur bei '
  'ECONOMIC/FACTORY/ENGINEER, mindestens ein Team-Part, Beinzahl 6 bei T3 und Rädelsführer, gleiche Icons/Hotbuild-Tasten wie Varkan.')
w('- **Spalten:** ● = MS9-Kern · MS = erster Meilenstein (1:1 von Varkan, weil aus denselben Features) · RW = Reichweite · s = sizeClass · '
  'R = Radar · Regen = HP/s · Δ = gegen Vorbild-Referenz · ΔV = Relation zu Varkan gegen FA-Relation (§14.3).')
w('')
w('---')
w('')
w('## 2. Zählung nach Meilenstein')
w('')
w('| MS | neu gebraucht | Blueprints |')
w('|---|---|---|')
order = lambda m: int(m[2:])
tot = 0
for m in sorted({u['msFirst'] for u in U}, key=order):
    us = [u for u in U if u['msFirst'] == m]; tot += len(us)
    w(f"| {m} | {len(us)} (Σ {tot}) | {', '.join(('● ' if u['ms9Core'] else '○ ') + u['name']['de'] for u in us)} |")
w('')
w(f"**MS9-Kern ({len(n9)}):** {', '.join(u['name']['de'] for u in n9)}.")
w('')
w('### 2.1 Abweichungen gegenüber Varkan (Rollen gleich, Ausprägung anders)')
w('')
w('| Punkt | Festlegung | Grund |')
w('|---|---|---|')
w('| Schabe unbewaffnet | `f2:lnd_t1_scout` ohne Waffe, Kategorie ohne DIRECTFIRE | Vorbild-Relation (die Referenz hat keine Waffe); dafür 8 statt 12 Mass, Radar 44 |')
w('| Klette / Hagedorn mit Bodenwaffe | zusätzliche schwache Waffe gegen Land, Kategorie DIRECTFIRE | Vorbild-Relation; Form bleibt Dornenkamm (Winkel-Code senkrecht) |')
w('| Milbe als Raketenläufer | T2-Läufer mit ungelenkter Direktfeuer-Raketensalve (Splash 2) statt Gatling | Vorbild-Relation (FAF-T2-Raketenläufer); Abschuss aus der Linse, damit der Winkel-Code direkt bleibt |')
w('| Regeneration der Basis | `health.regenPerSec` bei Egel, Druse, Fumarole, Wabe, Nestern | faction.md §9.3; Sim über die generische `regen`-Spalte (PLAN §3.4, G6 ab MS10), vor U19 vorhanden (§19 R3) |')
w('| Gespinst am unteren Bandrand | −10 % Kosten, ≈ −14 % HP+Schild/Mass gegenüber `UEL0307` | Vorbild hat keinen mobilen Schild (faction.md §9.2) |')
w('| Kokon II → III ohne Zwischenstufen | ein Upgrade-Sprung, Stufen IV/V mit B8 | faction.md §9.4; Gesamtkosten II+III pro HP+Schild ≈ Varkans Schirm II+III |')
w('| Nessel schneller nachladend | 5,8 statt 6,0 s | gleicht die fehlende Lähmung (K18) innerhalb des 15-%-Bands aus (faction.md §9.5 Nr. 1); nicht weiter, weil die Kreuz-Relation zur Kelle sonst +16 % erreicht (§19 R1) |')
w('| Tarantel zäher | 3.200 statt 3.000 HP | gleicht den fehlenden Raketen-Ablenker (K16) im Band aus |')
w('')
w('---')
w('')
w('## 3. Hotbuild-Raster (identisch zu Varkan)')
w('')
g = D['hotbuildGrid']
for menu, rows in (('Landnest', ['QWERT', 'ASDFG']), ('Luftnest', ['QWERT', 'ASDFG']), ('Bau', ['QWERT', 'ASDFG', 'ZXCVB'])):
    w(f'**{menu}**')
    w('')
    w('| | 1 | 2 | 3 | 4 | 5 |')
    w('|---|---|---|---|---|---|')
    for i, r in enumerate(rows):
        w(f"| Reihe {i + 1} | " + ' | '.join((f"**{k}** {g[menu][k]}" if k in g[menu] else '–') for k in r) + ' |')
    w('')
w(g['rule'])
w('')
w('---')
w('')

GROUPS = [('4. Rädelsführer und Engineers', lambda u: u['group'] == 'cmd'),
          ('5. Landarmee T1', lambda u: u['group'] == 'land' and u['tech'] == 1),
          ('6. Landarmee T2', lambda u: u['group'] == 'land' and u['tech'] == 2),
          ('7. Landarmee T3', lambda u: u['group'] == 'land' and u['tech'] == 3),
          ('8. Luftwaffe T1–T2', lambda u: u['group'] == 'air'),
          ('9. Wirtschaft', lambda u: u['group'] == 'eco'),
          ('10. Fabriken (Nester)', lambda u: u['group'] == 'fac'),
          ('11. Verteidigung', lambda u: u['group'] == 'def'),
          ('12. Intel und Schilde', lambda u: u['group'] == 'intel'),
          ('13. Artilleriestellungen', lambda u: u['group'] == 'arty')]


def weap(x):
    s = f"`{short(x['ref'])}` {x['type']}: " + (f"{x['salvo']}×" if x['salvo'] > 1 else '') + f"{f(x['damage'])} / {f(x['reloadS'])} s = **{f(x['dps'], 1)} DPS**"
    s += f", RW {f(x['rangeMin']) + '–' if x.get('rangeMin') else ''}{f(x['range'])}, {x['projectile']}"
    if x.get('splash'): s += f", Splash {f(x['splash'])}"
    if x['layers'] != ['land']: s += f" [{'/'.join(x['layers'])}]"
    return s


def parts(k):
    out = []
    for p in k['parts']:
        s = p['part'] + (f"#{p['count']}" if p.get('count') else '') + (f"({p['note'].replace('_', ' ')})" if p.get('note') else '')
        if p.get('anim'): s += f" ⟳{p['anim']}"
        if p.get('mat'): s += f" [{p['mat']}]"
        out.append(s)
    sc = k['scale']; scs = f(sc['xz']) if sc['xz'] == sc['y'] else f"{f(sc['xz'])}/{f(sc['y'])}"
    st_ = f"{k['techStripes']} Streifen ({dict(black='schwarz', quartz='quarzweiß')[k['techStripeMat']]})" if k['techStripes'] else 'keine Streifen'
    return ', '.join(out) + f" — {k['partCount']} Parts, {k['animatedParts']} anim., ≈ {k['trisEstimate']} Tris · Maßstab {scs} · {st_}"


for title, pred in GROUPS:
    us = [u for u in U if pred(u)]
    mobile = us[0]['group'] in ('cmd', 'land', 'air')
    w(f'## {title}')
    w('')
    w('**Stammdaten**')
    w('')
    if mobile:
        w('| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP | Tempo / Drehung | Beine | Footprint | Sicht / R | Hotbuild | Icon |')
        w('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    else:
        w('| | ID | DE / EN | Rolle | Referenz (dev-only) | MS | Mass / Energy / BT | HP (Regen) | Footprint | Sicht / R | Hotbuild | Icon |')
        w('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for u in us:
        ec = u['economy']; fr = u['faReference']; mo = u['motion']; it = u['intel']
        ref = f"{fr['role']} (`{fr['bp']}`" + (f", Gegenprobe `{fr['crossCheckBp']}`" if fr.get('crossCheckBp') else '') + ')'
        hb = f"{u['hotbuild']['menu']}: {u['hotbuild']['slot']}" if u['hotbuild'] else '–'
        sight = f(it.get('vision')) + (f" / R {f(it['radar'])}" if it.get('radar') else '')
        hp = f(u['health']['max']) + (f" (+{f(u['health']['regenPerSec'])}/s)" if u['health'].get('regenPerSec') else '')
        if u['shield']: hp += f" + Schild {f(u['shield']['hp'])}"
        head = f"| {'●' if u['ms9Core'] else '○'} | `{u['id']}` | **{u['name']['de']}** / {u['name']['en']} | {u['role']['de']} / {u['role']['en']} | {ref} | {u['msFirst']} | {f(ec['mass'])} / {f(ec['energy'])} / {f(ec['buildTime'])} | {hp} | "
        if mobile:
            w(head + f"{f(mo['speed'])} / {f(mo['turnRateDeg'])}° | {mo.get('legs') or '–'} | {mo['footprint'][0]}×{mo['footprint'][1]} / s{mo['sizeClass']} | {sight} | {hb} | `{u['icon']}` |")
        else:
            w(head + f"{mo['footprint'][0]}×{mo['footprint'][1]} | {sight} | {hb} | `{u['icon']}` |")
    w('')
    w('**Waffen und Balance** (Δ gegen Vorbild-Referenz; ΔV = Relation zu Varkan gegen FA-Relation)')
    w('')
    w('| ID | Waffen | DPS/Mass (FA) | Δ DPS/Mass | HP/Mass (FA) | Δ HP/Mass | Δ Produkt | ΔV DPS / HP |')
    w('|---|---|---|---|---|---|---|---|')
    for u in us:
        b = u['balance']; v = b['vsCore']
        ws = '<br>'.join(weap(x) for x in u['weapons']) or '–'
        w(f"| `{short(u['id'])}` | {ws} | {f(b['dpsPerMass'], 3) if b['dpsPerMass'] else '–'} ({f(b['fa']['dpsPerMass'], 3) if b['fa']['dpsPerMass'] else '–'}) | "
          f"{pct(b['devDpsPerMassPct'])} | {f(b['hpPerMass'], 3)} ({f(b['fa']['hpPerMass'], 3)}) | {pct(b['devHpPerMassPct'])} | {pct(b['devProductPct'])} | "
          f"{pct(v.get('devPct_dps'))} / {pct(v['devPct_hp'])} |")
    w('')
    w('**Kategorien, Besonderheiten, Post-MVP, Kitbash**')
    w('')
    w('| ID | Kategorien / buildableBy | Besonderheiten | Post-MVP (Feature-ID) | Kitbash (Parts) | MS-Hinweis |')
    w('|---|---|---|---|---|---|')
    for u in us:
        sp = u['special']; ec = u['economy']
        cat = ' '.join(u['categories']) + (f"<br>*von:* `{u['buildableBy'].replace('|', '\\|')}`" if u['buildableBy'] else '')
        bits = []
        eco = []
        if ec.get('buildPower'): eco.append(f"BP {f(ec['buildPower'])}")
        for k, lab in (('massPerSec', '+{} M/s'), ('energyPerSec', '+{} E/s'), ('upkeepEnergyPerSec', '−{} E/s Unterhalt'),
                       ('storageMass', 'Speicher {} M'), ('storageEnergy', 'Speicher {} E')):
            if ec.get(k): eco.append(lab.format(f(ec[k])))
        if eco: bits.append(' · '.join(eco))
        if u['shield']:
            s = u['shield']; bits.append(f"Schild {f(s['hp'])} HP, r{f(s['radius'])}, +{f(s['regenPerSec'])}/s nach {f(s['regenStartS'])} s, Neuaufbau {f(s['rechargeS'])} s, −{f(s['upkeepEnergyPerSec'])} E/s")
        if sp['toggles']: bits.append('Toggles: ' + ', '.join(sp['toggles']))
        if sp['upgradesTo']: bits.append(f"Upgrade → {N(sp['upgradesTo'])}")
        if sp['adjacency']: bits.append('Adjacency: ' + sp['adjacency'])
        dw = sp['deathWeapon']
        if dw:
            if 'inner' in dw:
                bits.append(f"Death: `{short(dw['ref'])}` {f(dw['inner']['damage'])}/r{dw['inner']['radius']} + {f(dw['outer']['damage'])}/r{dw['outer']['radius']} ({dw['note']})")
            else:
                bits.append(f"Death: `{short(dw['ref'])}` {f(dw['damage'])}/r{f(dw['radius'])} ({dw['note']})")
        bits.append(sp['notes'])
        for x in u['weapons']:
            if x.get('notes'): bits.append(f"{short(x['ref'])}: {x['notes']}")
        pm = '<br>'.join(f"**{p['feature']}**: {p['effect']}" for p in sp.get('postMvp', [])) or '–'
        w(f"| `{short(u['id'])}` | {cat} | {'<br>'.join(bits)} | {pm} | {u['kitbash']['description']}<br>{parts(u['kitbash'])} | {u['msNote']} |")
    w('')
    w('---')
    w('')

# ---------------------------------------------------------------- 14 Balance
arm = [u for u in U if u['balance']['devDpsPerMassPct'] is not None]
mx = lambda key, LL: max(LL, key=lambda u: abs(u['balance'][key]))
w('## 14. Balance-Übersicht und Gates')
w('')
for key, lab, LL in (('devDpsPerMassPct', 'DPS/Mass', arm), ('devHpPerMassPct', 'HP/Mass', U), ('devProductPct', 'Produkt DPS/Mass × HP/Mass', arm)):
    u = mx(key, LL)
    w(f"- **{lab}:** {len(LL)} Einträge, größte Abweichung {pct(u['balance'][key])} ({u['name']['de']}), Mittel {pct(st.mean(x['balance'][key] for x in LL))}. Gate ±15 % (hart ±25 %).")
cm = CORE['units']
w(f"- **Parität zu Varkan:** Varkan liegt im Mittel bei {pct(st.mean(x['balance']['devHpPerMassPct'] for x in cm))} HP/Mass und "
  f"{pct(st.mean(x['balance']['devDpsPerMassPct'] for x in cm if x['balance']['devDpsPerMassPct'] is not None))} DPS/Mass gegenüber seiner Referenz, Skarn bei "
  f"{pct(st.mean(x['balance']['devHpPerMassPct'] for x in U))} / {pct(st.mean(x['balance']['devDpsPerMassPct'] for x in arm))}. Die Relation Skarn/Varkan "
  f"weicht damit im Mittel um {pct(st.mean(x['balance']['vsCore']['devPct_hp'] for x in U))} (HP/Mass) und "
  f"{pct(st.mean(x['balance']['vsCore']['devPct_dps'] for x in arm if x['balance']['vsCore'].get('devPct_dps') is not None))} (DPS/Mass) von der FA-Relation der beiden Referenzfraktionen ab.")
w('- **Bewusste Abweichungen (im Band):** Nessel +3,5 % DPS/Mass (Ersatz für K18-Lähmung), Tarantel +7 % HP/Mass (Ersatz für K16-Ablenker), Langbein '
  'zerbrechlicher und schneller feuernd (−8 % HP, +5 % DPS), Gespinst und Kokon am unteren Bandrand (−12 bis −14 %), Bilsenkraut maßstabsskaliert wie '
  'Varkans Hochofen (RW 200, Kosten ≈ 66 %, Feuerrate × ⅔).')
w('')
w('### 14.1 Fraktions-Signatur gegenüber Varkan (Vorbild-Relation)')
w('')
w('| Rolle | Skarn | Varkan | DPS/Mass Skarn ÷ Varkan | HP/Mass Skarn ÷ Varkan | Tempo | Kosten (Mass) |')
w('|---|---|---|---|---|---|---|')
for r in ('cmd_commander', 'lnd_t1_bot', 'lnd_t1_tank', 'lnd_t1_arty', 'lnd_t1_aa', 'lnd_t2_tank', 'lnd_t2_mml', 'lnd_t3_bot', 'lnd_t3_arty',
          'air_t1_bomber', 'air_t2_gunship', 'str_t1_mex', 'str_t1_fac_land', 'str_t1_pd', 'str_t2_pd', 'str_t2_shield'):
    a, c = E['f2:' + r], CE['core:' + r]; va = a['balance']['vsCore']
    sp = f"{f(a['motion']['speed'])} / {f(c['motion']['speed'])}" if a['motion'].get('speed') else '–'
    w(f"| {r} | {a['name']['de']} | {c['name']['de']} | {pct(va.get('dpsPerMassVsCorePct'))} | {pct(va['hpPerMassVsCorePct'])} | {sp} | {f(a['economy']['mass'])} / {f(c['economy']['mass'])} |")
w('')
w('Die Spalten zeigen die Unterschiede, die die Fraktion ausmachen: Linie mit mehr Feuerkraft und weniger Panzerung, zäher Raider, harte, zerbrechliche '
  'Artillerie, zerbrechliche Basis mit Regeneration, billige Schilde mit wenig Schild-HP (pro Mass trotzdem effizient, wie die Vorbild-Relation). Die Werte sind gewollt groß: Sie sind die '
  'FA-Relation der beiden Referenzfraktionen. Wie genau Skarn und Varkan dieses Verhältnis treffen, zeigt die Spalte ΔV in §4–13 (Gate ±25 %, Mittel ≈ ±2 %).')
w('')
w('### 14.2 Pulk-DPS/Mass (Artillerie, Gate ±15 %)')
w('')
w('| Einheit | Schaden × Salve / Nachladezeit | Splash (FA) | Pulk-DPS/Mass (FA) | Δ Pulk | Δ Einzelziel |')
w('|---|---|---|---|---|---|')
for u in U:
    pk = u['balance']['pulk']
    if pk:
        x = u['weapons'][0]
        w(f"| {u['name']['de']} | {(str(x['salvo']) + '×') if x['salvo'] > 1 else ''}{f(x['damage'])} / {f(x['reloadS'])} s | {f(pk['splash'])} ({f(pk['faSplash'])}) | "
          f"{f(pk['pulkDpsPerMass'], 3)} ({f(pk['faPulkDpsPerMass'], 3)}) | {pct(pk['devPct'])} | {pct(u['balance']['devDpsPerMassPct'])} |")
w('')
w('### 14.3 Treffer-bis-Tod-Matrix (Pflicht: exakt Vorbild-FA)')
w('')
w('| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA: Salvenschaden / Ziel-HP | FA: Salven (Zeit) | ✓ |')
w('|---|---|---|---|---|---|')
for h in D['checks']['hitsToKill']:
    w(f"| {N(h['attacker'])} → {N(h['target'])} | {f(h['salvoDamage'])} / {f(h['targetHp'])} | {h['hits']} ({f(h['ttkS'])} s) | "
      f"{f(h['fa']['salvoDamage'])} / {f(h['fa']['targetHp'])} | {h['fa']['hits']} ({f(h['fa']['ttkS'])} s) | {'✓' if h['match'] else '✗'} |")
w('')
w('### 14.4 Kreuz-Check gegen Varkan (faction.md §9.2)')
w('')
w('Salven bis zum Tod zwischen den Fraktionen müssen dieselben sein wie zwischen den beiden FA-Referenzfraktionen (Angreifer-Waffe der einen gegen '
  'Ziel-HP der anderen). **Pflichtpaare:**')
w('')
w('| Angreifer → Ziel | Salvenschaden / Ziel-HP | Salven (Zeit) | FA-Paarung: Salven (Zeit) | Ergebnis |')
w('|---|---|---|---|---|')
for x in D['checks']['crossFaction']:
    if x['mandatory']:
        res = '✓ exakt' if x['match'] else f"✓ Ausnahme: Tötungszeit {pct(x['ttkDevPct'])}. {x['exception']}"
        w(f"| {N(x['attacker'])} → {N(x['target'])} | {f(x['salvoDamage'])} / {f(x['targetHp'])} | {x['hits']} ({f(x['ttkS'])} s) | {x['fa']['hits']} ({f(x['fa']['ttkS'])} s) | {res} |")
info = [x for x in D['checks']['crossFaction'] if not x['mandatory']]
bad = [x for x in info if not x['ok']]
w('')
w(f"**Info-Matrix:** {len(info)} weitere Paare (Rädelsführer/Vogt, T1-Läufer/Bots, T1-Linie, T1-Artillerie, T2-Linie, T1-PD gegen die T1-Armee und die "
  f"T2-Linie der anderen Fraktion, beide Richtungen). Breakpoints (≤ 10 FA-Salven) müssen exakt stimmen, größere Salvenzahlen innerhalb ±10 % Tötungszeit. "
  f"{len(info) - len(bad)} passen. {sum(1 for x in bad if x['cause'] == 'Varkan')} Abweichungen gehen auf bewusste **Varkan**-Abweichungen zurück (Punze 28 statt 24 Schaden, "
  f"Lehrling 160 statt 150 HP; der Stichel ist seit dem fraktionsübergreifenden Abgleich FA-gleich 60 HP / 30 Mass). {sum(1 for x in bad if x['cause'] != 'Varkan')} geht auf Skarn zurück: Kelle → Ohrwurm braucht nach der "
  f"HP-Verschiebung des Ohrwurms (§19 R2) 20 statt 19 Salven. Das ist kein Breakpoint; von den +14,5 % Tötungszeit stammen +8,4 % aus Varkans langsamerer "
  f"Kelle (9,0 statt 8,3 s). Der Validator erzwingt, dass Skarn keinen Kreuz-Breakpoint bricht:")
w('')
w('| Angreifer → Ziel | Salven | FA-Paarung | Tötungszeit | Ursache |')
w('|---|---|---|---|---|')
for x in bad:
    w(f"| {N(x['attacker'])} → {N(x['target'])} | {x['hits']} | {x['fa']['hits']} | {f(x['ttkS'])} s statt {f(x['fa']['ttkS'])} s | {x['cause']} |")
w('')
w('### 14.5 Schildbrechen (Info, ein Schütze, mit `regenStartS`)')
w('')
w('| Angreifer → Schild | Schüsse (Zeit) | FA-Waffe gegen FA-Schild-HP |')
w('|---|---|---|')
for s in D['checks']['shieldBreak']:
    a = f"{s['shots']} ({f(s['timeS'])} s)" if s['shots'] else 'bricht allein nicht'
    b = f"{s['faShots']} ({f(s['faTimeS'])} s)" if s['faShots'] else 'bricht allein nicht'
    w(f"| {N(s['attacker'])} → {N(s['target'])} | {a} | {b} |")
w('')
w('Kokon II fällt schneller als die Vorbild-Stufe 1 (bewusst: billiger, schwächer, unterer Bandrand). Die Stufe III hält den Schild-Burst des Bilsenkrauts '
  'wie die Vorbild-T3-Stufe (5 Schüsse).')
w('')
w('---')
w('')
# ---------------------------------------------------------------- 15 Eco
w('## 15. Ökonomie-Kennzahlen (Kurzreferenz)')
w('')
w('| Gebäude | Ertrag | Unterhalt | Regeneration | Upgrade zur nächsten Stufe | Adjacency |')
w('|---|---|---|---|---|---|')
for u in U:
    if u['group'] != 'eco': continue
    ec = u['economy']
    y = ' · '.join(x for x in (f"{f(ec['massPerSec'])} M/s" if ec.get('massPerSec') else '', f"{f(ec['energyPerSec'])} E/s" if ec.get('energyPerSec') else '',
                                f"+{f(ec['storageMass'])} M Speicher" if ec.get('storageMass') else '', f"+{f(ec['storageEnergy'])} E Speicher" if ec.get('storageEnergy') else '') if x)
    up = u['special']['upgradesTo']
    ups = f"{N(up)}: {f(E[up]['economy']['mass'])} M / BP {f(ec['buildPower'])} = {f(E[up]['economy']['buildTime'] / ec['buildPower'], 0)} s" if up else '–'
    w(f"| {u['name']['de']} | {y} | {('−' + f(ec['upkeepEnergyPerSec']) + ' E/s') if ec.get('upkeepEnergyPerSec') else '–'} | "
      f"{(f(u['health']['regenPerSec']) + ' HP/s') if u['health'].get('regenPerSec') else '–'} | {ups} | {u['special']['adjacency'] or '–'} |")
w('')
ups = []
for u in U:
    up = u['special']['upgradesTo']
    if up and u['group'] != 'eco':
        ups.append(f"{u['name']['de']} → {N(up)} {f(E[up]['economy']['buildTime'] / u['economy']['buildPower'], 0)} s")
w('Weitere Upgrade-Dauern (buildTime der Zielstufe / buildPower der Vorstufe): ' + '; '.join(ups) + '.')
w('')
w('Rädelsführer: +1 M/s, +20 E/s, Grundspeicher 650 M / 3.900 E, Build Power 10, Regeneration 18 HP/s. Überschlag nach Varkans Abstich-Formel, feuert erst ab '
  '7.500 E Vorrat (Glimmzelle nötig, daher Daten-Vorgriff ab MS6 wie Varkans Glutspeicher).')
w('')
w('---')
w('')
# ---------------------------------------------------------------- 16 Post-MVP
w('## 16. Post-MVP-Markierungen und reservierte Rollen')
w('')
w('Keine dieser Eigenheiten ist für die Kern-Balance nötig. In `roster.json` stehen sie als `special.postMvp: [{feature, effect}]` ohne Sim-Wirkung.')
w('')
w('| Feature-ID | Einheiten | Wirkung, sobald verfügbar |')
w('|---|---|---|')
by = {}
for u in U:
    for p in u['special'].get('postMvp', []):
        by.setdefault(p['feature'], []).append((u['name']['de'], p['effect']))
for k, v in sorted(by.items()):
    effs = {e for _, e in v}
    eff = next(iter(effs)) if len(effs) == 1 else '<br>'.join(f"{n}: {e}" for n, e in v)
    w(f"| **{k}** | {', '.join(n for n, _ in v)} | {eff} |")
w('| **U9** (fraktionsweit) | alle mobilen Einheiten | Veteranen-Regeneration nach FAF-Vet-Tabelle |')
w('')
w('**Reservierte Rollen (nicht gezählt, `reservedPostMvp`):**')
w('')
w('| Reserve-ID | DE / EN | Rolle | braucht | Hotbuild | Icon |')
w('|---|---|---|---|---|---|')
for r in D['reservedPostMvp']:
    hb = f"{r['hotbuild']['menu']}: {r['hotbuild']['slot']}" if r['hotbuild'] else '–'
    w(f"| `{r['id']}` | **{r['de']}** / {r['en']} | {r['role']} | {', '.join(r['needs'])} | {hb} | {r['icon']} |")
w('')
w('---')
w('')
# ---------------------------------------------------------------- 17 Silhouetten
w('## 17. Silhouetten-Pflichtpaare, Visuals, Glyphen')
w('')
sp = D['silhouettePairs']
w('**Pflichtpaare MS9 (nur ●):** ' + ', '.join(f"{N(a)} ↔ {N(b)}" for a, b in sp['ms9']) + '.')
w('')
w('**Pflichtpaare MS14:** ' + ', '.join(f"{N(a)} ↔ {N(b)}" for a, b in sp['ms14']) + '.')
w('')
w('**Fraktions-Paartest:** ' + ', '.join(f"{N(a)} ↔ {N(b)}" for a, b in sp['crossFaction']) + '. Rolle gleich lesen (Winkel-Code), Fraktion verschieden '
  '(Umriss mit Beinen, Glanz), jeweils 5 von 5 Testern bei 48 px.')
w('')
w('**Visuals** (Superset-Mesh pro Rolle, Beinzahl als Instanzparameter):')
w('')
w('| Visual | Mitglieder | Superset-Parts | ≈ Tris (ohne Beine) | Beine |')
w('|---|---|---|---|---|')
for k, v in D['visuals'].items():
    w(f"| `{k}` | {', '.join(N(m) for m in v['members'])} | {v['supersetParts']} | {v['trisEstimate']} | {'/'.join(map(str, v['legs'])) or '–'} |")
w('')
w(f"**Icon-Glyphen ({len(D['iconGlyphs'])} Tokens, identisch zu Varkan):** " + ', '.join(f"`{x}`" for x in D['iconGlyphs']) +
  '. Rädelsführer (`cmd_commander`) und Hecke (`wall`) ohne Glyphe. Reserviert: `stealth` (I5).')
w('')
w('---')
w('')
w('## 18. Offene Punkte')
w('')
w('1. **Regeneration für Strukturen (Prüfpunkt, kein Blocker):** Die Sim faltet `regen` generisch als effektive Spalte für alle Einheiten (PLAN §3.4, '
  'Modifier G6, MS10). Skarn kommt mit U19 und damit nach MS10. Bei der Integration prüfen, dass `health.regenPerSec` aus dem Blueprint für Strukturen '
  'in diese Spalte fließt und nicht nur für den Kommandanten. Ohne das fehlen der Skarn-Basis 2–40 HP/s, und Egel, Druse und Nester (10–32 % weniger '
  'HP als bei Varkan) wären zu schwach.')
w('2. **Kreuz-Ausnahme Punze → Zecke:** 10 statt 12 Salven bei praktisch gleicher Tötungszeit (−1,8 %). Löst sich nur, wenn Varkans Punze auf 24 '
  'Schaden / 1,0 s zurückgeht (Varkan-Entscheidung, nicht Teil dieses Rosters). Zecke-HP 281–307 ergäbe 11 Salven, aber +9 % Tötungszeit; 280 bleibt näher an FA.')
w('3. **FAF-Stand nachziehen:** Referenzwerte sind spooky-db 3810. Vor dem MS9-Balancing gegen den dann aktuellen FAF-Stand prüfen (wie Varkan §18).')
w('4. **Kokon-Kette:** Der Sprung II→III lässt die zwei T2-Zwischenstufen der Vorbild-Kette aus. Wenn B8 kommt, Kokon IV/V ergänzen und prüfen, ob '
  'Kokon III dann eine Zwischenstufe werden soll.')
w('5. **Bein- und Draw-Budget:** 28 Visuals (Ziel eingehalten), zusammen mit Varkan 56 in einem Match; Messung und Bein-Renderer bei 200+ Einheiten offen '
  '(faction.md §11.2).')
w('6. **Markenrecherche** für „Skarn“ und alle Rufnamen offen. Der Namens-Grep gegen die 357 FA-Einheitennamen (spooky-db 3810) läuft im Validator '
  '(`validate.py <index.json>`) und ist sauber, jetzt einschließlich der Lore-Namen (Rotten, Waffen, Spielbegriffe).')
w('')
w('---')
w('')
# ---------------------------------------------------------------- 19 Review
w('## 19. Review-Entscheidungen')
w('')
w('Kritisches Review vom 2026-09-29 zu Balance, Lesbarkeit, Eigenständigkeit gegenüber FA und Vollständigkeit. Alle Werte sind aus den Rohdaten '
  'nachgerechnet (spooky-db 3810, `fa_ref.json`, Varkans `roster.json`), dazu Gefechts-Simulationen im 0,1-s-Takt mit Fokusfeuer. '
  '✓ = übernommen, ◐ = teilweise bzw. abgewandelt, ✗ = geprüft und verworfen.')
w('')
w('### 19.1 Balance')
w('')
w('**T1-Rush gegen den Kommandanten** (alle Angreifer in Reichweite, Kommandant tötet einen nach dem anderen, ohne Überschlag; beide Kommandanten nutzen '
  'dieselbe Überschlag-Formel und verschieben das Ergebnis gleich):')
w('')
w('| Angreifer → Kommandant | Einheiten (Mass) | FA-Paarung der Referenzen |')
w('|---|---|---|')
w('| Zecke → Rädelsführer | 17 (952) | 17 |')
w('| Zecke → Vogt | 18 (1.008) | 18 |')
w('| Punze → Rädelsführer | 18 (1.008) | 18 |')
w('| Punze → Vogt | 19 (1.064) | 19 |')
w('| Floh → Rädelsführer | 33 (1.155) | 33 |')
w('| Floh → Vogt | 35 (1.225) | 35 |')
w('| Stichel → Rädelsführer | 31 (930) | 31 |')
w('')
w('Ergebnis: Beide Fraktionen brauchen für den Rush auf den gegnerischen Kommandanten dieselbe Masse (Zecke → Vogt = Punze → Rädelsführer = 1.008). '
  'Der Rädelsführer ist gegen Rushes ≈ 5 % anfälliger als der Vogt (10.000 HP + 18/s gegen 12.000 + 10/s), genau wie in der FA-Paarung. Der Floh ist ein '
  'schlechter Kommandanten-Rusher (wenig DPS), das ist Vorbild-Identität.')
w('')
w('**Eco-Kurve:** Kommandant (+1 M/s, +20 E/s, 650 M / 3.900 E Speicher, BP 10), Egel I/II, Druse I/II, Glimmzelle, Wabe und Landnest I haben dieselben '
  'Kosten und Bauzeiten wie bei Varkan. Landnest II/III, Weber, Egel III und Druse III sind seit dem fraktionsübergreifenden Abgleich ebenfalls auf die Varkan-Werte gesetzt '
  '(FA-Eco ist fraktionsgleich; vorher 0,4–2,2 % Rundungsunterschied). Die Opening-Kurven sind damit identisch. Unterschiede entstehen erst an der Front: Die Zecke ist 5 % schneller gebaut (BT 285 statt 300), die Schabe kostet 8 statt 12 Mass.')
w('')
w('**Gruppengefechte gleicher Masse (N = 3–25, Mittel der überlebenden Masse, + = Skarn gewinnt):** Zecke gegen Punze −0,18 (FA-Paarung −0,11), Floh gegen Stichel '
  '+0,17 (FA +0,37; Stand vor dem fraktionsübergreifenden Abgleich, seitdem ist der Stichel FA-gleich 60 HP / 30 Mass, Stärkeverhältnis 0,96 zu FA 1,01 laut `tools/roster/cross.py`), Ohrwurm gegen Meißel −0,22 (FA −0,23; vor R2: −0,29). Die T1-Abweichungen kommen aus Varkans Breakpoint-Entscheidungen (Punze 28 Schaden, '
  'damals Stichel 70 HP) und liegen bei nahezu gleicher Tötungszeit (−1,8 %). Nahe der Parität vergrößert das Quadratgesetz kleine Unterschiede stark. Kein Handlungsbedarf auf Skarn-Seite.')
w('')
w('| Nr | Punkt | | Entscheidung und Begründung |')
w('|---|---|---|---|')
w('| R1 | Nessel: Ersatz für die Lähmung zu groß | ✓ | Nachladezeit **5,8 statt 5,6 s** (DPS/Mass +3,5 % statt +7,1 %, Pulk +3,4 %). Varkans Kelle liegt schon 8 % unter ihrer Referenz (9,0 statt 8,3 s). Mit 5,6 s stieg die Kreuz-Relation Nessel/Kelle auf +16,2 % gegenüber FA, jetzt +12,2 %. Breakpoints unverändert (Zecke und Punze je 2 Kapseln). |')
w('| R2 | Ohrwurm ohne globale HP-Verschiebung | ✓ | HP **1.980 statt 1.900** (+4,2 %, wie der Rest des Rosters). Varkans Meißel liegt +6,7 % über seiner Referenz, der Ohrwurm lag bei ±0; Kreuz-Relation HP −5,3 % → −1,3 %, Gruppengefecht jetzt auf FA-Niveau. Kein Breakpoint bricht. Eine Info-Paarung (Kelle → Ohrwurm, 20 statt 19 Salven) ist in §14.4 dokumentiert. |')
w('| R3 | Regeneration der Gebäude nicht gesichert | ◐ | Kein neues Feature: PLAN §3.4 faltet `regen` als generische Spalte (G6, MS10), Skarn kommt mit U19 danach. Bleibt als Prüfpunkt §18 Nr. 1. |')
w('| R4 | Zecke +3,7 % HP bei Varkan-Punze −2,8 % DPS: Linie zu stark? | ✗ | Nachgerechnet: Die Punze tötet die Zecke in 10 Salven (Breakpoint 280 = 10 × 28), das Gruppengefecht kippt eher zu Varkan. HP 270 änderte nichts (weiter 10 Salven). |')
w('| R5 | Langbein zerbrechlicher als Varkans Reißnadel, obwohl die Vorbild-Fraktion keinen Sniper hat | ✗ | Bleibt: Glaskanonen-Signatur (Produkt −3,2 %, Kreuz-Relation im Gate); ○-Einheit ab MS13. |')
w('| R6 | Gespinst: Kreuz-Relation −19,3 % | ✗ | Bleibt bewusst am unteren Rand: Die Vorbild-Fraktion hat keinen mobilen Schild, Skarn setzt auf Tempo und später Tarnung. Gate ±25 % hält. |')
w('')
w('### 19.2 Lesbarkeit, Silhouetten, Icons')
w('')
w('| Nr | Punkt | | Entscheidung und Begründung |')
w('|---|---|---|---|')
w('| L1 | Stechmücke nutzte den Hinterleib, das Monopol-Merkmal des Bombers | ✓ | Rumpf ist jetzt ein schlanker `carapace`-Keil. Neuer Lint in Generator und Validator: `abdomen` nur bei BOMBER ohne ANTIAIR. `v_fbomber` 76 statt 88 Tris. |')
w('| L2 | Icons | ✓ | Geprüft: gleiche Icon-IDs, 19 Glyphen und Hotbuild-Tasten wie Varkan (Generator-Assert). Die Tarnung der Schabe (V2) ändert kein Icon; `stealth` bleibt reserviert. |')
w('| L3 | Floh ↔ Zecke (beide mit Linse) | ✗ | Kein neues Pflichtpaar: Beinzahl 2 gegen 4, Panzer kürzer als die Beine, anderes Icon (`bot` gegen `direct`). |')
w('')
w('### 19.3 Eigenständigkeit gegenüber FA und Passung zum Vorbild')
w('')
w('| Nr | Punkt | | Entscheidung und Begründung |')
w('|---|---|---|---|')
w('| E1 | Rottenname „Pack Shard“ ist ein FA-Einheitenname | ✓ | Umbenannt in **Rotte Splitt / Pack Splinter** (faction.md §1). Der Validator greppt jetzt auch die Lore-Namen (Fraktion, Rotten, Waffen- und Spielbegriffe). |')
w('| E2 | M13 „Vorbild-Relation“ bei allen T3-Läufern falsch | ✓ | In spooky-db sind von den Referenzen nur Kommandant und Engineers amphibisch, nicht `URL0303`, `URL0304`, `DRLK001` oder `XAL0305`. M13 bleibt bei Rädelsführer, Flicker, Stopfer und Weber (4 statt 8 Einheiten) sowie bei den Reserve-Rollen Wasserläufer, Bisamratte und Schildwanze (deren Referenz `XRL0305` ist amphibisch). |')
w('| E3 | Dauerstrahl bei Tarantel und Langbein ohne Vorbild | ✓ | Gestrichen: Beide Referenzen feuern Pulse bzw. Projektile. Der Beam-Waffentyp bleibt als Idee für Experimentals und ein Rädelsführer-Enhancement (faction.md §9.4); keine MVP-Rolle hängt mehr an einer Feature-ID, die es noch nicht gibt. |')
w('| E4 | K18 beim Rädelsführer als „Vorbild-Relation“ | ✓ | Die Referenz hat keine EMP-Todesexplosion. Umformuliert als Skarn-eigene Ergänzung. Nessel und Tarantel behalten K18, beide Referenzen haben EMP. |')
w('| E5 | „Nachwachsen im Feld“ unter K10 | ✓ | Gestrichen: nicht aus der Vorbild-Referenz belegt (mobile Einheiten regenerieren dort nur über Veteranenstufen, U9), stärkt Skarn-Raider über die Referenz hinaus und hängt fachfremd an K10 (Schilde). |')
w('| E6 | Bisamratte (Zerstörer, der an Land läuft) zu nah am Vorbild? | ✗ | Bleibt reserviert: Übernommen wird nur die Mechanik (Layer-Wechsel), nicht Name, Form oder Lore. Das ist Anlehnung über Gameplay-Identität, wie gewünscht. |')
w('| E7 | Kampfläufer mit Reparatur (Referenz `URL0107` hat REPAIR, BP 1) | ✗ | Nicht übernommen: BP 1 ist spielerisch bedeutungslos, würde aber Repair für Nicht-Engineers in der Order-Logik erzwingen. |')
w('')
w('### 19.4 Vollständigkeit der Rollen')
w('')
w('| Nr | Punkt | | Entscheidung und Begründung |')
w('|---|---|---|---|')
w('| V1 | Rollen gegen Varkan | ✓ | Geprüft: 50/50 Rollen-IDs, gleiche MS-Zuordnung, 26 im MS9-Kern, gleiche Hotbuild-Tasten. |')
w('| V2 | Vorbild-Fähigkeiten gegen Post-MVP-Markierungen | ◐ | Alle `Display.Abilities` der 50 Referenzen abgeglichen. Ergänzt: Schabe mit **I5** (Tarnung, die Referenz hat Cloaking). Nicht markiert, weil Varkan sie ebenso ignoriert: Omni am Kommandanten (I4), `Aquatic`-Bauplatz der Flugabwehrtürme (U17), Radar der Stechmücke. |')
w('| V3 | Reserve-Rollen | ✓ | Vollständig für die Vorbild-Signaturen: mobiles und stationäres Tarnfeld, amphibischer T2-Läufer, Zerstörer an Land, gepanzerter T3-Läufer (jetzt mit M13). |')
w('')
# ---------------------------------------------------------------- 20 Experimentals
XP = D.get('experimentals', [])
if XP:
    w('---')
    w('')
    w('## 20. Experimentals (T4, Post-MVP)')
    w('')
    w(f"{len(XP)} T4-Rollen, **nicht** in der Zählung oben und ohne Sim-Wirkung vor ihren Features. Design, Lore, Kitbash und Icons: "
      "`experimentals.md`. Daten und Gates: `tools/roster/f2/exp.py` (von `gen.py` eingebunden), Referenzen `fa_ref_t4.json` (Vorbild-T4, dev-only). "
      "Gates: DPS/Mass, HP/Mass und Produkt je ±15 % gegen die Vorbild-T4, Pulk ±15 % bei Artillerie, Identität „billiger, schneller, "
      "zerbrechlicher“ (Mass ≤, Tempo ≥, HP/Mass ≤ Referenz), Setons-Brücke (≥ 6 nebeneinander auf 72 WU), T4-Budget (≤ 1.200 Tris L0, ≤ 12 Parts, ≤ 3 animiert).")
    w('')
    w('| ID | Name DE / EN | Rolle | Mass | Energy | BT | HP | Regen | DPS | Tempo | Footprint · s | Beine | Icon | Hotbuild |')
    w('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for x in XP:
        e = x['economy']; mo = x['motion']
        w(f"| `{x['id']}` | **{x['name']['de']}** / {x['name']['en']} | {x['role']['de']} | {f(e['mass'])} | {f(e['energy'])} | {f(e['buildTime'])} | "
          f"{f(x['health']['max'])} | {f(x['health']['regenPerSec'])} | {f(x['balance']['dps'], 0)} | {f(mo['speed']) if mo['speed'] else '–'} | "
          f"{mo['footprint'][0]}×{mo['footprint'][1]}{' · ' + str(mo['sizeClass']) if mo.get('sizeClass') is not None else ''} | {mo.get('legs') or '–'} | `{x['icon']}` | {x['hotbuild']['slot']} |")
    w('')
    w('**Waffen:**')
    w('')
    w('| Einheit | Waffe | Schaden × Salve / Nachladen | DPS | RW (min) | Splash | Ziel |')
    w('|---|---|---|---|---|---|---|')
    for x in XP:
        for wp in x['weapons']:
            w(f"| {x['name']['de']} | {wp['type']} | {f(wp['damage'])} × {wp['salvo']} / {f(wp['reloadS'])} s | {f(wp['dps'], 0)} | "
              f"{f(wp['range'])}{' (' + f(wp['rangeMin']) + ')' if wp.get('rangeMin') else ''} | {f(wp['splash']) if wp['splash'] else '–'} | {', '.join(wp['layers'])} |")
        dw = x['special']['deathWeapon']
        w(f"| {x['name']['de']} | Todeswaffe | {f(dw['damage'])} im Radius {f(dw['radius'])} | – | – | – | – |")
    w('')
    w('**Balance gegen die Vorbild-T4** (Referenz dev-only über Blueprint-Präfix):')
    w('')
    w('| Einheit | Referenz | ΔDPS/Mass | ΔHP/Mass | ΔProdukt | Pulk | Identität (Mass ≤ · Tempo ≥ · HP/Mass ≤) | Amortisation |')
    w('|---|---|---|---|---|---|---|---|')
    for x in XP:
        b = x['balance']; idt = b.get('identity')
        pay = b.get('payback')
        w(f"| {x['name']['de']} | `{x['faReference']['bp'] or x['faReference'].get('infoBp') + ' (Fremdreferenz, Info)'}` | {pct(b.get('devDpsPerMassPct'))} | "
          f"{pct(b.get('devHpPerMassPct'))} | {pct(b.get('devProductPct'))} | {pct((b.get('pulk') or {}).get('devPct'))} | "
          f"{' · '.join('✓' if v else '✗' for v in idt.values()) if idt else '–'} | "
          f"{(f(pay['paybackS'], 0) + ' s = ' + f(pay['ratio'], 2) + ' × Egel-Kette (' + f(pay['mexChainPaybackS'], 0) + ' s)') if pay else '–'} |")
    w('')
    w('**Kitbash:**')
    w('')
    w('| Einheit | Monopol-Merkmal | Parts | animiert | ≈ Tris L0 (ohne Beine) | Außenmaß (L × B × H, Beinspanne) | Brücke |')
    w('|---|---|---|---|---|---|---|')
    for x in XP:
        k = x['kitbash']; dm = x['motion']['dimensionsWU']; br = x['motion'].get('bridge')
        w(f"| {x['name']['de']} | {k['monopoly']} | {k['partCount']} | {k['animatedParts']} | {k['trisEstimate']} | "
          f"{f(dm['length'])} × {f(dm['width'])} × {f(dm['height'])}{', ' + f(dm['legSpan']) if dm.get('legSpan') else ''} WU | "
          f"{str(br['abreast']) + ' nebeneinander' if br else '–'} |")
    w('')
    w('**Post-MVP-Features je Einheit:**')
    w('')
    w('| Einheit | braucht | Eigenheiten mit Feature-ID |')
    w('|---|---|---|')
    for x in XP:
        w(f"| {x['name']['de']} | {', '.join(x['needs'])} | " + '<br>'.join(f"**{p['feature']}**: {p['effect']}" for p in x['special']['postMvp']) + ' |')
    w('')

open(os.path.join(P, 'roster.md'), 'w').write('\n'.join(L))
print('roster.md', len(L), 'Zeilen')
