# Unabhängige Prüfung von docs/design/factions/f4/roster.json gegen die FA-Referenz der Vorbild-Fraktion (fa_ref.json).
# Rechnet alles aus Rohwerten neu (vertraut keinem balance-Feld) und prüft:
#   - |Δ DPS/Mass| und |Δ HP/Mass| ≤ 25 % (hartes Gate PLAN U3) und ≤ 15 % (Ziel), |Δ Produkt| ≤ 15 %, |Δ Pulk| ≤ 15 % (ARTILLERY)
#   - Treffer-bis-Tod-Matrix exakt wie FA (neu berechnet aus fa_ref.json, nicht aus checks.fa)
#   - Schema-Konsistenz (Zählung, IDs mit f4:-Präfix, dps-Formel, 0,1-s-Ticks, Upgrade-Verweise, dev-only-Flag)
#   - Experimentals (T4, Schlüssel `experimentals`): Gates gegen fa_ref_t4.json, Icon-Grammatik t4, Setons-Brücke, T4-Kitbash-Budget,
#     Rufnamen gegen alle Roster (inkl. Reserve und T4 anderer Fraktionen, Abstand ≥ 2) und FA-Namen/-Fraktionsbegriffe
# Aufruf: python3 validate.py [-v] [pfad/zu/roster.json]   (Exit-Code 1 bei Verstößen)
import json, math, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARGS = [a for a in sys.argv[1:] if not a.startswith('-')]
D = json.load(open(ARGS[0] if ARGS else HERE.parents[2] / 'docs/design/factions/f4/roster.json'))
FA = json.load(open(HERE / 'fa_ref.json'))
U = D['units']; ID = {u['id']: u for u in U}
err, warn = [], []


def fa_reload(rof): return math.floor(10 / rof + 1e-6) / 10


def fa_salvo(bp, idx=None):
    ws = FA[bp]['weapons']
    w = ws[idx] if idx is not None else max(
        (w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']), key=lambda w: w['dps'])
    rel = fa_reload(w['rof'])
    return w['dmg'] * round(w['dps'] * rel / w['dmg']), rel, w


def targets(splash): return math.pi * (splash + 0.5) ** 2 / 4


# ---- Zählung / Schema
c = D['counts']
if not (c['total'] == len(U) == 49): err.append(('counts.total', c['total'], len(U)))
if c['ms9Core'] != sum(u['ms9Core'] for u in U): err.append(('counts.ms9Core',))
if not 45 <= len(U) <= 55: err.append(('Band 45–55', len(U)))
if not 25 <= c['ms9Core'] <= 30: err.append(('MS9-Band 25–30', c['ms9Core']))
if len(ID) != len(U): err.append(('doppelte IDs',))

rows = []
for u in U:
    i = u['id']; b = u['balance']; fa = b['fa']; r = FA[fa['bp']]
    if not i.startswith('f4:'): err.append((i, 'Präfix'))
    if u['faReference']['devOnly'] is not True: err.append((i, 'devOnly'))
    if fa['bp'] != u['faReference']['bp']: err.append((i, 'faReference.bp != balance.fa.bp'))
    for k in ('upgradesTo', 'upgradeFrom'):
        if u['special'][k] and u['special'][k] not in ID: err.append((i, k))
    for w in u['weapons']:
        if abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) > 0.01: err.append((w['ref'], 'dps-Formel'))
        if abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) > 1e-9: err.append((w['ref'], '0,1-s-Tick'))
    # eigene Werte
    idx = None
    ws = u['weapons']
    dps = b['dps'] or 0
    m = u['economy']['mass']
    hp = u['health']['max'] + ((u['shield'] or {}).get('hp', 0))
    # FA-Werte roh aus fa_ref.json
    fdps = sum(r['weapons'][k]['dps'] for k in fa['dpsWeapons']) if fa.get('dpsWeapons') else r['dps']
    fhp = r['hp'] + (r['shield'] or 0)
    dh = (hp / m) / (fhp / r['mass']) - 1
    dd = (dps / m) / (fdps / r['mass']) - 1 if dps and fdps else None
    dp = (1 + dd) * (1 + dh) - 1 if dd is not None else None
    # DPS muss der Summe der gewerteten eigenen Waffen entsprechen
    if dps and not any(abs(dps - s) < 0.02 for s in (sum(w['dps'] for w in ws), ws[0]['dps'])):
        err.append((i, 'balance.dps passt zu keiner Waffensumme'))
    for name, v, lim in (('ΔDPS/Mass', dd, 25), ('ΔHP/Mass', dh, 25)):
        if v is not None and abs(v) * 100 > lim: err.append((i, name, round(v * 100, 1), f'>±{lim} %'))
    for name, v in (('ΔDPS/Mass', dd), ('ΔHP/Mass', dh), ('ΔProdukt', dp)):
        if v is not None and abs(v) * 100 > 15: err.append((i, name, round(v * 100, 1), '>±15 %'))
    # gespeicherte Abweichungen stimmen?
    if abs(dh * 100 - b['devHpPerMassPct']) > 0.11: err.append((i, 'devHpPerMassPct', b['devHpPerMassPct'], round(dh * 100, 2)))
    if dd is not None and abs(dd * 100 - b['devDpsPerMassPct']) > 0.11: err.append((i, 'devDpsPerMassPct'))
    pk = None
    if 'ARTILLERY' in u['categories'] and ws and ws[0].get('splash'):
        w = ws[0]; fs, frel, fw = fa_salvo(fa['bp'])
        ours = w['damage'] * w['salvo'] * targets(w['splash']) / w['reloadS'] / m
        theirs = fs * targets(fw['splash'] or 0) / frel / r['mass']
        pk = ours / theirs - 1
        if abs(pk) * 100 > 15: err.append((i, 'ΔPulk', round(pk * 100, 1)))
    rows.append((i, dd, dh, dp, pk))

# ---- Treffer bis Tod: neu aus fa_ref.json
for h in D['checks']['hitsToKill']:
    a, t = ID[h['attacker']], ID[h['target']]
    w = next(w for w in a['weapons'] if w['ref'] == h['weapon'])
    ours = math.ceil(t['health']['max'] / (w['damage'] * w['salvo']))
    fs, _, _ = fa_salvo(a['faReference']['bp'], h['fa'].get('weaponIdx'))
    theirs = math.ceil(FA[t['faReference']['bp']]['hp'] / fs)
    if ours != theirs: err.append(('Treffer-bis-Tod', h['attacker'], h['target'], ours, theirs))
    if ours != h['hits'] or theirs != h['fa']['hits']: err.append(('Treffer-Feld veraltet', h['attacker'], h['target']))

# ---- Pflichtpaare nur ●
for p in D['silhouettePairs']['ms9']:
    if not all(ID[x]['ms9Core'] for x in p): err.append(('Silhouettenpaar nicht ●', p))

# ---- Doppelwaffen der Referenz ausgewertet (Review R1: spooky-db WeaponNumber)
if any('count' not in w for r in FA.values() for w in r['weapons']): err.append(('fa_ref.json ohne weapons[].count – ref.py neu laufen lassen',))

# ---- Rufnamen fraktionsübergreifend eindeutig (Review R10); Stufenzahl I–III zählt nicht
import re
base = lambda s: re.sub(r' (I|II|III)$', '', s)
other = {}
for f_ in [HERE.parents[2] / 'docs/design/roster.json'] + sorted((HERE.parents[2] / 'docs/design/factions').glob('*/roster.json')):
    us = json.load(open(f_))['units']
    if us and us[0]['id'].split(':')[0] == 'f4': continue  # eigene Fraktion
    for u in us:
        for lang in ('de', 'en'): other.setdefault((lang, base(u['name'][lang])), f_.parent.name)
for u in U:
    for lang in ('de', 'en'):
        k = (lang, base(u['name'][lang]))
        if k in other: err.append(('Namenskollision', u['id'], k[1], other[k]))

# ---- Kreuz-Silhouettenpaare zeigen auf existierende Fremd-IDs (sofern deren Roster vorliegt)
known = {u['id'] for f_ in [HERE.parents[2] / 'docs/design/roster.json'] + sorted((HERE.parents[2] / 'docs/design/factions').glob('*/roster.json'))
         for u in json.load(open(f_))['units']}
for a_, b_ in D['silhouettePairs'].get('crossFaction', []):
    if a_ not in ID: err.append(('crossFaction: eigene ID fehlt', a_))
    ns = b_.split(':')[0]
    if (ns == 'core' or (HERE.parents[2] / f'docs/design/factions/{ns}/roster.json').exists()) and b_ not in known:
        err.append(('crossFaction: Fremd-ID unbekannt', b_))

# ---- Experimentals (T4, Post-MVP; experimentals.md): unabhängig aus fa_ref_t4.json neu gerechnet
XP = D.get('experimentals', [])
FA4 = json.load(open(HERE / 'fa_ref_t4.json'))
FAN = json.load(open(HERE.parent / 'fa_names.json'))
GENERIC = {'air', 'land', 'high', 'sea', 'i', 'ii', 'iii', 'heavy', 'light', 'sky', 'master'}  # wie cross.py
FA_WORDS = {w.lower() for s_ in FAN['unitNames'] + FAN['weaponNames'] for w in re.findall(r"[A-Za-zÀ-ÿ]+", s_)} - GENERIC
FA_FACTION = ['uef', 'cybran', 'aeon', 'seraphim', 'illuminate', 'symbiont', 'quantum', 'loyalist', 'coalition', 'order of the']


def lev(a, b):
    a, b = a.lower(), b.lower(); dp = list(range(len(b) + 1))
    for i_, ca in enumerate(a, 1):
        prev, dp[0] = dp[0], i_
        for j, cb in enumerate(b, 1):
            prev, dp[j] = dp[j], min(dp[j] + 1, dp[j - 1] + 1, prev + (ca != cb))
    return dp[-1]


if c.get('experimentals', 0) != len(XP): err.append(('counts.experimentals', c.get('experimentals'), len(XP)))
if not 4 <= len(XP) <= 5: err.append(('T4-Anzahl 4–5', len(XP)))
doms = [x['icon'].split('_')[0] for x in XP]
if doms.count('land') < 1 or doms.count('air') < 1 or not any(x['icon'].startswith('struct_') for x in XP):
    err.append(('T4-Mischung: mind. 1 Land, 1 Luft, 1 Struktur', doms))
names_all = {}  # (Sprache, Rufname) -> Quelle, über alle Roster inkl. reservierter Rollen und T4 anderer Fraktionen
for f_ in [HERE.parents[2] / 'docs/design/roster.json'] + sorted((HERE.parents[2] / 'docs/design/factions').glob('*/roster.json')):
    d_ = json.load(open(f_)); ns_ = d_['units'][0]['id'].split(':')[0]
    for u in d_['units'] + d_.get('experimentals', []):
        if u['id'] in {x['id'] for x in XP}: continue
        for lang in ('de', 'en'): names_all.setdefault((lang, base(u['name'][lang])), (ns_, u['id']))
    for r_ in d_.get('reservedPostMvp', []):
        for lang in ('de', 'en'): names_all.setdefault((lang, base(r_[lang])), (ns_, r_['id']))
glyph_ok = set(D['iconGlyphs'])
xrows = []
for x in XP:
    i = x['id']; b = x['balance']; r = FA4[x['faReference']['bp']]; m = x['economy']['mass']
    if not i.startswith('f4:exp_') or i in ID: err.append((i, 'T4-ID'))
    if (x['tier'], x['tech'], x['postMvp'], x['ms9Core']) != ('T4', 4, True, False): err.append((i, 'tier/tech/postMvp/ms9Core'))
    if x['faReference']['devOnly'] is not True: err.append((i, 'devOnly'))
    if not {p['feature'] for p in x['special']['postMvp']} <= set(x['needs']): err.append((i, 'needs ⊉ postMvp'))
    for w in x['weapons']:
        if abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) > 0.01: err.append((w['ref'], 'dps-Formel'))
        if abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) > 1e-9: err.append((w['ref'], '0,1-s-Tick'))
    gnd = sum(w['dps'] for w in x['weapons'] if 'land' in w['layers'] and w['damage'] < 100000)
    air = sum(w['dps'] for w in x['weapons'] if 'air' in w['layers'])
    fg = sum(w['dps'] for w in r['weapons'] if w['cat'] not in ('Death', 'Anti Air', 'Anti Navy', 'Missile', 'Defense', 'Experimental', None))
    fa_ = sum(w['dps'] for w in r['weapons'] if w['cat'] == 'Anti Air')
    hp = x['health']['max'] + ((x['shield'] or {}).get('hp', 0)); fhp = r['hp'] + (r['shield'] or 0)
    dd = (gnd / m) / (fg / r['mass']) - 1 if gnd and fg else None
    da = (air / m) / (fa_ / r['mass']) - 1 if air and fa_ else None
    dh = (hp / m) / (fhp / r['mass']) - 1
    dm = m / r['mass'] - 1
    dp = (1 + dd) * (1 + dh) - 1 if dd is not None else None
    if (gnd and not fg) or (fg and not gnd): err.append((i, 'Boden-DPS nur auf einer Seite'))
    for name, v, lim in (('ΔDPS/Mass', dd, 15), ('ΔHP/Mass', dh, 15), ('ΔProdukt', dp, 15), ('ΔMass', dm, 15), ('ΔLuft-DPS/Mass', da, 25)):
        if v is not None and abs(v) * 100 > lim: err.append((i, name, round(v * 100, 1), f'>±{lim} %'))
    if abs(dh * 100 - b['devHpPerMassPct']) > 0.11 or (dd is not None and abs(dd * 100 - b['devDpsPerMassPct']) > 0.11):
        err.append((i, 'balance-Feld veraltet'))
    pk = None
    if 'ARTILLERY' in x['categories']:
        w = x['weapons'][0]
        fw = r['weapons'][0]; frel = fa_reload(fw['rof']); fs = fw['dmg'] * round(fw['dps'] * frel / fw['dmg'])
        pk = (w['damage'] * w['salvo'] * targets(w['splash']) / w['reloadS'] / m) / (fs * targets(fw['splash'] or 0) / frel / r['mass']) - 1
        if abs(pk) * 100 > 15: err.append((i, 'ΔPulk', round(pk * 100, 1)))
    # Icon: gemeinsame Grammatik, Stufe t4 (Klammer statt Kerben), keine neue Glyphe
    dom, _, rest = x['icon'].partition('_'); g_, _, lvl = rest.rpartition('_')
    if dom not in ('land', 'air', 'struct') or lvl != 't4' or g_ not in glyph_ok: err.append((i, 'Icon-Grammatik', x['icon']))
    # Setons-Brücke (≥ 72 WU): mobile Land-T4 ≥ 6 nebeneinander, sizeClass = ceil(Außenmaß/2) ≤ 7
    mo = x['motion']
    if mo['layer'] == 'land' and not mo.get('structure'):
        br = mo.get('bridge') or {}
        ow = br.get('outerWidthWU') or 99
        if 72 // ow < 6 or mo['sizeClass'] != math.ceil(ow / 2) or mo['sizeClass'] > 7: err.append((i, 'Setons-Brücke', br, mo['sizeClass']))
    k = x['kitbash']
    if k['partCount'] != len(k['parts']) or k['partCount'] > 10 or k['animatedParts'] > 4 or k['trisEstimate'] > k['trisBudget']['L0']:
        err.append((i, 'T4-Kitbash-Budget', k['partCount'], k['animatedParts'], k['trisEstimate']))
    if k['trisBudget'] != dict(L0=1500, L1=800, L2=320): err.append((i, 'trisBudget ≠ @faf/modelkit T4_BUDGET'))
    for p_ in x['silhouettePairs']:
        if p_ not in ID: err.append((i, 'Silhouettenpaar unbekannt', p_))
    # Namen: Abstand ≥ 2 zu allen Rufnamen (alle Fraktionen, auch T4 und Reserve), kein Wort aus FA-Namen, kein FA-Fraktionsbegriff
    for lang in ('de', 'en'):
        nm = base(x['name'][lang])
        for (l2, n2), src in names_all.items():
            if l2 == lang and lev(nm, n2) <= 1: err.append((i, 'Rufname zu nah', nm, n2, src))
        for w in re.findall(r"[A-Za-zÄÖÜäöüß]+", x['name'][lang]):
            if w.lower() in FA_WORDS: err.append((i, 'Rufname-Wort in FA-Namen', w))
    for s_ in [x['name']['de'], x['name']['en'], x['role']['de'], x['role']['en']] + [w['type'] for w in x['weapons']]:
        for t_ in FA_FACTION:
            if re.search(r'\b' + t_ + r'\b', s_, re.I): err.append((i, 'FA-Fraktionsbegriff', t_, s_))
    xrows.append((i, dd, dh, dp, pk, da, dm))

f = lambda v: '–' if v is None else f'{v * 100:+.1f}'
mx = lambda k: max(((abs(r[k]), r[0]) for r in rows if r[k] is not None))
print(f"JSON valide, {len(U)} Einträge ({c['mobile']} mobil / {c['structures']} Gebäude), MS9-Kern {c['ms9Core']}, Visuals {c['visuals']}")
print(f"max |ΔDPS/Mass| {mx(1)[0]*100:.1f} % ({mx(1)[1]}), max |ΔHP/Mass| {mx(2)[0]*100:.1f} % ({mx(2)[1]}), "
      f"max |ΔProdukt| {mx(3)[0]*100:.1f} % ({mx(3)[1]}), max |ΔPulk| {mx(4)[0]*100:.1f} % ({mx(4)[1]})")
print(f"Treffer-bis-Tod: {len(D['checks']['hitsToKill'])} Paare neu gerechnet")
print(f"Experimentals (T4, Post-MVP): {len(XP)} gegen fa_ref_t4.json neu gerechnet; "
      + ', '.join(f"{x['name']['de']} {f(r_[1])}/{f(r_[2])}" for x, r_ in zip(XP, xrows)) + ' (Δ DPS/Mass / Δ HP/Mass in %)')
if '-v' in sys.argv:
    for r in rows: print(f'  {r[0]:22s} DPS/M {f(r[1]):>7} HP/M {f(r[2]):>7} Prod {f(r[3]):>7} Pulk {f(r[4]):>7}')
    for r in xrows: print(f'  {r[0]:22s} DPS/M {f(r[1]):>7} HP/M {f(r[2]):>7} Prod {f(r[3]):>7} Pulk {f(r[4]):>7} Luft {f(r[5]):>7} Mass {f(r[6]):>7}')
print('Verstöße:', err or 'keine')
sys.exit(1 if err else 0)
