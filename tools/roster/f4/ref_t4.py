# Extrahiert die FA-Referenzwerte der Experimentals (T4) für den Aurith-Chor nach fa_ref_t4.json (dev-only, nur Zahlen-Relationen).
# Vorbild-Fraktion XS*: Sturmläufer XSL0401, Bomber XSA0402, Strategiewerfer XSB2401. Rollen, die das Vorbild nicht hat,
# stützen sich wie im MVP-Roster auf eine andere FA-Fraktion (faction.md §9.1): mobile Fabrik UEL0401, Ressourcengenerator XAB1401.
# Quelle: FAForever/spooky-db app/data/index.json (Version 3810), DPS-Formel wie ref.py (app/js/dps.js, WeaponNumber gezählt).
# Felder, die spooky-db nicht führt (Footprint, Raketenkosten, Paragon-Ertrag, Todes-Nachwirkung), stehen in EXTRA mit Quelle
# (FAForever/fa develop *_unit.bp bzw. *_proj.bp, abgerufen 2026-09-29).
# Aufruf: python3 ref_t4.py <pfad/zu/spooky_index.json>   (im Ordner tools/roster/f4/)
import json, math, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'spooky_index.json'))
assert str(d.get('version')) == '3810', d.get('version')
by = {a['Id'].upper(): a for a in d['units']}


def wdps(w):
    if not w.get('Damage') or w.get('WeaponCategory') in ('Death',): return 0.0
    rof = w.get('RateOfFire') or 1
    tr = max(0.1 * math.floor(10 / rof + 1e-9), 0.1)
    tr = max((w.get('RackSalvoChargeTime') or 0) + (w.get('RackSalvoReloadTime') or 0)
             + (w.get('MuzzleSalvoDelay') or 0) * ((w.get('MuzzleSalvoSize') or 1) - 1), tr)
    s = 1
    if (w.get('MuzzleSalvoDelay') or 0) > 0: s = w.get('MuzzleSalvoSize') or 1
    elif w.get('RackBones'):
        rb = w['RackBones']
        s = len(rb) * len(rb[0].get('MuzzleBones', [1])) if w.get('RackFireTogether') else len(rb[0].get('MuzzleBones', [1]))
    td = w['Damage'] * (w.get('DoTPulses') or 1) + (w.get('InitialDamage') or 0)
    td = max((math.floor((w.get('BeamLifetime') or 0) / ((w.get('BeamCollisionDelay') or 0) + 0.1)) + 1) * w['Damage'], td)
    return s * td / tr * (w.get('WeaponNumber') or 1)


REFS = {'XSL0401': 'Vorbild', 'XSA0402': 'Vorbild', 'XSB2401': 'Vorbild', 'UEL0401': 'Fremdreferenz (Vorbild ohne mobile Fabrik)',
        'XAB1401': 'Fremdreferenz (Vorbild ohne Ressourcengenerator)'}
EXTRA = {
    'XSL0401': dict(footprint=[3, 3], sizeY=7.5, regen=20, amphibious=True,
                    deathEffect='Todeswaffe 7000/6, danach Energiewesen XSL0402: 100 HP, 30 s, Laser 1000 × 3,33/s, RW 5–20, trifft Freund und Feind'),
    'XSA0402': dict(footprint=[13, 13], elevation=25, regen=25, crash=dict(damage=8000, radius=10)),
    'XSB2401': dict(footprint=[5, 5], missile=dict(mass=600, energy=6000, buildTime=129600, buildRate=2160, buildS=60, hp=60000,
                                                   inner=dict(damage=1000001, radius=45), outer=dict(damage=7500, radius=60),
                                                   maxStorage=1, initialStorage=0, range=20000),
                    death=dict(inner=dict(damage=20000, radius=15), outer=dict(damage=5000, radius=20))),
    'UEL0401': dict(footprint=None, buildRate=135, shieldDetail=dict(hp=20000, radius=25, regenPerSec=100, regenStartS=1, rechargeS=120, upkeepE=600),
                    amphibious=True, buildsFrom='T1–T3-Landeinheiten der eigenen Fabrikliste, auch in Bewegung'),
    'XAB1401': dict(footprint=[7, 7], storageMass=10000, storageEnergy=100000,
                    output='FAF: Ertrag folgt dem Verbrauch, höchstens 4000 M/s und 400000 E/s (FAForever/fa PR #7131, vorher 10000/1000000)',
                    maxMassPerSec=4000, maxEnergyPerSec=400000, death=dict(damage=35000, radius=25)),
}
out = {'_meta': dict(source='FAForever/spooky-db app/data/index.json v3810 + FAForever/fa develop (EXTRA)', devOnly=True,
                     note='Nur Relationen für die T4-Balance (experimentals.md); nie in view.json oder i18n übernehmen.')}
for i, kind in REFS.items():
    a = by[i]; e = a.get('Economy', {}); ph = a.get('Physics', {}); air = a.get('Air') or {}; df = a.get('Defense', {})
    ws = [dict(name=w.get('DisplayName'), count=w.get('WeaponNumber') or 1, cat=w.get('WeaponCategory'), dmg=w.get('Damage'),
               rof=w.get('RateOfFire'), range=w.get('MaxRadius'), minRange=w.get('MinRadius'), splash=w.get('DamageRadius'),
               mv=w.get('MuzzleVelocity'), dps=round(wdps(w), 2)) for w in a.get('Weapon', [])]
    gnd = sum(x['dps'] for x in ws if x['cat'] not in ('Death', 'Anti Air', 'Anti Navy', 'Defense', None))
    aa = sum(x['dps'] for x in ws if x['cat'] == 'Anti Air')
    sh = (df.get('Shield') or {}).get('ShieldMaxHealth')
    m = e.get('BuildCostMass')
    out[i] = dict(kind=kind, desc=a.get('Description'), mass=m, energy=e.get('BuildCostEnergy'), bt=e.get('BuildTime'), br=e.get('BuildRate'),
                  hp=df.get('Health'), shield=sh, speed=air.get('MaxAirspeed') or ph.get('MaxSpeed'), turn=ph.get('TurnRate'),
                  vision=(a.get('Intel') or {}).get('VisionRadius'), weapons=ws, dpsGround=round(gnd, 2), dpsAir=round(aa, 2),
                  dpsPerMass=round(gnd / m, 5) if gnd else None, hpPerMass=round((df.get('Health') + (sh or 0)) / m, 5),
                  cats=[c for c in a.get('Categories', []) if c], **EXTRA[i])
json.dump(out, open(HERE / 'fa_ref_t4.json', 'w'), indent=1, ensure_ascii=False)
for i, v in out.items():
    if i.startswith('_'): continue
    print(i, v['desc'], 'M', v['mass'], 'HP', v['hp'], '+Sh', v['shield'], 'DPS', v['dpsGround'], 'AA', v['dpsAir'],
          'dps/m', v['dpsPerMass'], 'hp/m', v['hpPerMass'], 'spd', v['speed'])
