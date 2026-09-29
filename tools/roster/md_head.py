import json
D = json.load(open('roster.json'))
U = D['units']

def n(x, d=None):
    if x is None: return '–'
    if isinstance(x, bool): return 'ja' if x else 'nein'
    if isinstance(x, (int,)) or (isinstance(x, float) and x.is_integer() and d is None):
        s = f'{int(x):,}'.replace(',', '.')
        return s
    if d is None: d = 2
    s = f'{x:.{d}f}'.rstrip('0').rstrip('.') if '.' in f'{x:.{d}f}' else f'{x:.{d}f}'
    return s.replace('.', ',')

def pct(x):
    if x is None: return '–'
    return ('+' if x > 0 else '±' if x == 0 else '−') + n(abs(x), 1) + ' %'

def dot(u): return '●' if u['ms9Core'] else '○'

def weapons(u):
    out = []
    for w in u['weapons']:
        sal = f"{w['salvo']}×" if w['salvo'] > 1 else ''
        rng = (n(w['rangeMin']) + '–' if w.get('rangeMin') else '') + n(w['range'])
        sp = f", Splash {n(w['splash'],1)}" if w.get('splash') else ''
        lay = ' [Luft]' if w['layers'] == ['air'] else ''
        out.append(f"`{w['ref'].split(':')[1]}` {w['type']}: {sal}{n(w['damage'])} / {n(w['reloadS'],1)} s = **{n(w['dps'],1)} DPS**, "
                   f"RW {rng}, {w['projectile']}{sp}{lay}")
    return '<br>'.join(out) if out else '–'

def parts(u):
    ps = []
    for p in u['kitbash']['parts']:
        s = p['part']
        if p.get('note'): s += f"({p['note'].replace('_', ' ')})"
        if p.get('anim'): s += f" ⟳{p['anim']}"
        if p.get('mat'): s += f" [{p['mat']}]"
        ps.append(s)
    k = u['kitbash']; sc = k['scale']
    msc = f"Maßstab {n(sc['xz'],2)}" if sc['xz'] == sc['y'] else f"Maßstab xz {n(sc['xz'],2)} / y {n(sc['y'],2)}"
    st = f"{k['techStripes']} Streifen ({'graphit' if k['techStripeMat'] == 'graphite' else 'keramik'})" if k['techStripes'] else 'keine Streifen'
    return f"{', '.join(ps)} — {k['partCount']} Parts, {k['animatedParts']} anim., ≈ {k['trisEstimate']} Tris · {msc} · {st}"

def special(u):
    s = u['special']; bits = []
    if s['upgradeFrom']: bits.append(f"Upgrade von `{s['upgradeFrom']}`")
    if s['upgradesTo']: bits.append(f"upgradesTo `{s['upgradesTo']}`")
    if s['toggles']: bits.append('Toggles: ' + ', '.join(s['toggles']))
    if s['adjacency']: bits.append('Adjacency: ' + s['adjacency'])
    dw = s['deathWeapon']
    if dw:
        if 'inner' in dw:
            bits.append(f"Death: `{dw['ref'].split(':')[1]}` {n(dw['inner']['damage'])}/r{n(dw['inner']['radius'])} + {n(dw['outer']['damage'])}/r{n(dw['outer']['radius'])} ({dw['note']})")
        else:
            bits.append(f"Death: `{dw['ref'].split(':')[1]}` {n(dw['damage'])}/r{n(dw['radius'],1)} ({dw['note']})")
    if u.get('shield'):
        sh = u['shield']
        bits.append(f"Schild {n(sh['hp'])} HP, r {n(sh['radius'])}, Regen {n(sh['regenPerSec'])}/s ab {n(sh['regenStartS'])} s nach dem letzten Treffer, Neuaufbau {n(sh['rechargeS'])} s, {n(sh['upkeepEnergyPerSec'])} E/s")
    e = u['economy']
    eco = []
    if e.get('buildPower'): eco.append(f"BP {n(e['buildPower'])}")
    if e.get('massPerSec'): eco.append(f"+{n(e['massPerSec'])} M/s")
    if e.get('energyPerSec'): eco.append(f"+{n(e['energyPerSec'])} E/s")
    if e.get('upkeepEnergyPerSec') and not u.get('shield'): eco.append(f"−{n(e['upkeepEnergyPerSec'])} E/s")
    if e.get('storageMass'): eco.append(f"Speicher {n(e['storageMass'])} M")
    if e.get('storageEnergy'): eco.append(f"Speicher {n(e['storageEnergy'])} E")
    if eco: bits.insert(0, ' · '.join(eco))
    if s['notes'] and s['notes'] != '—': bits.append(s['notes'])
    return '<br>'.join(bits)

def hk(u):
    h = u['hotbuild']
    return f"{h['menu']}: {h['slot']}" if h else '–'

def mv(u):
    m = u['motion']
    if m.get('structure'): return '–'
    return f"{n(m['speed'],1)} / {n(m['turnRateDeg'])}°"

def fp(u):
    m = u['motion']
    f = f"{m['footprint'][0]}×{m['footprint'][1]}"
    return f + (f" / s{m['sizeClass']}" if 'sizeClass' in m else '')

def intel(u):
    i = u['intel']
    s = n(i.get('vision'))
    if i.get('radar'): s += f" / R {n(i['radar'])}"
    return s

