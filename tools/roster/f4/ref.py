import json, math
d=json.load(open(__import__('sys').argv[1] if len(__import__('sys').argv)>1 else 'spooky_index.json'))
by={a['Id'].upper():a for a in d['units']}
def wdps(w):
    if not w.get('Damage') or w.get('WeaponCategory') in ('Death',) : return 0.0
    rof=w.get('RateOfFire') or 1
    tr=max(0.1*math.floor(10/rof+1e-9),0.1)
    tr=max((w.get('RackSalvoChargeTime') or 0)+(w.get('RackSalvoReloadTime') or 0)+(w.get('MuzzleSalvoDelay') or 0)*((w.get('MuzzleSalvoSize') or 1)-1),tr)
    s=1
    if (w.get('MuzzleSalvoDelay') or 0)>0: s=w.get('MuzzleSalvoSize') or 1
    elif w.get('RackBones'):
        rb=w['RackBones']
        s=len(rb)*len(rb[0].get('MuzzleBones',[1])) if w.get('RackFireTogether') else len(rb[0].get('MuzzleBones',[1]))
    td=w['Damage']*(w.get('DoTPulses') or 1)+(w.get('InitialDamage') or 0)
    td=max((math.floor((w.get('BeamLifetime') or 0)/((w.get('BeamCollisionDelay') or 0)+0.1))+1)*w['Damage'],td)
    return s*td/tr*(w.get('WeaponNumber') or 1)  # spooky-db fasst identische Waffen (Links/Rechts) zu einem Eintrag mit WeaponNumber zusammen
REFS='XSL0001 XSL0105 XSL0208 XSL0309 XSL0101 XSL0201 XSL0103 XSL0104 XSL0202 XSL0203 XSL0111 XSL0205 XSL0307 XSL0303 XSL0304 XSL0305 DSLK004 XSA0101 XSA0102 XSA0103 XSA0203 XSA0202 XSB1103 XSB1202 XSB1302 XSB1101 XSB1201 XSB1301 XSB1102 XSB1106 XSB1105 XSB0101 XSB0201 XSB0301 XSB0102 XSB0202 XSB2101 XSB2301 XSB2104 XSB2204 XSB2304 XSB5101 XSB3101 XSB3201 XSB3104 XSB4202 XSB4301 XSB2303 XSB2302'.split()
out={}
for i in REFS:
    a=by[i]; e=a.get('Economy',{}); ph=a.get('Physics',{}); air=a.get('Air') or {}
    ws=[]
    for w in a.get('Weapon',[]):
        ws.append(dict(name=w.get('DisplayName'),count=w.get('WeaponNumber') or 1,cat=w.get('WeaponCategory'),dmg=w.get('Damage'),rof=w.get('RateOfFire'),range=w.get('MaxRadius'),minRange=w.get('MinRadius'),splash=w.get('DamageRadius'),mv=w.get('MuzzleVelocity'),dps=round(wdps(w),2),proj=(w.get('ProjectileId') or '').split('/')[-1]))
    dps=sum(x['dps'] for x in ws if x['cat'] not in ('Death',))
    hp=a.get('Defense',{}).get('Health')
    m=e.get('BuildCostMass')
    out[i]=dict(desc=a.get('Description'),mass=m,energy=e.get('BuildCostEnergy'),bt=e.get('BuildTime'),br=e.get('BuildRate'),hp=hp,shield=(a.get('Defense',{}).get('Shield') or {}).get('ShieldMaxHealth'),speed=air.get('MaxAirspeed') or ph.get('MaxSpeed'),turn=ph.get('TurnRate'),intel=a.get('Intel'),econ={k:v for k,v in e.items() if k.startswith(('Production','Maintenance','Storage','Adjacent'))},weapons=ws,dps=round(dps,2),dpsPerMass=round(dps/m,4) if m else None,hpPerMass=round(hp/m,3) if m else None, cats=[c for c in a.get('Categories',[]) if c])
json.dump(out,open('fa_ref.json','w'),indent=1)
for i,v in out.items():
    print(i,v['desc'],'M',v['mass'],'HP',v['hp'],'DPS',v['dps'],'dps/m',v['dpsPerMass'],'hp/m',v['hpPerMass'],'spd',v['speed'],'| econ',v['econ'])
    for w in v['weapons']:
        if w['cat']!='Death' or True: print('     ',w)
