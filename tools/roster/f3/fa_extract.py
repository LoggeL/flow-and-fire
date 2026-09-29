# Erzeugt fa_ref.json für Fraktion f3 (Sael) aus FAForever/spooky-db app/data/index.json.
# Nur Zahlen als Relationen (dev-only); FA-Namen bleiben in dieser Datei und fa_ref.json,
# nie in roster.json-Anzeigefeldern, view.json oder i18n.
# DPS wie spooky-db app/js/dps.js "NotNukeDpsCalculator" (identisch zu tools/roster/gen.py).
# Aufruf: python3 fa_extract.py <pfad/zu/index.json>   (Download: raw.githubusercontent.com/FAForever/spooky-db/master/app/data/index.json)
import json, math, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index.json'

# Rolle (Unit-ID-Suffix, identisch zu Varkan) -> (Primärreferenz Vorbild-Fraktion, Gegenprobe/Ersatz)
ROLE_MAP = {
    'cmd_commander':    ('UAL0001', 'UEL0001'),
    'lnd_t1_engineer':  ('UAL0105', 'UEL0105'),
    'lnd_t2_engineer':  ('UAL0208', 'UEL0208'),
    'lnd_t3_engineer':  ('UAL0309', 'UEL0309'),
    'lnd_t1_scout':     ('UAL0101', 'UEL0101'),
    'lnd_t1_bot':       ('UAL0106', 'UEL0106'),
    'lnd_t1_tank':      ('UAL0201', 'UEL0201'),
    'lnd_t1_arty':      ('UAL0103', 'UEL0103'),
    'lnd_t1_aa':        ('UAL0104', 'UEL0104'),
    'lnd_t2_tank':      ('UAL0202', 'UEL0202'),
    'lnd_t2_mml':       ('UAL0111', 'UEL0111'),
    'lnd_t2_aa':        ('UAL0205', 'UEL0205'),
    'lnd_t2_shield':    ('UAL0307', 'UEL0307'),
    'lnd_t2_bot':       ('XAL0203', 'DEL0204'),   # Vorbild hat keinen T2-Bot: schneller T2-Sturmschweber als Relation
    'lnd_t3_bot':       ('UAL0303', 'UEL0303'),
    'lnd_t3_arty':      ('UAL0304', 'UEL0304'),
    'lnd_t3_sniper':    ('XAL0305', None),
    'lnd_t3_aa':        ('DALK003', 'DELK002'),
    'air_t1_scout':     ('UAA0101', 'UEA0101'),
    'air_t1_fighter':   ('UAA0102', 'UEA0102'),
    'air_t1_bomber':    ('UAA0103', 'UEA0103'),
    'air_t2_gunship':   ('UAA0203', 'UEA0203'),
    'air_t2_fbomber':   ('DEA0202', 'XAA0202'),   # Vorbild hat keinen Jagdbomber: FAF-T2-Jagdbomber, Gegenprobe T2-Luftkampf
    'str_t1_mex':       ('UAB1103', 'UEB1103'),
    'str_t2_mex':       ('UAB1202', 'UEB1202'),
    'str_t3_mex':       ('UAB1302', 'UEB1302'),
    'str_t1_pgen':      ('UAB1101', 'UEB1101'),
    'str_t2_pgen':      ('UAB1201', 'UEB1201'),
    'str_t3_pgen':      ('UAB1301', 'UEB1301'),
    'str_t1_hydro':     ('UAB1102', 'UEB1102'),
    'str_t1_mstore':    ('UAB1106', 'UEB1106'),
    'str_t1_estore':    ('UAB1105', 'UEB1105'),
    'str_t1_fac_land':  ('UAB0101', 'UEB0101'),
    'str_t2_fac_land':  ('UAB0201', 'UEB0201'),
    'str_t3_fac_land':  ('UAB0301', 'UEB0301'),
    'str_t1_fac_air':   ('UAB0102', 'UEB0102'),
    'str_t2_fac_air':   ('UAB0202', 'UEB0202'),
    'str_t1_pd':        ('UAB2101', 'UEB2101'),
    'str_t2_pd':        ('UAB2301', 'UEB2301'),
    'str_t1_aa':        ('UAB2104', 'UEB2104'),
    'str_t2_aa':        ('UAB2204', 'UEB2204'),
    'str_t3_sam':       ('UAB2304', 'UEB2304'),
    'str_t1_wall':      ('UAB5101', 'UEB5101'),
    'str_t1_radar':     ('UAB3101', 'UEB3101'),
    'str_t2_radar':     ('UAB3201', 'UEB3201'),
    'str_t3_radar':     ('UAB3104', 'UEB3104'),
    'str_t2_shield':    ('UAB4202', 'UEB4202'),
    'str_t3_shield':    ('UAB4301', 'UEB4301'),
    'str_t2_arty':      ('UAB2303', 'UEB2303'),
    'str_t3_arty':      ('UAB2302', 'UEB2302'),
}


def spooky_dps(w):
    rof = w.get('RateOfFire')
    if not rof or not w.get('Damage'):
        return 0.0
    rel = max(0.1 * math.floor(10 / rof + 1e-9), 0.1)
    rel = max((w.get('RackSalvoChargeTime') or 0) + (w.get('RackSalvoReloadTime') or 0)
              + (w.get('MuzzleSalvoDelay') or 0) * ((w.get('MuzzleSalvoSize') or 1) - 1), rel)
    salvo = 1
    if (w.get('MuzzleSalvoDelay') or 0) > 0:
        salvo = w.get('MuzzleSalvoSize') or 1
    elif w.get('RackBones'):
        rb = w['RackBones']
        salvo = len(rb) * len(rb[0]['MuzzleBones']) if w.get('RackFireTogether') else len(rb[0]['MuzzleBones'])
    dmg = w['Damage'] * (w.get('DoTPulses') or 1) + (w.get('InitialDamage') or 0)
    dmg = max((math.floor((w.get('BeamLifetime') or 0) / ((w.get('BeamCollisionDelay') or 0) + 0.1)) + 1) * w['Damage'], dmg)
    # spooky fasst gleiche Doppelwaffen (links/rechts) zu einem Eintrag mit WeaponNumber zusammen (fraktionsübergreifender Abgleich, X1)
    return salvo * dmg / rel * (w.get('WeaponNumber') or 1)


def entry(u):
    e, d, p = u.get('Economy', {}), u.get('Defense', {}), u.get('Physics', {})
    sh = (d.get('Shield') or {})
    ws = []
    for w in u.get('Weapon', []) or []:
        ws.append(dict(name=w.get('DisplayName'), cat=w.get('WeaponCategory'), dmg=w.get('Damage'),
                       rof=w.get('RateOfFire'), range=w.get('MaxRadius'), minRange=w.get('MinRadius'),
                       splash=w.get('DamageRadius'), mv=w.get('MuzzleVelocity'),
                       dps=round(spooky_dps(w), 2), count=w.get('WeaponNumber') or 1, proj=(w.get('ProjectileId') or '').split('/')[-1]))
    main = [w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
    dps = max([w['dps'] for w in main] or [0])
    if u['Id'].endswith('L0001'):
        dps = 100.0  # nur Hauptwaffe, ohne Overcharge/Enhancements (wie Varkan)
    hp = d.get('Health')
    shp = sh.get('ShieldMaxHealth')
    mass = e.get('BuildCostMass')
    return dict(desc=u.get('Description'), mass=mass, energy=e.get('BuildCostEnergy'), bt=e.get('BuildTime'),
                br=e.get('BuildRate'), hp=hp, shield=shp,
                shieldRegen=sh.get('ShieldRegenRate'), shieldRechargeS=sh.get('ShieldRechargeTime'), shieldSize=sh.get('ShieldSize'),
                speed=p.get('MaxSpeed'), turn=p.get('TurnRate'), elevation=p.get('Elevation'),
                abilities=(u.get('Display') or {}).get('Abilities', []),
                intel=u.get('Intel'), weapons=ws, dps=round(dps, 2),
                dpsPerMass=round(dps / mass, 4) if mass else None,
                hpPerMass=round((hp + (shp or 0)) / mass, 4) if mass else None,
                cats=sorted(c for c in (u.get('Categories') or []) if c))


def main():
    db = json.load(open(SRC))
    units = {u['Id']: u for u in db['units']}
    out = {'_meta': dict(source='FAForever/spooky-db app/data/index.json', version=db.get('version'),
                         devOnly=True, note='Nur Relationen. FA-Namen nie in Anzeige/i18n.',
                         roleMap={k: dict(bp=v[0], crossCheckBp=v[1]) for k, v in ROLE_MAP.items()})}
    for role, (bp, cc) in ROLE_MAP.items():
        for b in (bp, cc):
            if b and b in units and b not in out:
                out[b] = entry(units[b])
    json.dump(out, open('fa_ref.json', 'w'), indent=1, ensure_ascii=False)
    missing = [b for v in ROLE_MAP.values() for b in v if b and b not in units]
    print('fa_ref.json:', len(out) - 1, 'BPs, fehlend:', missing)


if __name__ == '__main__':
    main()
