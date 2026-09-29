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

mx = lambda i: max(((abs(r[i]), r[0]) for r in rows if r[i] is not None))
print(f"JSON valide, {len(U)} Einträge, {D['counts']['ms9Core']} ● (MS9), {D['counts']['visuals']} Visuals, Rollen = Varkan")
print('max |ΔDPS/Mass| %.1f %% (%s), max |ΔHP/Mass| %.1f %% (%s), max |ΔProdukt| %.1f %% (%s)' % (*mx(1), *mx(2), *mx(3)))
print(f"Treffer-bis-Tod intern: {sum(htk_ok)}/{len(htk_ok)} exakt; Kreuz gegen Varkan: "
      f"{sum(o for o, h in zip(x_ok, x) if h['required'])}/{sum(h['required'] for h in x)} Pflicht exakt, "
      f"{sum(o for o, h in zip(x_ok, x) if not h['required'])}/{sum(not h['required'] for h in x)} Info-Paare exakt")
print(f"FA-Begriffe geprüft: {len(BAN)} Begriffe gegen Namen/Rollen/Waffenbezeichnungen")
print(f"Namen: Volltext-Grep gegen {len(FAN['unitNames'])} FA-Einheiten- und {len(FAN['weaponNames'])} Waffennamen, Abstand ≥ 2 zu {n_other} anderen Rostern")
print(f"T1-Rush gegen Kommandanten: {sum(rush_ok)}/{len(rush_ok)} Paarungen wie FA")
print('Verstöße:', err or 'keine')
sys.exit(1 if err else 0)
