# Erzeugt fa_ref.json für Fraktion f2 (Skarn) aus FAForever/spooky-db app/data/index.json.
# Nur Zahlen als Relationen (dev-only). FA-Namen bleiben in dieser Datei und in fa_ref.json,
# nie in roster.json-Anzeigefeldern, view.json oder i18n (faction.md §2.5).
# DPS wie spooky-db app/js/dps.js "NotNukeDpsCalculator" (identisch zu tools/roster/gen.py).
# Aufruf im Ordner tools/roster/f2/:
#   curl -sSLo index.json https://raw.githubusercontent.com/FAForever/spooky-db/master/app/data/index.json
#   python3 fa_extract.py index.json
import json, math, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index.json'

# Rolle (Unit-ID-Suffix, identisch zu Varkan) -> (Primärreferenz Vorbild-Fraktion, Gegenprobe = Varkan-Referenz)
ROLE_MAP = {
    'cmd_commander':    ('URL0001', 'UEL0001'),
    'lnd_t1_engineer':  ('URL0105', 'UEL0105'),
    'lnd_t2_engineer':  ('URL0208', 'UEL0208'),
    'lnd_t3_engineer':  ('URL0309', 'UEL0309'),
    'lnd_t1_scout':     ('URL0101', 'UEL0101'),
    'lnd_t1_bot':       ('URL0106', 'UEL0106'),
    'lnd_t1_tank':      ('URL0107', 'UEL0201'),
    'lnd_t1_arty':      ('URL0103', 'UEL0103'),
    'lnd_t1_aa':        ('URL0104', 'UEL0104'),
    'lnd_t2_tank':      ('URL0202', 'UEL0202'),
    'lnd_t2_mml':       ('URL0111', 'UEL0111'),
    'lnd_t2_aa':        ('URL0205', 'UEL0205'),
    'lnd_t2_shield':    ('UEL0307', None),        # Vorbild hat keinen mobilen Schild (faction.md §9.2)
    'lnd_t2_bot':       ('DRL0204', 'DEL0204'),
    'lnd_t3_bot':       ('URL0303', 'UEL0303'),
    'lnd_t3_arty':      ('URL0304', 'UEL0304'),
    'lnd_t3_sniper':    ('XAL0305', None),        # Vorbild hat keinen Sniper (wie Varkan)
    'lnd_t3_aa':        ('DRLK001', 'DELK002'),
    'air_t1_scout':     ('URA0101', 'UEA0101'),
    'air_t1_fighter':   ('URA0102', 'UEA0102'),
    'air_t1_bomber':    ('URA0103', 'UEA0103'),
    'air_t2_gunship':   ('URA0203', 'UEA0203'),
    'air_t2_fbomber':   ('DRA0202', 'DEA0202'),
    'str_t1_mex':       ('URB1103', 'UEB1103'),
    'str_t2_mex':       ('URB1202', 'UEB1202'),
    'str_t3_mex':       ('URB1302', 'UEB1302'),
    'str_t1_pgen':      ('URB1101', 'UEB1101'),
    'str_t2_pgen':      ('URB1201', 'UEB1201'),
    'str_t3_pgen':      ('URB1301', 'UEB1301'),
    'str_t1_hydro':     ('URB1102', 'UEB1102'),
    'str_t1_mstore':    ('URB1106', 'UEB1106'),
    'str_t1_estore':    ('URB1105', 'UEB1105'),
    'str_t1_fac_land':  ('URB0101', 'UEB0101'),
    'str_t2_fac_land':  ('URB0201', 'UEB0201'),
    'str_t3_fac_land':  ('URB0301', 'UEB0301'),
    'str_t1_fac_air':   ('URB0102', 'UEB0102'),
    'str_t2_fac_air':   ('URB0202', 'UEB0202'),
    'str_t1_pd':        ('URB2101', 'UEB2101'),
    'str_t2_pd':        ('URB2301', 'UEB2301'),
    'str_t1_aa':        ('URB2104', 'UEB2104'),
    'str_t2_aa':        ('URB2204', 'UEB2204'),
    'str_t3_sam':       ('URB2304', 'UEB2304'),
    'str_t1_wall':      ('URB5101', 'UEB5101'),
    'str_t1_radar':     ('URB3101', 'UEB3101'),
    'str_t2_radar':     ('URB3201', 'UEB3201'),
    'str_t3_radar':     ('URB3104', 'UEB3104'),
    'str_t2_shield':    ('URB4202', 'UEB4202'),   # Stufe 1 der Schildkette
    'str_t3_shield':    ('URB4206', 'UEB4301'),   # erste T3-Stufe der Schildkette
    'str_t2_arty':      ('URB2303', 'UEB2303'),
    'str_t3_arty':      ('URB2302', 'UEB2302'),
}
# Zusätzliche BPs nur zur Information (Zwischenstufen der Schildkette, Post-MVP-Reserverollen)
EXTRA = ['URB4204', 'URB4205', 'URB4207', 'URL0306', 'URB4203', 'URL0203', 'XRL0305']


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
    air = u.get('Air') or {}
    sh = (d.get('Shield') or {})
    ws = []
    for w in u.get('Weapon', []) or []:
        ws.append(dict(name=w.get('DisplayName'), cat=w.get('WeaponCategory'), dmg=w.get('Damage'),
                       rof=w.get('RateOfFire'), range=w.get('MaxRadius'), minRange=w.get('MinRadius'),
                       splash=w.get('DamageRadius'), mv=w.get('MuzzleVelocity'),
                       beam=bool(w.get('BeamLifetime')), dps=round(spooky_dps(w), 2), count=w.get('WeaponNumber') or 1,
                       proj=(w.get('ProjectileId') or '').split('/')[-1]))
    main = [w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
    dps = sum(w['dps'] for w in main)
    hp = d.get('Health')
    shp = sh.get('ShieldMaxHealth')
    mass = e.get('BuildCostMass')
    return dict(desc=u.get('Description'), mass=mass, energy=e.get('BuildCostEnergy'), bt=e.get('BuildTime'),
                br=e.get('BuildRate'), hp=hp, regen=d.get('RegenRate'), shield=shp,
                shieldRegen=sh.get('ShieldRegenRate'), shieldRechargeS=sh.get('ShieldRechargeTime'),
                shieldSize=sh.get('ShieldSize'),
                speed=air.get('MaxAirspeed') or p.get('MaxSpeed'), turn=p.get('TurnRate'),
                intel=u.get('Intel'),
                econ={k: v for k, v in e.items() if k.startswith(('Production', 'Maintenance', 'Storage'))},
                weapons=ws, dps=round(dps, 2),
                dpsPerMass=round(dps / mass, 4) if mass and dps else None,
                hpPerMass=round((hp + (shp or 0)) / mass, 4) if mass else None,
                cats=sorted(c for c in (u.get('Categories') or []) if c))


def main():
    db = json.load(open(SRC))
    units = {u['Id'].upper(): u for u in db['units']}
    out = {'_meta': dict(source='FAForever/spooky-db app/data/index.json', version=db.get('version'),
                         devOnly=True, note='Nur Relationen. FA-Namen nie in Anzeige/i18n.',
                         roleMap={k: dict(bp=v[0], crossCheckBp=v[1]) for k, v in ROLE_MAP.items()})}
    for role, (bp, cc) in ROLE_MAP.items():
        for b in (bp, cc):
            if b and b in units and b not in out:
                out[b] = entry(units[b])
    for b in EXTRA:
        out[b] = entry(units[b])
    json.dump(out, open('fa_ref.json', 'w'), indent=1, ensure_ascii=False)
    missing = [b for v in ROLE_MAP.values() for b in v if b and b not in units]
    print('fa_ref.json:', len(out) - 1, 'BPs, fehlend:', missing)
    for role, (bp, cc) in ROLE_MAP.items():
        r = out[bp]
        print(f"{role:16s} {bp} M{r['mass']:>6} E{r['energy']:>7} BT{r['bt']:>6} HP{r['hp']:>6} SH{r['shield']} R{r['regen']} "
              f"DPS{r['dps']:>8} spd {r['speed']} turn {r['turn']}")
        for w in r['weapons']:
            print('      ', w['cat'], w['dmg'], 'rof', w['rof'], 'rng', w['range'], w['minRange'], 'spl', w['splash'], 'mv', w['mv'], 'dps', w['dps'], 'beam' if w['beam'] else '')


if __name__ == '__main__':
    main()
