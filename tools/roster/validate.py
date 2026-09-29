"""Prüft docs/design/roster.json unabhängig vom Generator (Werte neu rechnen statt Feldern zu vertrauen).
MVP (tech 0–3) wie bisher; Experimentals (tech 4, Post-MVP) mit denselben ±25-%-Grenzen gegen die FA-T4-Referenz
plus T3-Äquivalent-Relation, Budget- und Mechanik-Kennzeichnung."""
import json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
D = json.load(open(REPO / 'docs' / 'design' / 'roster.json'))  # wirft bei invalidem JSON
FA = json.load(open(HERE / 'fa_ref.json'))
FEATURES = {f['id'] for c in json.load(open(REPO / 'docs' / 'features.json'))['categories'] for f in c['features']}
U = D['units']; ids = {u['id'] for u in U}
MVP = [u for u in U if u['tech'] != 4]; T4 = [u for u in U if u['tech'] == 4]
err = []
assert D['counts']['total'] == len(U)
assert D['counts']['mvp'] == len(MVP) == 50
assert D['counts']['experimental']['total'] == len(T4)
assert D['counts']['ms9Core'] == sum(u['ms9Core'] for u in U)
for u in U:
    b = u['balance']
    for k in ('devDpsPerMassPct', 'devHpPerMassPct'):
        v = b[k]
        if v is not None and abs(v) > 25: err.append((u['id'], k, v))
    # Neu rechnen statt Feld vertrauen
    dps = b['dps']; m = u['economy']['mass']; hp = u['health']['max'] + ((u['shield'] or {}).get('hp', 0))
    fa = b['fa']
    if dps and fa['dpsPerMass']:
        d = (dps / m / (fa['dps'] / fa['mass']) - 1) * 100
        assert abs(d - b['devDpsPerMassPct']) < 0.2, u['id']
    h = (hp / m / ((fa['hp'] + (fa['shieldHp'] or 0)) / fa['mass']) - 1) * 100
    assert abs(h - b['devHpPerMassPct']) < 0.2, (u['id'], h)
    for w in u['weapons']:
        assert abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) < 0.01, w['ref']
        assert abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, w['ref']
    for k in ('upgradesTo', 'upgradeFrom'):
        if u['special'][k]: assert u['special'][k] in ids
    assert u['faReference']['devOnly'] is True
assert all(h['match'] for h in D['checks']['hitsToKill'])

# Experimentals
for u in T4:
    x = u['experimental']; k = u['kitbash']
    assert u['postMvp'] is True and u['tier'] == 'T4' and not u['ms9Core'] and u['msFirst'] in ('PM1', 'PM2', 'PM3'), u['id']
    assert 'EXPERIMENTAL' in u['categories'] and 'EXPERIMENTAL' in FA[u['faReference']['bp']]['cats'] or u['id'] == 'core:exp_str_shield', u['id']
    assert all(f in FEATURES for f in x['features']), (u['id'], [f for f in x['features'] if f not in FEATURES])
    assert all(m in D['experimentalMechanics'] for m in x['newMechanics']), u['id']
    assert k['animatedParts'] <= 8 and k['partCount'] <= 16 and k['trisEstimate'] <= k['trisBudget'][0] == 1600, u['id']
    assert k['ceramicBracket'] and k['techStripes'] == 0, u['id']
    assert u['icon'].endswith('_t4'), u['id']
    assert u['hotbuild']['menu'] == 'Großguss', u['id']
    m = u['motion']
    if not m.get('structure'):
        assert m['layer'] == 'air' or 1 <= m['sizeClass'] <= 7, u['id']  # Schema: sizeClass 0–7
        # Engstelle Setons-Brücke 76,4 WU (Soll ≥ 72): mindestens 8 T4 passen nebeneinander (Clearance ≥ sizeClass)
        assert m['layer'] == 'air' or max(m['footprint']) * 8 <= 72, u['id']
    b = u['balance']
    for key in ('devDpsPerMassPct', 'devHpPerMassPct', 'devProductPct'):
        if b[key] is not None and abs(b[key]) > 15: err.append((u['id'], key + ' (Ziel 15)', b[key]))
for r in D['checks']['experimentals']['t3Equivalent']:
    for key in ('devDpsRatioPct', 'devHpRatioPct'):
        if r[key] is not None and abs(r[key]) > 25: err.append((r['t4'], key, r[key]))
for r in D['checks']['experimentals']['buildTime']:
    for row in r['rows']:
        u = next(x for x in T4 if x['id'] == r['unit'])
        assert abs(row['seconds'] - u['economy']['buildTime'] / (row['engineers'] * r['builderBp'])) < 1, r['unit']

mx = lambda k, us: max(((abs(u['balance'][k]), u['id']) for u in us if u['balance'][k] is not None))
print(f'JSON valide, {len(U)} Einträge ({len(MVP)} MVP + {len(T4)} T4); Verstöße:', err or 'keine')
print('MVP  max |ΔDPS/Mass|', mx('devDpsPerMassPct', MVP), 'max |ΔHP/Mass|', mx('devHpPerMassPct', MVP), 'max |ΔProdukt|', mx('devProductPct', MVP))
print('T4   max |ΔDPS/Mass|', mx('devDpsPerMassPct', T4), 'max |ΔHP/Mass|', mx('devHpPerMassPct', T4), 'max |ΔProdukt|', mx('devProductPct', T4))
eq = D['checks']['experimentals']['t3Equivalent']
print('T4   T3-Äquivalent max |Δ|', max(abs(r[k]) for r in eq for k in ('devDpsRatioPct', 'devHpRatioPct') if r[k] is not None))
print('Treffer-Matrix', len(D['checks']['hitsToKill']), 'Paare exakt; ms9', D['counts']['ms9Core'], 'visuals', D['counts']['visuals'], '+', D['counts']['experimental']['visuals'], 'T4')
sys.exit(1 if err else 0)
