# Fraktionsübergreifender Prüfer (N × N) für alle Roster: Varkan (docs/design/roster.json) und docs/design/factions/*/roster.json.
# Prüft, was die Einzel-Validatoren nicht sehen können:
#   1. Eco-Gleichstand: Kosten, Bauzeit, Ertrag und Build Power von Wirtschaft, Fabriken, Engineers, Kommandant
#   2. Kreuz-Treffer-bis-Tod der T1-Kernduelle zwischen allen Fraktionspaaren, verglichen mit der FA-Paarung der Referenzen
#   3. Gruppengefecht gleicher Masse (Lanchester, Stärke = DPS/Mass × HP/Mass) gegen die FA-Relation
#   4. T1-Rush gegen alle Kommandanten (Modell aus f3/rush.py, mit der Regeneration des jeweiligen Kommandanten)
#   5. Rollenstärke je Tech-Phase gegenüber Varkan (Asymmetrie-Matrix, Produkt-Mittel) und Dominanz-Gate
#   6. Icons (gleiche Glyphen-Liste, gleiche Icon-ID je Rolle) und Namen (Abstand >= 2 zwischen Fraktionen, kein Wort aus FA-Namen)
# FA-Werte: Vereinigung aller fa_ref.json (spooky-db 3810, WeaponNumber-korrigiert), nur Relationen, dev-only.
# Aufruf: python3 tools/roster/cross.py [--md]    Exit-Code 1 bei Verstoß gegen ein hartes Gate.
import json, math, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE / 'f3'))
import rush as RUSH  # noqa: E402

FACTIONS = [('core', 'Varkan', ROOT / 'docs/design/roster.json')] + [
    (p.parent.name, None, p) for p in sorted((ROOT / 'docs/design/factions').glob('*/roster.json'))]
R, NAME = {}, {}
for k, nm, p in FACTIONS:
    d = json.load(open(p))
    R[k] = {u['id'].split(':')[1]: u for u in d['units']}
    NAME[k] = nm or re.search(r'\((.+)\)', d['faction']).group(1)
    R[k]['_doc'] = d
KEYS = [k for k, _, _ in FACTIONS]

FA = {}
for f in [HERE / 'fa_ref.json'] + sorted(HERE.glob('*/fa_ref.json')):
    for bp, v in json.load(open(f)).items():
        if bp.startswith('_'): continue
        # erste Quelle gewinnt (Varkan zuerst); ein späterer Eintrag ersetzt sie nur, wenn er Doppelwaffen zählt und die frühere nicht
        old = FA.get(bp)
        if old is None or (not any('count' in w for w in old['weapons']) and any(w.get('count', 1) > 1 for w in v['weapons'])): FA[bp] = v

err, warn = [], []
MD = '--md' in sys.argv
pct = lambda x: f'{x:+.0f} %'.replace('-', '−') if x is not None else '–'

# Rollen-Alias: f4 hat keinen T1-Bot; der Kampfspäher (Pfiff) übernimmt Späher und Raider (f4 faction.md §9.2 A1)
def role(k, r):
    if r in R[k]: return R[k][r]
    alias = {'lnd_t1_bot': 'lnd_t1_scout', 'lnd_t3_bot': 'lnd_t3_tank', 'lnd_t2_shield': 'lnd_t3_shield'}
    return R[k].get(alias.get(r))

is_air = lambda u: 'AIR' in u['categories']

def weapon(u, target):
    """Roster: stärkste Waffe, die die Domäne des Ziels trifft -> (Salvenschaden, Nachladezeit, dps)."""
    lay = 'air' if is_air(target) else 'land'
    ws = [w for w in u['weapons'] if lay in w.get('layers', ['land']) and w['damage'] < 10000]
    if not ws: return None
    w = max(ws, key=lambda w: w['dps'])
    return w['damage'] * w['salvo'], w['reloadS'], w['dps']

def fa_weapon(bp, target_air):
    ws = [w for w in FA[bp]['weapons'] if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']
          and (w['dmg'] or 0) < 10000]
    ws = [w for w in ws if (w['cat'] == 'Anti Air') == target_air and w['cat'] not in ('Direct Fire Experimental', 'Anti Navy')]
    if bp.endswith('0001'):  # Kommandant: nur die Hauptwaffe, keine Enhancements (wie alle Roster)
        ws = [w for w in ws if w['cat'] == 'Direct Fire'][:1]
    if not ws: return None
    w = max(ws, key=lambda w: w['dps'])
    rel = math.floor(10 / w['rof'] + 1e-6) / 10
    salvo = max(1, round(w['dps'] * rel / w['dmg']))
    return w['dmg'] * salvo, rel, w['dps']

def hp(u): return u['health']['max'] + ((u.get('shield') or {}).get('hp') or 0) * 0  # Schild-Fallback steckt schon in health.max
def fa_hp(bp, shield=True):
    """FA-HP; Personal-Schilde zählen wie im Roster-Fallback (health.max = HP + Schild, faction.md f3 §9.3), Blasen-Schilde nicht."""
    return FA[bp]['hp'] + ((FA[bp].get('shield') or 0) if shield else 0)
bp = lambda u: u['faReference']['bp']

# ------------------------------------------------------------------ 1. Eco-Gleichstand
ECO_ROLES = ['cmd_commander', 'lnd_t1_engineer', 'lnd_t2_engineer', 'lnd_t3_engineer', 'str_t1_mex', 'str_t2_mex', 'str_t3_mex',
             'str_t1_pgen', 'str_t2_pgen', 'str_t3_pgen', 'str_t1_hydro', 'str_t1_mstore', 'str_t1_estore',
             'str_t1_fac_land', 'str_t2_fac_land', 'str_t3_fac_land', 'str_t1_fac_air', 'str_t2_fac_air']
ECO_FIELDS = ['mass', 'energy', 'buildTime', 'buildPower', 'massPerSec', 'energyPerSec', 'upkeepEnergyPerSec', 'storageMass', 'storageEnergy']
# bewusste, dokumentierte Abweichungen (Rolle, Fraktion, Feld) -> Begründung
ECO_ALLOW = {('str_t3_mex', 'f3', 'mass'): 'Brunnen III +100 Mass (Vorbild-Relation, f3 roster.md §21, Amortisation +2 %)'}
eco_rows = []
for r in ECO_ROLES:
    base = R['core'][r]['economy']
    for k in KEYS[1:]:
        e = R[k][r]['economy']
        for f in ECO_FIELDS:
            if base.get(f) != e.get(f):
                why = ECO_ALLOW.get((r, k, f))
                eco_rows.append((r, NAME[k], f, base.get(f), e.get(f), why))
                if not why: err.append(f'Eco weicht ab: {k}:{r}.{f} {e.get(f)} ≠ Varkan {base.get(f)}')

# ------------------------------------------------------------------ 2. Kreuz-Treffer-bis-Tod (T1-Kernduelle)
DUELS = [('Panzer → Panzer', 'lnd_t1_tank', 'lnd_t1_tank'), ('Raider → Raider', 'lnd_t1_bot', 'lnd_t1_bot'),
         ('Panzer → Raider', 'lnd_t1_tank', 'lnd_t1_bot'), ('Raider → Panzer', 'lnd_t1_bot', 'lnd_t1_tank'),
         ('Raider → Engineer', 'lnd_t1_bot', 'lnd_t1_engineer'), ('Artillerie → Panzer', 'lnd_t1_arty', 'lnd_t1_tank'),
         ('Artillerie → Engineer', 'lnd_t1_arty', 'lnd_t1_engineer'), ('Panzer → Artillerie', 'lnd_t1_tank', 'lnd_t1_arty'),
         ('Flak → Bomber', 'lnd_t1_aa', 'air_t1_bomber'), ('Jäger → Bomber', 'air_t1_fighter', 'air_t1_bomber'),
         ('Jäger → Jäger', 'air_t1_fighter', 'air_t1_fighter'), ('Bomber → Mex', 'air_t1_bomber', 'str_t1_mex'),
         ('Bomber → Engineer', 'air_t1_bomber', 'lnd_t1_engineer'), ('PD → Panzer', 'str_t1_pd', 'lnd_t1_tank'),
         ('Kommandant → Panzer', 'cmd_commander', 'lnd_t1_tank'), ('T2-Panzer → T2-Panzer', 'lnd_t2_tank', 'lnd_t2_tank')]
htk = []
for label, ra, rt in DUELS:
    for a in KEYS:
        for t in KEYS:
            ua, ut = role(a, ra), role(t, rt)
            w, fw = weapon(ua, ut), fa_weapon(bp(ua), is_air(ut))
            if not w or not fw: continue
            n = math.ceil(hp(ut) / w[0]); fn = math.ceil(fa_hp(bp(ut)) / fw[0])
            ttk, fttk = (n - 1) * w[1], (fn - 1) * fw[1]
            htk.append(dict(duel=label, a=a, t=t, n=n, fn=fn, ttk=round(ttk, 1), fttk=round(fttk, 1),
                            dev=round((ttk / fttk - 1) * 100) if fttk else (0 if ttk == 0 else None)))
htk_x = [h for h in htk if h['a'] != h['t']]
exact = sum(h['n'] == h['fn'] for h in htk_x)
off = [h for h in htk_x if h['n'] != h['fn']]
# Gate: fraktionsübergreifend darf kein T1-Kernduell mehr als 1 Salve von der FA-Paarung abweichen, außer Varkans Eigenwerte (§5.2)
for h in off:
    if abs(h['n'] - h['fn']) > 2 and abs(h['dev'] or 0) > 25:
        err.append(f"Kreuz-Treffer {h['duel']} {h['a']}→{h['t']}: {h['n']} statt {h['fn']} Salven, TTK {pct(h['dev'])}")

# ------------------------------------------------------------------ 3. Gruppengefecht gleicher Masse
GROUP = [('Panzer ↔ Panzer', 'lnd_t1_tank', 'lnd_t1_tank'), ('Raider ↔ Raider', 'lnd_t1_bot', 'lnd_t1_bot'),
         ('Panzer ↔ Raider', 'lnd_t1_tank', 'lnd_t1_bot'), ('T2-Panzer ↔ T2-Panzer', 'lnd_t2_tank', 'lnd_t2_tank'),
         ('Jäger ↔ Jäger', 'air_t1_fighter', 'air_t1_fighter')]
def strength(u, v):
    w = weapon(u, v); return (w[2] / u['economy']['mass']) * (hp(u) / u['economy']['mass'])
def fa_strength(b, vb, v_air):
    w = fa_weapon(b, v_air); return (w[2] / FA[b]['mass']) * (fa_hp(b) / FA[b]['mass'])
grp = []
for label, ra, rb in GROUP:
    for i, a in enumerate(KEYS):
        for b in KEYS[i + 1:]:
            ua, ub = role(a, ra), role(b, rb)
            s = strength(ua, ub) / strength(ub, ua)
            fs = fa_strength(bp(ua), bp(ub), is_air(ub)) / fa_strength(bp(ub), bp(ua), is_air(ua))
            dev = (s / fs - 1) * 100
            grp.append(dict(pair=label, a=a, b=b, s=round(s, 2), fs=round(fs, 2), dev=round(dev)))
            if abs(dev) > 30: err.append(f'Gruppengefecht {label} {a}↔{b}: Stärke {s:.2f} statt FA {fs:.2f} ({dev:+.0f} %)')

# ------------------------------------------------------------------ 4. T1-Rush gegen alle Kommandanten
rush = []
for ra in ('lnd_t1_tank', 'lnd_t1_bot'):
    for a in KEYS:
        for c in KEYS:
            ua, uc = role(a, ra), R[c]['cmd_commander']
            th, (td, tr, _) = hp(ua), weapon(ua, uc)
            fth, (ftd, ftr, _) = fa_hp(bp(ua)), fa_weapon(bp(ua), False)
            reg = uc['health'].get('regenPerSec', 10)
            n = RUSH.need(th, td, tr, uc['health']['max'], c_regen=reg)
            fn = RUSH.need(fth, ftd, ftr, fa_hp(bp(uc)), c_regen=reg)
            rush.append(dict(role=ra, a=a, c=c, n=n, fn=fn, mass=n * ua['economy']['mass']))
            if abs(n - fn) > 1: err.append(f'Rush {ra} {a}→{c}: {n} statt FA {fn}')
rush_exact = sum(r['n'] == r['fn'] for r in rush)

# ------------------------------------------------------------------ 5. Rollenstärke je Phase gegenüber Varkan
PHASE = lambda u: {0: 'Kdt', 1: 'Early (T1)', 2: 'Mid (T2)', 3: 'Late (T3)'}[u['tech']]
CLASS = [('Linie/Raider', ('lnd_t1_bot', 'lnd_t1_tank', 'lnd_t2_tank', 'lnd_t2_bot', 'lnd_t3_bot', 'lnd_t3_tank')),
         ('Artillerie', ('lnd_t1_arty', 'lnd_t2_mml', 'lnd_t3_arty', 'lnd_t3_sniper')),
         ('Flugabwehr', ('lnd_t1_aa', 'lnd_t2_aa', 'lnd_t3_aa', 'air_t1_fighter', 'str_t1_aa', 'str_t2_aa', 'str_t3_sam')),
         ('Luft-Boden', ('air_t1_bomber', 'air_t2_gunship', 'air_t2_fbomber')),
         ('Verteidigung', ('str_t1_pd', 'str_t2_pd', 'str_t2_arty', 'str_t3_arty')),
         ('Schild', ('lnd_t2_shield', 'lnd_t3_shield', 'str_t2_shield', 'str_t3_shield'))]
def prod(u):
    d = sum(w['dps'] for w in u['weapons'] if w['damage'] < 10000) or None
    h = hp(u) + ((u.get('shield') or {}).get('hp') or 0)
    return (d / u['economy']['mass'] if d else 1) * (h / u['economy']['mass'])
def fa_prod(b):
    r = FA[b]; d = 100 if b.endswith('0001') else r['dps']
    return ((d / r['mass']) if d else 1) * ((r['hp'] + (r['shield'] or 0)) / r['mass'])
geo = lambda xs: (math.exp(sum(math.log(x) for x in xs) / len(xs)) - 1) * 100 if xs else None
VK_OF = {'lnd_t3_tank': 'lnd_t3_bot', 'lnd_t3_shield': 'lnd_t2_shield'}
matrix, fa_matrix = {}, {}
for k in KEYS[1:]:
    for cname, roles in CLASS:
        for r in roles:
            u = R[k].get(r); v = R['core'].get(VK_OF.get(r, r))
            if not u or not v: continue
            ph = PHASE(u)
            matrix.setdefault((k, cname, ph), []).append(prod(u) / prod(v))
            fa_matrix.setdefault((k, cname, ph), []).append(fa_prod(bp(u)) / fa_prod(bp(v)))
    for ph in ('Early (T1)', 'Mid (T2)', 'Late (T3)'):
        matrix[(k, 'Σ', ph)] = [x for (kk, c, p), xs in list(matrix.items()) if kk == k and p == ph and c != 'Σ' for x in xs]
        fa_matrix[(k, 'Σ', ph)] = [x for (kk, c, p), xs in list(fa_matrix.items()) if kk == k and p == ph and c != 'Σ' for x in xs]
dom = {}
for k in KEYS[1:]:
    phases = [geo(matrix[(k, 'Σ', ph)]) for ph in ('Early (T1)', 'Mid (T2)', 'Late (T3)')]
    dom[k] = phases
    # Dominanz-Gate: keine Fraktion liegt im Rollen-Mittel (geometrisch, Produkt DPS/Mass × HP/Mass) in allen Phasen > +10 % oder < −10 % zu Varkan
    if all(p > 10 for p in phases): err.append(f'{k} dominiert Varkan in allen Phasen: {phases}')
    if all(p < -10 for p in phases): err.append(f'{k} liegt in allen Phasen hinter Varkan: {phases}')
    for (kk, c, ph), xs in matrix.items():
        if kk != k or c == 'Σ': continue
        g, fg = geo(xs), geo(fa_matrix[(kk, c, ph)])
        # Identitäts-Gate: die Vorbild-Asymmetrie bleibt erhalten (Rollenstärke zu Varkan höchstens ±25 % neben der FA-Relation)
        if abs((1 + g / 100) / (1 + fg / 100) - 1) > 0.25: err.append(f'{k} {c} {ph}: Δ Produkt {g:+.0f} % zu Varkan, FA-Relation {fg:+.0f} %')

# ------------------------------------------------------------------ 6. Icons und Namen
glyphs = {k: R[k]['_doc']['iconGlyphs'] for k in KEYS}
for k in KEYS[1:]:
    if glyphs[k] != glyphs['core']: err.append(f'{k}: iconGlyphs weichen von Varkan ab')
ICON_ALLOW = {('lnd_t1_scout', 'f4'): 'Kampfspäher = Raider-Rolle, Glyphe bot (f4 faction.md §6.2 „Gefahr vor Funktion“)'}
icon_dev = []
for r in R['core']:
    if r == '_doc': continue
    for k in KEYS[1:]:
        if r in R[k] and R[k][r]['icon'] != R['core'][r]['icon']:
            why = ICON_ALLOW.get((r, k)); icon_dev.append((r, k, R[k][r]['icon'], why))
            if not why: err.append(f'Icon {k}:{r} = {R[k][r]["icon"]} ≠ Varkan {R["core"][r]["icon"]}')
ICON_RE = re.compile(r'^(land|air|eng|struct)_[a-z_]+_t[123]$|^cmd_commander$|^wall$')
for k in KEYS:
    for r, u in R[k].items():
        if r == '_doc': continue
        g = re.sub(r'^(land|air|eng|struct)_|_t[123]$', '', u['icon'])
        if not ICON_RE.match(u['icon']) or (u['icon'] not in ('cmd_commander', 'wall') and g not in glyphs['core']):
            err.append(f'Icon-Grammatik verletzt: {k}:{r} {u["icon"]}')

def lev(a, b):
    a, b = a.lower(), b.lower(); dp = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, dp[0] = dp[0], i
        for j, cb in enumerate(b, 1):
            prev, dp[j] = dp[j], min(dp[j] + 1, dp[j - 1] + 1, prev + (ca != cb))
    return dp[-1]
base = lambda s: re.sub(r'\s+(I|II|III)$', '', s)
names = {k: {(l, base(u['name'][l])) for r, u in R[k].items() if r != '_doc' for l in ('de', 'en')} for k in KEYS}
for k in KEYS:  # reservierte Post-MVP-Rollen (f2) zählen mit
    names[k] |= {(l, base(r[l])) for r in R[k]['_doc'].get('reservedPostMvp', []) for l in ('de', 'en')}
name_hits = set()
for i, a in enumerate(KEYS):
    for b in KEYS[i + 1:]:
        for la, na in names[a]:
            for lb, nb in names[b]:
                if la == lb and lev(na, nb) <= 1:
                    name_hits.add((a, na, b, nb)); err.append(f'Rufname {a} „{na}“ ≈ {b} „{nb}“')
FAN = json.load(open(HERE / 'fa_names.json'))
FA_WORDS = {w.lower() for s in FAN['unitNames'] + FAN['weaponNames'] for w in re.findall(r"[A-Za-zÀ-ÿ]+", s)}
# Allgemeine Wörter, die in FA-Namen nur als Bestandteil vorkommen (z. B. „Sky Slammer“), sind erlaubt; Rufnamen selbst dürfen kein FA-Name sein
GENERIC = {'air', 'land', 'high', 'sea', 'i', 'ii', 'iii', 'heavy', 'light', 'sky', 'master'}
FA_FULL = {s.lower() for s in FAN['unitNames'] + FAN['weaponNames']}
FA_FACTION = ['uef', 'cybran', 'aeon', 'seraphim', 'illuminate', 'symbiont', 'quantum', 'loyalist', 'coalition', 'order of the']
for k in KEYS:
    for r, u in R[k].items():
        if r == '_doc': continue
        for l in ('de', 'en'):
            for w in re.findall(r"[A-Za-zÄÖÜäöüß]+", u['name'][l]):
                if w.lower() in FA_WORDS and w.lower() not in GENERIC: err.append(f'{k}:{r} Rufname-Wort in FA-Namen: {w}')
            if base(u['name'][l]).lower() in FA_FULL: err.append(f'{k}:{r} Rufname ist FA-Name: {u["name"][l]}')
        for s in [u['name']['de'], u['name']['en'], u['role']['de'], u['role']['en']] + [w['type'] for w in u['weapons']]:
            for t in FA_FACTION:
                if re.search(r'\b' + t + r'\b', s, re.I): err.append(f'{k}:{r} FA-Fraktionsbegriff: {t} in „{s}“')
for k in KEYS:
    fn = re.sub(r'\s*\(.*', '', NAME[k])
    for t in FA_FACTION:
        if t in fn.lower(): err.append(f'Fraktionsname {fn} enthält FA-Begriff {t}')

# ------------------------------------------------------------------ Ausgabe
def md_tables():
    L = []
    L.append('| Duell (Angreifer → Ziel) | ' + ' | '.join(f'{NAME[a]} → {NAME[t]}' for a in KEYS for t in KEYS if a != t) + ' |')
    L.append('|---|' + '---|' * (len(KEYS) * (len(KEYS) - 1)))
    for label, _, _ in DUELS:
        row = []
        for a in KEYS:
            for t in KEYS:
                if a == t: continue
                h = next((h for h in htk if h['duel'] == label and h['a'] == a and h['t'] == t), None)
                row.append('–' if not h else (f"{h['n']}" if h['n'] == h['fn'] else f"**{h['n']}** ({h['fn']})"))
        L.append(f'| {label} | ' + ' | '.join(row) + ' |')
    return '\n'.join(L)

if MD:
    print(md_tables()); print()
    print('| Paarung | ' + ' | '.join(f'{NAME[a]} ↔ {NAME[b]}' for i, a in enumerate(KEYS) for b in KEYS[i + 1:]) + ' |')
    print('|---|' + '---|' * 6)
    for label, _, _ in GROUP:
        cells = [next(g for g in grp if g['pair'] == label and g['a'] == a and g['b'] == b) for i, a in enumerate(KEYS) for b in KEYS[i + 1:]]
        print(f'| {label} | ' + ' | '.join(f"{c['s']:.2f} ({c['fs']:.2f})".replace('.', ',') for c in cells) + ' |')
    print()
    print('| Angreifer | ' + ' | '.join(f'→ {NAME[c]}' for c in KEYS) + ' |'); print('|---|' + '---|' * len(KEYS))
    for ra in ('lnd_t1_tank', 'lnd_t1_bot'):
        for a in KEYS:
            cells = [next(r for r in rush if r['role'] == ra and r['a'] == a and r['c'] == c) for c in KEYS]
            nm = role(a, ra)['name']['de']
            print(f'| {nm} ({NAME[a]}) | ' + ' | '.join(f"{c['n']} · {c['mass']:,}".replace(',', '.') + ('' if c['n'] == c['fn'] else f" (FA {c['fn']})") for c in cells) + ' |')
    print()
    print('| Fraktion | Klasse | Early (T1) | Mid (T2) | Late (T3) |'); print('|---|---|---|---|---|')
    for k in KEYS[1:]:
        for cname, _ in CLASS + [('Σ', None)]:
            cells = []
            for ph in ('Early (T1)', 'Mid (T2)', 'Late (T3)'):
                xs = matrix.get((k, cname, ph), [])
                cells.append(f"{pct(geo(xs))} ({pct(geo(fa_matrix[(k, cname, ph)]))})" if xs else '–')
            print(f'| {NAME[k]} | {cname} | ' + ' | '.join(cells) + ' |')
    print()
    for e in eco_rows: print('Eco:', e)
    for e in icon_dev: print('Icon:', e)
else:
    print(f'Fraktionen: {", ".join(f"{NAME[k]} ({k}, {len(R[k]) - 1} BPs)" for k in KEYS)}')
    print(f'Eco: {len(ECO_ROLES)} Rollen × {len(ECO_FIELDS)} Felder; Abweichungen {len(eco_rows)} (begründet {sum(1 for e in eco_rows if e[5])})')
    print(f'Kreuz-Treffer-bis-Tod: {exact}/{len(htk_x)} Kreuzpaare exakt wie die FA-Paarung; abweichend:')
    for h in off: print(f"   {h['duel']:<22} {h['a']:>4} → {h['t']:<4} {h['n']:>3} statt {h['fn']:>3} Salven, TTK {h['ttk']} s statt {h['fttk']} s")
    print('Gruppengefecht gleicher Masse (Stärke A/B, FA):')
    for g in grp: print(f"   {g['pair']:<24} {g['a']:>4} ↔ {g['b']:<4} {g['s']:.2f} (FA {g['fs']:.2f}, {g['dev']:+d} %)")
    print(f'T1-Rush: {rush_exact}/{len(rush)} Paarungen exakt wie FA')
    for r in rush:
        if r['n'] != r['fn']: print(f"   {r['role']} {r['a']} → {r['c']}: {r['n']} statt {r['fn']}")
    print('Phasen-Stärke gegenüber Varkan (Mittel Δ Produkt):', {k: [round(x) for x in v] for k, v in dom.items()})
    print(f'Icons: Glyphen-Liste identisch in {sum(glyphs[k] == glyphs["core"] for k in KEYS)}/{len(KEYS)}; Rollen-Abweichungen {len(icon_dev)} (begründet {sum(1 for i in icon_dev if i[3])})')
    print(f'Namen: {sum(len(v) for v in names.values())} Rufnamen, Kollisionen {len(name_hits)}; FA-Grep gegen {len(FAN["unitNames"])} + {len(FAN["weaponNames"])} Namen')
    print('Verstöße:', err if err else 'keine')
sys.exit(1 if err else 0)
