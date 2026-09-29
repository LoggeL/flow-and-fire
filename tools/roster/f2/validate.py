# Unabhängiger Validator für docs/design/factions/f2/roster.json (Skarn).
# Rechnet alle Gates aus den Rohwerten neu, statt den balance-Feldern zu vertrauen:
#   - Schema/Zählung (50 Einträge, gleiche Rollen-IDs, Icons und Hotbuild-Tasten wie Varkan, 26 im MS9-Kern)
#   - DPS/Mass und HP/Mass hart ±25 %, Einzelachsen + Produkt + Pulk ±15 % gegen die Vorbild-FA-Referenz (fa_ref.json)
#   - Treffer-bis-Tod-Pflichtpaare exakt wie FA (FA-Salve aus spooky-DPS × Nachladezeit)
#   - Kreuz-Pflichtpaare gegen Varkan (docs/design/roster.json + tools/roster/fa_ref.json)
#   - Post-MVP-Markierungen mit Feature-ID, dev-only-Referenzen, Namens-Lint gegen FA-Begriffe
# Aufruf: python3 validate.py [pfad/zu/spooky index.json]   (mit index.json zusätzlich Grep gegen alle FA-Einheitennamen)
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
D = json.load(open(os.path.join(ROOT, 'docs', 'design', 'factions', 'f2', 'roster.json')))
CORE = json.load(open(os.path.join(ROOT, 'docs', 'design', 'roster.json')))
FA = json.load(open(os.path.join(HERE, 'fa_ref.json')))
FA_CORE = json.load(open(os.path.join(HERE, '..', 'fa_ref.json')))
U = D['units']; E = {u['id']: u for u in U}; CE = {u['id']: u for u in CORE['units']}
err = []; warn = []


def chk(cond, *msg):
    if not cond: err.append(msg)


# ---------------------------------------------------------------- Schema / Zählung
chk(D['schema'] == 'faf-roster/1', 'schema')
chk(len(U) == D['counts']['total'] == 50, 'Anzahl', len(U))
chk(D['counts']['ms9Core'] == sum(u['ms9Core'] for u in U) == 26, 'ms9')
roles = {i.split(':')[1] for i in E}; core_roles = {i.split(':')[1] for i in CE}
chk(roles == core_roles, 'Rollen-IDs ≠ Varkan', roles ^ core_roles)
chk(all(i.startswith('f2:') for i in E), 'Namespace')
for u in U:
    c = CE['core:' + u['id'].split(':')[1]]
    chk(u['icon'] == c['icon'], 'Icon ≠ Varkan', u['id'])
    chk((u['hotbuild'] or {}).get('slot') == (c['hotbuild'] or {}).get('slot'), 'Hotbuild ≠ Varkan', u['id'])
    chk(u['ms9Core'] == c['ms9Core'] and u['msFirst'] == c['msFirst'], 'Meilenstein ≠ Varkan', u['id'])
    chk(u['faReference']['devOnly'] is True, 'devOnly', u['id'])
    for k in ('upgradesTo', 'upgradeFrom'):
        if u['special'][k]: chk(u['special'][k] in E, k, u['id'])
    for pm in u['special'].get('postMvp', []):
        chk(re.match(r'^([A-Z]\d+|K1-Erweiterung)', pm['feature']) and pm['effect'], 'postMvp ohne Feature-ID', u['id'], pm)
chk(D['iconGlyphs'] == CORE['iconGlyphs'], 'Icon-Glyphen ≠ Varkan')

# ---------------------------------------------------------------- Balance neu rechnen
def fa_dps(bp):
    return 100.0 if bp.endswith('L0001') else FA[bp]['dps']


def fa_reload(rof):
    return math.floor(10 / rof + 1e-6) / 10


def fa_weapon(db, bp, idx=None):
    ws = db[bp]['weapons']
    if idx is None:
        ok = [w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
        w = max(ok, key=lambda w: w['dps'])
    else:
        w = ws[idx]
    rel = fa_reload(w['rof'])
    return dict(damage=w['dmg'], salvo=max(1, round(w['dps'] * rel / w['dmg'])), reloadS=rel, splash=w['splash'] or 0)


dev = []
for u in U:
    b = u['balance']; bp = u['faReference']['bp']; r = FA[bp]
    m = u['economy']['mass']; hp = u['health']['max'] + ((u['shield'] or {}).get('hp', 0))
    for w in u['weapons']:
        chk(abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) < 0.01, 'Waffen-DPS', w['ref'])
        chk(abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, '10-Hz-Tick', w['ref'])
    idx = [0] if u['id'] == 'f2:cmd_commander' else range(len(u['weapons']))
    dps = sum(u['weapons'][i]['dps'] for i in idx)
    fdps = fa_dps(bp)
    chk(bool(dps) == bool(fdps), 'bewaffnet ≠ FA', u['id'])
    rh = (hp / m) / ((r['hp'] + (r['shield'] or 0)) / r['mass'])
    rd = (dps / m) / (fdps / r['mass']) if dps else None
    dh = (rh - 1) * 100; dd = (rd - 1) * 100 if rd else None; dp = (rd * rh - 1) * 100 if rd else None
    chk(abs(dh - b['devHpPerMassPct']) < 0.2, 'devHp-Feld', u['id'])
    if dd is not None: chk(abs(dd - b['devDpsPerMassPct']) < 0.2, 'devDps-Feld', u['id'])
    for name, v in (('DPS/Mass', dd), ('HP/Mass', dh)):
        if v is not None:
            chk(abs(v) <= 25, 'HART ±25 %', u['id'], name, round(v, 1))
            chk(abs(v) <= 15, 'Ziel ±15 %', u['id'], name, round(v, 1))
    if dp is not None: chk(abs(dp) <= 15, 'Produkt ±15 %', u['id'], round(dp, 1))
    if 'ARTILLERY' in u['categories'] and u['weapons'][0].get('splash'):
        w = u['weapons'][0]; fw = fa_weapon(FA, bp)
        t = lambda s: math.pi * (s + 0.5) ** 2 / 4
        pk = (w['damage'] * w['salvo'] * t(w['splash']) / w['reloadS'] / m) / (fw['damage'] * fw['salvo'] * t(fw['splash']) / fw['reloadS'] / r['mass']) - 1
        chk(abs(pk * 100) <= 15, 'Pulk ±15 %', u['id'], round(pk * 100, 1))
    dev.append((u['id'], dd, dh, dp))

# ---------------------------------------------------------------- Treffer bis Tod (Pflicht, neu gerechnet)
FAWPN = {'f2:cmd_commander': 1}
for h in D['checks']['hitsToKill']:
    a, t = E[h['attacker']], E[h['target']]
    w = a['weapons'][0]; fw = fa_weapon(FA, a['faReference']['bp'], FAWPN.get(a['id']))
    ours = math.ceil(t['health']['max'] / (w['damage'] * w['salvo']))
    theirs = math.ceil(FA[t['faReference']['bp']]['hp'] / (fw['damage'] * fw['salvo']))
    chk(ours == theirs == h['hits'] == h['fa']['hits'], 'Treffer-bis-Tod', a['id'], t['id'], ours, theirs)
chk(len(D['checks']['hitsToKill']) >= 20, 'zu wenige Pflichtpaare')

# ---------------------------------------------------------------- Kreuz-Check gegen Varkan (neu gerechnet)
def side(uid):
    if uid.startswith('f2:'):
        return E[uid], FA, E[uid]['faReference']['bp'], (1 if uid == 'f2:cmd_commander' else None)
    return CE[uid], FA_CORE, CE[uid]['faReference']['bp'], (0 if uid == 'core:cmd_commander' else None)


mand = [x for x in D['checks']['crossFaction'] if x['mandatory']]
chk(len(mand) == 4, 'Kreuz-Pflichtpaare', len(mand))
for x in D['checks']['crossFaction']:
    ae, adb, abp, afw = side(x['attacker']); te, tdb, tbp, _ = side(x['target'])
    w = ae['weapons'][0]; fw = fa_weapon(adb, abp, afw)
    ours = math.ceil(te['health']['max'] / (w['damage'] * w['salvo']))
    theirs = math.ceil(tdb[tbp]['hp'] / (fw['damage'] * fw['salvo']))
    chk(ours == x['hits'] and theirs == x['fa']['hits'], 'Kreuz-Feld', x['attacker'], x['target'])
    if x['mandatory']:
        if ours != theirs:
            ttk = (ours - 1) * w['reloadS']; fttk = (theirs - 1) * fw['reloadS']
            chk(x['exception'] and fttk and abs(ttk / fttk - 1) <= 0.10, 'Kreuz-Pflichtpaar', x['attacker'], x['target'], ours, theirs)
            warn.append(f"Kreuz-Ausnahme {x['attacker']} → {x['target']}: {ours} statt {theirs} Salven, Tötungszeit {ttk:.1f} s statt {fttk:.1f} s")
    elif x['breakpoint'] and ours != theirs:
        chk(x['cause'] in ('Varkan', 'beide'), 'Skarn bricht Kreuz-Breakpoint', x['attacker'], x['target'])

# ---------------------------------------------------------------- Kitbash / Lesbarkeit
for u in U:
    k = u['kitbash']; cats = set(u['categories'])
    chk(k['animatedParts'] <= 2 and k['partCount'] <= (7 if u['group'] in ('cmd', 'land', 'air') else 9) and k['trisEstimate'] <= 350, 'Kitbash-Budget', u['id'])
    chk(any(p.get('mat') == 'team' for p in k['parts']), 'Teamfarbe', u['id'])
    for p in k['parts']:
        if p['part'] in ('spool', 'druse') or p.get('mat') == 'glow':
            chk(cats & {'ECONOMIC', 'FACTORY', 'ENGINEER'}, 'Glut-Monopol', u['id'])
        if p['part'] == 'spike': chk(cats & {'ANTIAIR', 'WALL'}, 'Dorn-Monopol', u['id'])
        if p['part'] == 'tail': chk('ARTILLERY' in cats, 'Schwanz-Monopol', u['id'])
        if p['part'] == 'lens': chk('DIRECTFIRE' in cats, 'Linsen-Monopol', u['id'])
        if p['part'] == 'abdomen': chk('BOMBER' in cats and 'ANTIAIR' not in cats, 'Hinterleib-Monopol (nur Bomber)', u['id'])
chk(D['counts']['visuals'] <= 28, 'Visuals > 28')
for vid, v in D['visuals'].items():
    mobile = E[v['members'][0]]['group'] in ('cmd', 'land', 'air')
    chk(v['supersetParts'] <= (8 if mobile else 9) and v['trisEstimate'] <= 350, 'Superset', vid)

# ---------------------------------------------------------------- Experimentals (T4, Post-MVP; unabhängig neu gerechnet)
XP = D.get('experimentals', [])
FA4 = json.load(open(os.path.join(HERE, 'fa_ref_t4.json')))
chk(4 <= len(XP) <= 5 and D['counts'].get('experimentals') == len(XP), 'T4-Anzahl', len(XP))
grp = [x['group'] for x in XP]
chk(grp.count('land') >= 1 and grp.count('air') >= 1 and any('STRATEGIC' in x['categories'] or x['group'] == 'structure' for x in XP),
    'T4-Mix (Land, Luft, Game-Ender/Spezial)')
for x in XP:
    chk(x['id'].startswith('f2:exp_') and x['tier'] == 'T4' and x['postMvp'] is True and not x['ms9Core'], 'T4-Schema', x['id'])
    chk(x['faReference']['devOnly'] is True and x['needs'], 'T4 devOnly/needs', x['id'])
    for pm in x['special']['postMvp']:
        chk(re.match(r'^([A-Z]\d+|K1-Erweiterung|G6-Aura)', pm['feature']) and pm['effect'], 'T4 postMvp ohne Feature-ID', x['id'], pm)
    m = x['economy']['mass']; hp = x['health']['max']
    for w in x['weapons']:
        chk(abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) < 0.01 and abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, 'T4-Waffe', w['ref'])
    bp = x['faReference']['bp']
    if bp:
        r = FA4[bp]; dps = sum(w['dps'] for w in x['weapons'])
        dd = ((dps / m) / (r['dps'] / r['mass']) - 1) * 100; dh = ((hp / m) / (r['hp'] / r['mass']) - 1) * 100
        dp = ((1 + dd / 100) * (1 + dh / 100) - 1) * 100
        for name, v in (('DPS/Mass', dd), ('HP/Mass', dh), ('Produkt', dp)):
            chk(abs(v) <= 15, 'T4 Ziel ±15 %', x['id'], name, round(v, 1))
        chk(abs(dd - x['balance']['devDpsPerMassPct']) < 0.2 and abs(dh - x['balance']['devHpPerMassPct']) < 0.2, 'T4 balance-Feld', x['id'])
        chk(m <= r['mass'] and x['motion']['speed'] >= r['speed'] and hp / m <= r['hp'] / r['mass'] + 1e-9, 'T4 Identität', x['id'])
    else:
        chk(0 < x['economy'].get('massPerSec', 0) and 1.5 <= x['balance']['payback']['ratio'] <= 3.0, 'T4 Eco-Amortisation', x['id'])
    k = x['kitbash']; cats = set(x['categories'])
    chk(k['trisEstimate'] <= 1200 and k['partCount'] <= 12 and k['animatedParts'] <= 3, 'T4-Budget', x['id'])
    chk(any(p.get('mat') == 'team' for p in k['parts']), 'T4 Teamfarbe', x['id'])
    for p in k['parts']:
        if p['part'] in ('spool', 'druse') or p.get('mat') == 'glow': chk(cats & {'ECONOMIC', 'FACTORY', 'ENGINEER'}, 'T4 Glut-Monopol', x['id'])
        if p['part'] == 'spike': chk('ANTIAIR' in cats, 'T4 Dorn-Monopol', x['id'])
        if p['part'] == 'tail': chk('ARTILLERY' in cats, 'T4 Schwanz-Monopol', x['id'])
        if p['part'] == 'lens': chk('DIRECTFIRE' in cats, 'T4 Linsen-Monopol', x['id'])
    if x['group'] == 'land':
        chk((k['legs'] or 0) >= 8, 'T4 Beine ≥ 8', x['id'])
        dm = x['motion']['dimensionsWU']
        chk(72 // max(dm['width'], dm.get('legSpan') or 0, min(x['motion']['footprint'])) >= 6, 'Setons-Brücke', x['id'])
    g = re.match(r'^(land|air|struct)_([a-z_]+)_t4$', x['icon'])
    chk(g and g.group(2) in D['iconGlyphs'], 'T4-Icon (gemeinsame Grammatik)', x['id'], x['icon'])

# ---------------------------------------------------------------- Namens-Lint (Anzeigefelder, keine FA-Begriffe)
BANNED = ['cybran', 'aeon', 'seraphim', 'uef', 'illuminate', 'symbiont', 'quantum', 'nanite', 'loyalist', 'monkeylord',
          'overcharge', 'commander', 'acu']
display = []
for u in U:
    display += [u['name']['de'], u['name']['en']]
for r in D.get('reservedPostMvp', []):
    display += [r['de'], r['en']]
for x in XP:
    display += [x['name']['de'], x['name']['en']]
# T4-Rufnamen gegen alle anderen Roster (Abstand ≥ 2 wie cross.py, inkl. deren units/reservedPostMvp/experimentals)
import glob
def _lev(a, b):
    a, b = a.lower(), b.lower(); dp = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, dp[0] = dp[0], i
        for j, cb in enumerate(b, 1):
            prev, dp[j] = dp[j], min(dp[j] + 1, dp[j - 1] + 1, prev + (ca != cb))
    return dp[-1]
_other = []
for pth in [os.path.join(ROOT, 'docs', 'design', 'roster.json')] + sorted(glob.glob(os.path.join(ROOT, 'docs', 'design', 'factions', '*', 'roster.json'))):
    od = json.load(open(pth)); own = pth.endswith(os.path.join('f2', 'roster.json'))
    for u in od['units']: _other += [(own, l, re.sub(r'\s+(I|II|III)$', '', u['name'][l])) for l in ('de', 'en')]
    for r in od.get('reservedPostMvp', []): _other += [(own, 'de', r['de']), (own, 'en', r['en'])]
    if not own:
        for u in od.get('experimentals', []): _other += [(own, l, u['name'][l]) for l in ('de', 'en')]
for x in XP:
    for l in ('de', 'en'):
        for own, lo, n in _other:
            if lo == l: chk(_lev(x['name'][l], n) >= 2, 'T4-Rufname kollidiert', x['name'][l], n)
_fan = json.load(open(os.path.join(HERE, '..', 'fa_names.json')))
_faw = {w.lower() for s_ in _fan['unitNames'] + _fan['weaponNames'] for w in re.findall(r"[A-Za-zÀ-ÿ]+", s_)}
for x in XP:
    for l in ('de', 'en'):
        for w_ in re.findall(r"[A-Za-zÄÖÜäöüß]+", x['name'][l]): chk(w_.lower() not in _faw, 'T4-Rufname-Wort in FA-Namen', w_)
# Lore-Namen aus faction.md §1/§2.5 (Fraktion, Rotten, Waffen- und Spielbegriffe); stehen nicht in roster.json
LORE = ['Skarn', 'Skarn-Geflecht', 'Skarn Tangle', 'Rädelsführer', 'Ringleader', 'Geflechtriss', 'Tangle Snap', 'Überschlag', 'Flashover',
        'Durchbruch', 'Breach', 'Tiefschacht', 'Deep Shaft', 'Sekundant', 'Second', 'Rotte', 'Pack',
        'Rotte Kluft', 'Rotte Aschzahn', 'Rotte Druse', 'Rotte Sieben', 'Rotte Splitt', 'Rotte Nachtgang',
        'Pack Rift', 'Pack Ashtooth', 'Pack Geode', 'Pack Seven', 'Pack Splinter', 'Pack Nightpass']
display += LORE
fa_names = set()
if len(sys.argv) > 1:
    idx = json.load(open(sys.argv[1]))
    for x in idx['units']:
        n = ((x.get('General') or {}).get('UnitName') or '').strip()
        if n: fa_names.add(n.lower())
GENERIC = {'land', 'air', 'nest', 'i', 'ii', 'iii', 'cell'}
fa_words = {w for f in fa_names for w in re.findall(r'[a-zäöüß]+', f)}
for n in display:
    low = n.lower()
    for b in BANNED:
        chk(not re.search(r'\b' + b + r'\b', low), 'FA-Begriff im Namen', n, b)
    chk(low not in fa_names, 'FA-Einheitenname', n)
    for w in re.findall(r'[a-zäöüß]+', low):
        chk(w in GENERIC or w not in fa_words, 'Wort aus FA-Einheitenname', n, w)

# ---------------------------------------------------------------- Ausgabe
arm = [d for d in dev if d[1] is not None]
mx = lambda i, L: max(L, key=lambda d: abs(d[i]))
print(f"JSON valide: {len(U)} Einträge ({D['counts']['mobile']} mobil, {D['counts']['structures']} Gebäude), "
      f"MS9-Kern {D['counts']['ms9Core']}, Visuals {D['counts']['visuals']}, Glyphen {len(D['iconGlyphs'])}")
print(f"max |ΔDPS/Mass| {mx(1, arm)[1]:+.1f} % ({mx(1, arm)[0]}), Mittel {sum(d[1] for d in arm) / len(arm):+.1f} %")
print(f"max |ΔHP/Mass|  {mx(2, dev)[2]:+.1f} % ({mx(2, dev)[0]}), Mittel {sum(d[2] for d in dev) / len(dev):+.1f} %")
print(f"max |ΔProdukt|  {mx(3, arm)[3]:+.1f} % ({mx(3, arm)[0]}), Mittel {sum(d[3] for d in arm) / len(arm):+.1f} %")
print(f"Treffer-bis-Tod: {len(D['checks']['hitsToKill'])} Pflichtpaare exakt; Kreuz-Check Varkan: 4 Pflichtpaare, "
      f"{sum(1 for x in D['checks']['crossFaction'] if not x['mandatory'])} Info-Paare, "
      f"davon {sum(1 for x in D['checks']['crossFaction'] if not x['mandatory'] and not x['ok'])} abweichend (Ursache Varkan {sum(1 for x in D['checks']['crossFaction'] if not x['mandatory'] and not x['ok'] and x['cause'] == 'Varkan')}, Skarn {sum(1 for x in D['checks']['crossFaction'] if not x['mandatory'] and not x['ok'] and x['cause'] != 'Varkan')})")
print(f"Experimentals (T4, Post-MVP): {len(XP)} ({', '.join(x['name']['de'] for x in XP)}), Gates ±15 %, Identität, Brücke, Budget, Icon geprüft")
if fa_names: print(f"Namens-Grep gegen {len(fa_names)} FA-Einheitennamen durchgeführt")
for w_ in warn: print('Hinweis:', w_)
if err:
    print('FEHLER:')
    for e in err: print('  ', *e)
    sys.exit(1)
print('Alle Gates bestanden.')
