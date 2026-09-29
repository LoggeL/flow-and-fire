# Unabhängiger Prüfer für docs/design/factions/f3/roster.json (Fraktion f3 „Orden von Sael“).
# Rechnet alle Gates aus den Rohfeldern neu (nicht aus den balance-Feldern) gegen tools/roster/f3/fa_ref.json
# und prüft Kreuz-Breakpoints gegen docs/design/roster.json (Varkan) + tools/roster/fa_ref.json.
# Aufruf: python3 tools/roster/f3/validate.py      Exit 1 bei Verstoß.
import json, math, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
D = json.load(open(ROOT / 'docs/design/factions/f3/roster.json'))
VK = json.load(open(ROOT / 'docs/design/roster.json'))
FA = json.load(open(HERE / 'fa_ref.json'))
FA_VK = json.load(open(ROOT / 'tools/roster/fa_ref.json'))
# dieselben develop-Korrekturen wie gen.py (bewusst dupliziert: der Prüfer soll gen.py nicht importieren)
FA['UAA0102']['dps'] = 48.0
for w in FA['UAA0102']['weapons']:
    if w['cat'] == 'Anti Air': w['dps'] = 48.0
FA['DEA0202']['dps'] = 310.0  # zwei Luftkanonen à 75 + Bomben 160 (fraktionsübergreifender Abgleich)
for w in FA['DEA0202']['weapons']:
    if w['cat'] == 'Anti Air': w['dps'] = 150.0

U = D['units']; ids = {u['id'] for u in U}; UID = {u['id']: u for u in U}
VKU = {u['id'].split(':')[1]: u for u in VK['units']}; VKID = {u['id']: u for u in VK['units']}
err = []
def bad(*a): err.append(a)

# ---- Struktur, Rollenabdeckung, Schema
if not (D['schema'] == VK['schema'] == 'faf-roster/1'): bad('schema')
if not (D['counts']['total'] == len(U) == 50): bad('count', len(U))
if D['counts']['ms9Core'] != sum(u['ms9Core'] for u in U): bad('ms9 count')
if {i.split(':')[1] for i in ids} != set(VKU): bad('Rollen weichen von Varkan ab')
vk_keys = set(VK['units'][0])
for u in U:
    r = u['id'].split(':')[1]; v = VKU[r]
    if not u['id'].startswith('f3:'): bad(u['id'], 'Namespace')
    if not vk_keys <= set(u): bad(u['id'], 'fehlende Schema-Felder', vk_keys - set(u))
    for k in ('icon', 'ms9Core', 'msFirst', 'tech', 'visual'):
        if u[k] != v[k]: bad(u['id'], k, u[k], v[k])
    if (u['hotbuild'] or {}).get('slot') != (v['hotbuild'] or {}).get('slot'): bad(u['id'], 'hotbuild')
    if u['faReference']['devOnly'] is not True: bad(u['id'], 'devOnly')
    for k in ('upgradesTo', 'upgradeFrom'):
        if u['special'][k] and u['special'][k] not in ids: bad(u['id'], k)
    for p in u['special'].get('postMvp', []):
        if not (p.get('feature') and p.get('fallback')): bad(u['id'], 'postMvp ohne Feature/Fallback')

# ---- Balance aus Rohfeldern
def fa_hpm(bp): r = FA[bp]; return (r['hp'] + (r['shield'] or 0)) / r['mass']
def fa_dpm(bp): r = FA[bp]; return r['dps'] / r['mass'] if r['dps'] else None
def fa_reload(rof): return math.floor(10 / rof + 1e-6) / 10
def fa_w(fa, bp, idx=None):
    ws = fa[bp]['weapons']
    w = ws[idx] if idx is not None else max([w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']],
                                            key=lambda w: w['dps'])
    rel = fa_reload(w['rof']); return w['dmg'], round(w['dps'] * rel / w['dmg']), rel, (w['splash'] or 0)
pulkT = lambda s: math.pi * (s + 0.5) ** 2 / 4

rows = []
for u in U:
    bp = u['faReference']['bp']; m = u['economy']['mass']
    ws = u['weapons']
    for w in ws:
        if abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) > 0.01: bad(w['ref'], 'dps')
        if abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) > 1e-9: bad(w['ref'], 'reload tick')
    main = [ws[0]] if u['id'].endswith('cmd_commander') else ws
    dps = sum(w['dps'] for w in main)
    hp = u['health']['max'] + (u['shield'] or {}).get('hp', 0)
    dh = (hp / m / fa_hpm(bp) - 1) * 100
    dd = (dps / m / fa_dpm(bp) - 1) * 100 if dps else None
    dp = ((1 + dd / 100) * (1 + dh / 100) - 1) * 100 if dps else None
    for name, v in (('DPS/Mass', dd), ('HP/Mass', dh)):
        if v is not None and abs(v) > 25: bad(u['id'], name, 'Gate ±25', round(v, 1))
    for name, v in (('DPS/Mass', dd), ('HP/Mass', dh), ('Produkt', dp)):
        if v is not None and abs(v) > 15: bad(u['id'], name, 'Ziel ±15', round(v, 1))
    b = u['balance']
    if abs(dh - b['devHpPerMassPct']) > 0.1 or (dd is not None and abs(dd - b['devDpsPerMassPct']) > 0.1): bad(u['id'], 'balance-Feld veraltet')
    if 'ARTILLERY' in u['categories'] and ws and ws[0].get('splash'):
        w = ws[0]; d, s, r, sp = fa_w(FA, bp)
        ours = w['damage'] * w['salvo'] * pulkT(w['splash']) / w['reloadS'] / m
        theirs = d * s * pulkT(sp) / r / FA[bp]['mass']
        pk = (ours / theirs - 1) * 100
        if abs(pk) > 15: bad(u['id'], 'Pulk ±15', round(pk, 1))
    rows.append((u['id'], dd, dh, dp))

# ---- Treffer bis Tod (intern exakt Vorbild, Kreuz gegen Varkan)
def side(i):
    if i.startswith('f3:'): return UID[i], FA, UID[i]['faReference']['bp']
    return VKID[i], FA_VK, VKID[i]['faReference']['bp']
def tgt_hp(fa, bp):
    r = fa[bp]; pers = 'Personal Shield' in (r.get('abilities') or []) or bp == 'UEL0303'
    return r['hp'] + ((r['shield'] or 0) if pers else 0)
def check(h, cross):
    a, fa_a, abp = side(h['attacker']); t, fa_t, tbp = side(h['target'])
    w = next(w for w in a['weapons'] if w['ref'] == h['weapon'])
    fidx = 0 if h['attacker'].endswith('cmd_commander') else None
    d, s, r, _ = fa_w(fa_a, abp, fidx)
    ours = math.ceil(t['health']['max'] / (w['damage'] * w['salvo'])); theirs = math.ceil(tgt_hp(fa_t, tbp) / (d * s))
    if ours != h['hits'] or theirs != h['fa']['hits']: bad('HTK-Feld veraltet', h['attacker'], h['target'])
    if (ours == theirs) != h['match']: bad('HTK match-Flag', h['attacker'], h['target'])
    if h.get('required', True) and ours != theirs: bad('Treffer-bis-Tod' + (' (Kreuz)' if cross else ''), h['attacker'], h['target'], ours, theirs)
    return ours == theirs
htk_ok = [check(h, False) for h in D['checks']['hitsToKill']]
x = D['checks']['crossHitsToKill']
x_ok = [check(h, True) for h in x]

# ---- Lints: Monopole, Budget, Teamfarbe, Namen
FLOW = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
for u in U:
    c = set(u['categories']); k = u['kitbash']; pn = [p['part'] for p in k['parts']]; flow = bool(c & FLOW)
    mob = u['group'] in ('cmd', 'land', 'air')
    if k['partCount'] > (7 if mob else 9) or k['animatedParts'] > 2 or k['trisEstimate'] > 350: bad(u['id'], 'Kitbash-Budget')
    if 'spine' in pn and not ('ANTIAIR' in c and 'AIR' not in c): bad(u['id'], 'Stachel-Monopol')
    if 'horn' in pn and 'ARTILLERY' not in c: bad(u['id'], 'Horn-Monopol')
    if 'lance' in pn and 'orb' not in pn: bad(u['id'], 'Lanze ohne Perle')
    if pn.count('orb') > 1: bad(u['id'], 'mehr als 1 Perle')
    if any(p['part'] in ('lantern', 'sickle') or p.get('mat') == 'glow' for p in k['parts']) and not flow: bad(u['id'], 'Licht-Monopol')
    if ('hoverpad' in pn) != (u['motion'].get('gait') == 'hover'): bad(u['id'], 'Schwebeteller/Gangart')
    if not any(p.get('mat') == 'team' for p in k['parts']): bad(u['id'], 'Teamfarbe')
for vid, v in D['visuals'].items():
    mob = UID[v['members'][0]]['group'] in ('cmd', 'land', 'air')
    if v['supersetParts'] > (8 if mob else 9) or v['trisEstimate'] > 350: bad(vid, 'Superset-Budget')
if set(D['visuals']) != set(VK['visuals']) or D['iconGlyphs'] != VK['iconGlyphs']: bad('Visual-/Glyphen-Satz weicht von Varkan ab')

# FA-Begriffe in Anzeigefeldern (Name, Rolle, Waffenbezeichnung): faction.md §2.5 + alle FA-Waffennamen beider fa_ref-Dateien
BAN = ['Aeon', 'Cybran', 'UEF', 'Seraphim', 'Illuminate', 'Symbiont', 'Quantum', 'Overcharge', 'Princess', 'Crusade', 'The Way',
       'Tide', 'Echo', 'Flood', 'Mole', 'Cormorant', 'Wisp', 'Shimmer', 'Mirage', 'Commander']
for fa in (FA, FA_VK):
    for k_, r in fa.items():
        if k_ == '_meta': continue
        for w in r['weapons']:
            if w['name'] and len(w['name']) > 4 and w['name'] not in ('Death Weapon', 'Air Crash', 'Teleport in', 'Death Nuke'): BAN.append(w['name'])
BAN = sorted(set(BAN))
for u in U:
    shown = [u['name']['de'], u['name']['en'], u['role']['de']] + [w['type'] for w in u['weapons']]
    for s in shown:
        for t in BAN:
            if re.search(r'\b' + re.escape(t) + r'\b', s, re.I): bad(u['id'], 'FA-Begriff in Anzeigefeld', t, s)

# Volltext-Grep gegen alle FA-Einheiten- und Waffennamen (spooky-db 3810, tools/roster/fa_names.json, dev-only):
# kein Wort eines Rufnamens (DE/EN) darf als ganzes Wort in einem FA-Namen vorkommen; generische Wörter sind erlaubt.
FAN = json.load(open(HERE.parent / 'fa_names.json'))  # gemeinsam für alle Fraktionen (tools/roster/fa_names.json)
FA_WORDS = {w.lower() for nm_ in FAN['unitNames'] + FAN['weaponNames'] for w in re.findall(r"[A-Za-zÀ-ÿ]+", nm_)}
GENERIC = {'air', 'land', 'high', 'sea', 'i', 'ii', 'iii'}
for u in U:
    for l in ('de', 'en'):
        for w in re.findall(r"[A-Za-zÄÖÜäöüß]+", u['name'][l]):
            if w.lower() in FA_WORDS and w.lower() not in GENERIC: bad(u['id'], 'Rufname-Wort in FA-Namen', w)

# Verwechslung mit Rufnamen der anderen Fraktionen (faction.md §7.1 Regel 8, ab Review auf alle Fraktionen erweitert):
# gleicher Name oder nur ein Buchstabe Unterschied (ohne Stufenziffer) ist verboten.
def lev(a, b):
    a, b = a.lower(), b.lower(); dp = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, dp[0] = dp[0], i
        for j, cb in enumerate(b, 1):
            prev, dp[j] = dp[j], min(dp[j] + 1, dp[j - 1] + 1, prev + (ca != cb))
    return dp[-1]
base = lambda s_: re.sub(r'\s+(I|II|III)$', '', s_)
others = [ROOT / 'docs/design/roster.json'] + sorted(p_ for p_ in (ROOT / 'docs/design/factions').glob('*/roster.json') if p_.parent.name != 'f3')
n_other = 0
for path in others:
    try: O = json.load(open(path))
    except Exception as ex: print('Hinweis: Namensabgleich übersprungen', path, ex); continue
    onames = {(l, base(o['name'][l])) for o in O['units'] for l in ('de', 'en')}; n_other += 1
    for u in U:
        for l in ('de', 'en'):
            mine = base(u['name'][l])
            for ol, on in onames:
                if ol == l and lev(mine, on) <= 1: bad(u['id'], 'Rufname zu nah an', path.parent.name, on)

# Streuung: ballistische Artilleriewaffen tragen firingRandomness (K1, Review 2026-09-29)
for u in U:
    if 'ARTILLERY' in u['categories']:
        for w in u['weapons']:
            if w['projectile'].startswith('ballistisch') and w.get('firingRandomness') is None: bad(w['ref'], 'firingRandomness fehlt')

# T1-Rush gegen den Kommandanten (rush.py): Felder aktuell, Pflichtpaare = FA
sys.path.insert(0, str(HERE))
import rush as RUSH
rush_ok = []
for r_ in D['checks'].get('rush', []):
    a_, fa_a, abp = side(r_['attacker']); c_, fa_c, cbp = side(r_['commander'])
    q = RUSH.row(a_, c_, fa_a, abp, fa_c, cbp, r_['required'])
    if (q['n'], q['nOc'], q['fa']['n'], q['fa']['nOc']) != (r_['n'], r_['nOc'], r_['fa']['n'], r_['fa']['nOc']): bad('Rush-Feld veraltet', r_['attacker'], r_['commander'])
    if r_['required'] and not q['match']: bad('Rush weicht von FA ab', r_['attacker'], r_['commander'], q['n'], q['fa']['n'])
    rush_ok.append(q['match'])
if len(rush_ok) < 3: bad('checks.rush fehlt')

# ---- Experimentals (T4, Post-MVP): unabhängig aus den Rohfeldern neu gerechnet (exp.py wird nicht importiert)
XP = D.get('experimentals', [])
FA4 = json.load(open(HERE / 'fa_ref_t4.json'))
for w in FA4['XAB2307']['weapons']:
    if w['cat'] == 'Artillery': w['dps'] = 425.81  # develop: 6 Splitter à 220 / 3,1 s (spooky zählt einen), wie exp.FA_T4_OVERRIDES
if not (4 <= len(XP) <= 5 and D['counts'].get('experimentals') == len(XP)): bad('T4-Anzahl', len(XP))
grp = [xe['group'] for xe in XP]
if grp.count('land') < 1 or grp.count('air') < 1 or not any('STRATEGIC' in xe['categories'] for xe in XP): bad('T4-Mix (Land, Luft, Game-Ender/Spezial)')
if {r_['id'] for r_ in D.get('reservedPostMvp', [])} != {xe['id'] for xe in XP}: bad('reservedPostMvp spiegelt experimentals nicht')
GEX = ('Death', 'Teleport', 'Anti Air', 'Anti Navy', 'Defense', None)
for xe in XP:
    i = xe['id']
    if not (i.startswith('f3:exp_') and xe['tier'] == 'T4' and xe['tech'] == 4 and xe['postMvp'] is True and not xe['ms9Core']): bad(i, 'T4-Schema')
    if xe['faReference']['devOnly'] is not True or not xe['needs']: bad(i, 'T4 devOnly/needs')
    for pm in xe['special']['postMvp']:
        if not (re.match(r'^([A-Z]\d+|K1-Erweiterung|B3-Erweiterung)$', pm['feature']) and pm['what'] and pm['fallback']): bad(i, 'T4 postMvp', pm['feature'])
    m = xe['economy']['mass']; sh_ = (xe['shield'] or {}).get('hp', 0)
    if xe['health']['max'] != xe['health']['hull'] + sh_: bad(i, 'health.max ≠ Rumpf + Schild (Fallback)')
    for w in xe['weapons']:
        if abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) > 0.01 or abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) > 1e-9: bad(w['ref'], 'T4-Waffe')
        if not w['ref'].startswith('f3:wpn_'): bad(w['ref'], 'T4-Waffen-ID')
        if w['projectile'].startswith('ballistisch') and w.get('firingRandomness') is None: bad(w['ref'], 'firingRandomness fehlt')
    r = FA4[xe['faReference']['bp']]
    fg = sum(w['dps'] for w in r['weapons'] if w['cat'] not in GEX and (w['dmg'] or 0) > 0 and w['rof'])
    fa_ = sum(w['dps'] for w in r['weapons'] if w['cat'] == 'Anti Air')
    og = sum(w['dps'] for w in xe['weapons'] if 'land' in w['layers']); oa = sum(w['dps'] for w in xe['weapons'] if 'air' in w['layers'])
    dh = (xe['health']['max'] / m / ((r['hp'] + (r['shield'] or 0)) / r['mass']) - 1) * 100
    axes = [('HP/Mass', dh)]
    if og or fg:
        dd = (og / m / (fg / r['mass']) - 1) * 100; axes += [('DPS/Mass', dd), ('Produkt', ((1 + dd / 100) * (1 + dh / 100) - 1) * 100)]
        if abs(dd - xe['balance']['devDpsPerMassPct']) > 0.1: bad(i, 'T4 balance-Feld DPS veraltet')
    if oa or fa_: axes.append(('Luft-DPS/Mass', (oa / m / (fa_ / r['mass']) - 1) * 100))
    if abs(dh - xe['balance']['devHpPerMassPct']) > 0.1: bad(i, 'T4 balance-Feld HP veraltet')
    for nm_, v in axes:
        if abs(v) > 15: bad(i, 'T4 Ziel ±15 %', nm_, round(v, 1))
    if 'ARTILLERY' in xe['categories']:
        w = xe['weapons'][0]; fw = max((w_ for w_ in r['weapons'] if w_['cat'] == 'Artillery'), key=lambda w_: w_['dps'])
        rel = fa_reload(fw['rof']); fsal = round(fw['dps'] * rel / fw['dmg'])
        pk = (w['damage'] * w['salvo'] * pulkT(w['splash']) / w['reloadS'] / m) / (fw['dmg'] * fsal * pulkT(fw['splash'] or 0) / rel / r['mass']) - 1
        if abs(pk) > 0.15: bad(i, 'T4 Pulk ±15 %', round(pk * 100, 1))
    # Sael-Identität: RW ≥ Vorbild, Schild-Anteil mobiler T4 ≥ 25 %, Strukturen zerbrechlicher (A6)
    if xe['group'] in ('land', 'air'):
        fw = max((w_ for w_ in r['weapons'] if w_['cat'] not in GEX and (w_['dmg'] or 0) > 0 and w_['rof']), key=lambda w_: w_['dps'])
        if xe['weapons'][0]['range'] < fw['range']: bad(i, 'Sael-Identität: Reichweite unter Vorbild')
        if sh_ / xe['health']['max'] < 0.25: bad(i, 'Sael-Identität: Schild-Anteil < 25 %')
    else:
        if xe['health']['max'] / m >= (r['hp'] + (r['shield'] or 0)) / r['mass']: bad(i, 'Sael-Identität: Struktur nicht zerbrechlicher (A6)')
    # Kitbash: T4-Budget, Monopol-Lints §5.3 Nr. 6, Gangart, Brücke, Icon
    k = xe['kitbash']; c = set(xe['categories']); pn = [p['part'] for p in k['parts']]; flow = bool(c & FLOW)
    T4TRIS = dict(shell=120, hoverpad=64, legs=30, orb=160, lance=24, horn=64, spine=20, sickle=96, ring=144, arch=72, mast=48, fan=32, lantern=128, wing=32)
    tr = sum(T4TRIS[p['part']] * p.get('count', 1) for p in k['parts'])
    if tr != k['trisEstimate'] or tr > 1500 or k['partCount'] > 10 or k['animatedParts'] > 3: bad(i, 'T4-Budget', tr, k['partCount'], k['animatedParts'])
    if not any(p.get('mat') == 'team' for p in k['parts']): bad(i, 'T4 Teamfarbe')
    if 'spine' in pn and not ('ANTIAIR' in c and 'AIR' not in c): bad(i, 'Stachel-Monopol')
    if 'horn' in pn and 'ARTILLERY' not in c: bad(i, 'Horn-Monopol')
    if 'lance' in pn and 'orb' not in pn: bad(i, 'Lanze ohne Perle')
    if sum(p.get('count', 1) for p in k['parts'] if p['part'] == 'orb') > 1: bad(i, 'mehr als 1 Perle')
    if 'orb' in pn and 'lance' not in pn and not flow: bad(i, 'Perle ohne Lanze außerhalb Flow')
    if any(p['part'] in ('lantern', 'sickle') or p.get('mat') == 'glow' for p in k['parts']) and not flow: bad(i, 'Licht-Monopol')
    gait = xe['motion'].get('gait')
    if ('hoverpad' in pn) != (gait == 'hover') or ('legs' in pn) != (gait == 'walker'): bad(i, 'Fahrwerk/Gangart')
    dm = xe['motion']['dimensionsWU']
    if gait == 'walker' and not ((k['legs'] or 0) >= 8 and dm['width'] > dm['length']): bad(i, 'T4-Läufer: Beine ≥ 8, breiter als lang')
    if xe['group'] == 'land' and 72 // max(dm['width'], dm.get('legSpan') or 0, min(xe['motion']['footprint'])) < 6: bad(i, 'Setons-Brücke')
    if xe['group'] == 'land' and xe['motion']['sizeClass'] != math.ceil(max(dm['width'], dm.get('legSpan') or 0, min(xe['motion']['footprint'])) / 2): bad(i, 'sizeClass ≠ ceil(Außenmaß / 2)')
    g_ = re.match(r'^(land|air|struct)_([a-z_]+)_t4$', xe['icon'])
    if not (g_ and g_.group(2) in D['iconGlyphs']): bad(i, 'T4-Icon (gemeinsame Grammatik)', xe['icon'])
    if (xe['group'] == 'air') != xe['icon'].startswith('air_') or (xe['group'] == 'structure') != xe['icon'].startswith('struct_'): bad(i, 'T4-Icon-Grundform')
if len({xe['hotbuild']['slot'] for xe in XP}) != len(XP): bad('T4-Hotbuild doppelt')
# T4-Namen: FA-Begriffe, Volltext-Grep, Abstand ≥ 2 zu allen Rufnamen (eigene und fremde units, reservedPostMvp, experimentals)
allnames = [(l, base(u['name'][l]), 'f3') for u in U for l in ('de', 'en')]
for path in others:
    try: O = json.load(open(path))
    except Exception: continue
    allnames += [(l, base(o['name'][l]), path.parent.name) for o in O['units'] for l in ('de', 'en')]
    allnames += [(l, r_[l], path.parent.name) for r_ in O.get('reservedPostMvp', []) for l in ('de', 'en')]
    allnames += [(l, o['name'][l], path.parent.name) for o in O.get('experimentals', []) for l in ('de', 'en')]
for xe in XP:
    for s_ in [xe['name']['de'], xe['name']['en'], xe['role']['de'], xe['role']['en']] + [w['type'] for w in xe['weapons']]:
        for t in BAN:
            if re.search(r'\b' + re.escape(t) + r'\b', s_, re.I): bad(xe['id'], 'FA-Begriff in T4-Anzeigefeld', t, s_)
    for l in ('de', 'en'):
        for w_ in re.findall(r"[A-Za-zÄÖÜäöüß]+", xe['name'][l]):
            if w_.lower() in FA_WORDS and w_.lower() not in GENERIC: bad(xe['id'], 'T4-Rufname-Wort in FA-Namen', w_)
        for ol, on, src in allnames + [(l2, y['name'][l2], 'f3') for y in XP if y is not xe for l2 in ('de', 'en')]:
            if ol == l and lev(xe['name'][l], on) <= 1: bad(xe['id'], 'T4-Rufname zu nah an', src, on)

mx = lambda i: max(((abs(r[i]), r[0]) for r in rows if r[i] is not None))
print(f"JSON valide, {len(U)} Einträge, {D['counts']['ms9Core']} ● (MS9), {D['counts']['visuals']} Visuals, Rollen = Varkan")
print('max |ΔDPS/Mass| %.1f %% (%s), max |ΔHP/Mass| %.1f %% (%s), max |ΔProdukt| %.1f %% (%s)' % (*mx(1), *mx(2), *mx(3)))
print(f"Treffer-bis-Tod intern: {sum(htk_ok)}/{len(htk_ok)} exakt; Kreuz gegen Varkan: "
      f"{sum(o for o, h in zip(x_ok, x) if h['required'])}/{sum(h['required'] for h in x)} Pflicht exakt, "
      f"{sum(o for o, h in zip(x_ok, x) if not h['required'])}/{sum(not h['required'] for h in x)} Info-Paare exakt")
print(f"FA-Begriffe geprüft: {len(BAN)} Begriffe gegen Namen/Rollen/Waffenbezeichnungen")
print(f"Namen: Volltext-Grep gegen {len(FAN['unitNames'])} FA-Einheiten- und {len(FAN['weaponNames'])} Waffennamen, Abstand ≥ 2 zu {n_other} anderen Rostern")
print(f"T1-Rush gegen Kommandanten: {sum(rush_ok)}/{len(rush_ok)} Paarungen wie FA")
print(f"Experimentals (T4, Post-MVP): {len(XP)} ({', '.join(xe['name']['de'] for xe in XP)}); Gates ±15 %, Pulk, Sael-Identität, Brücke, Budget, Lints, Icon, Namen geprüft")
print('Verstöße:', err or 'keine')
sys.exit(1 if err else 0)
