import json, sys, math, os
p = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'docs', 'design', 'roster.json')
D = json.load(open(p))  # wirft bei invalidem JSON
U = D['units']; ids = {u['id'] for u in U}
err = []
assert D['counts']['total'] == len(U) == 50
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
mx = lambda k: max(((abs(u['balance'][k]), u['id']) for u in U if u['balance'][k] is not None))
print('JSON valide, 50 Einträge; Verstöße ±25 %:', err or 'keine')
print('max |ΔDPS/Mass|', mx('devDpsPerMassPct'), 'max |ΔHP/Mass|', mx('devHpPerMassPct'), 'max |ΔProdukt|', mx('devProductPct'))
print('Treffer-Matrix', len(D['checks']['hitsToKill']), 'Paare exakt; ms9', D['counts']['ms9Core'], 'visuals', D['counts']['visuals'])
sys.exit(1 if err else 0)
