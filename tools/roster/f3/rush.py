# T1-Rush gegen den Kommandanten (Review 2026-09-29): Wie viele T1-Einheiten braucht es mindestens, um einen
# Kommandanten im offenen Schlagabtausch zu töten? Verglichen wird unser Roster mit der FA-Referenz derselben Paarung.
# Modell (bewusst einfach, gleich für Roster und FA, 0,1-s-Ticks):
#   - alle Angreifer stehen in Reichweite und feuern ab Tick 0 im Takt ihrer Nachladezeit (kein Kiten, keine Streuung)
#   - der Kommandant regeneriert 10 HP/s und schießt immer auf denselben Angreifer, bis er fällt
#   - mit Sonderschuss (Glanzstoß/Abstich, FAF-Formel): ersetzt den Hauptwaffen-Schuss, sobald >= 7500 E Vorrat und
#     3,3 s seit dem letzten; Schaden >= 1250 tötet jede T1-Einheit, Drain 6 x 1250; Start 13.900 E (Grundspeicher +
#     ein Energiespeicher), +120 E/s (Annahme aus dem Varkan-Review)
# Aufruf: python3 tools/roster/f3/rush.py   (druckt die Tabelle); gen.py und validate.py importieren need().
import math

E0, E_INC, OC_COST, OC_REL, OC_MIN = 13900, 120, 7500, 3.3, 1250


def survives(n, t_hp, t_dmg, t_rel, c_hp, c_regen=10, c_dmg=100, c_rel=1.0, oc=False, t_max=900):
    hp = c_hp; atk = [t_hp] * n; e = E0; last_oc = -1e9; next_c = 0; next_t = 0
    for tick in range(t_max * 10):
        t = tick / 10
        if tick >= next_t:
            hp -= sum(1 for x in atk if x > 0) * t_dmg; next_t = tick + round(t_rel * 10)
        if hp <= 0:
            return False
        if tick >= next_c:
            alive = [i for i, x in enumerate(atk) if x > 0]
            if not alive:
                return True
            if oc and e >= OC_COST and t - last_oc >= OC_REL - 1e-9:
                atk[alive[0]] = 0; e -= 6 * OC_MIN; last_oc = t
            else:
                atk[alive[0]] -= c_dmg
            next_c = tick + round(c_rel * 10)
        hp = min(c_hp, hp + c_regen / 10); e += E_INC / 10
    return True


def need(t_hp, t_dmg, t_rel, c_hp, oc=False, **k):
    for n in range(1, 200):
        if not survives(n, t_hp, t_dmg, t_rel, c_hp, oc=oc, **k):
            return n
    return None


def fa_attacker(fa, bp):
    """(HP, Salvenschaden, Nachladezeit) der stärksten Waffe, 0,1-s-Ticks wie spooky dps.js."""
    r = fa[bp]
    w = max([w for w in r['weapons'] if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']],
            key=lambda w: w['dps'])
    rel = math.floor(10 / w['rof'] + 1e-6) / 10
    salvo = round(w['dps'] * rel / w['dmg'])
    return r['hp'], w['dmg'] * salvo, rel


def roster_attacker(u):
    w = u['weapons'][0]
    return u['health']['max'], w['damage'] * w['salvo'], w['reloadS']


def row(att, cmd, fa_att, a_bp, fa_cmd, c_bp, required=True):
    """att/cmd: roster-Einträge; fa_*: fa_ref-Dicts; *_bp: FA-Referenz-BPs."""
    th, td, tr = roster_attacker(att)
    fth, ftd, ftr = fa_attacker(fa_att, a_bp)
    ch, fch = cmd['health']['max'], fa_cmd[c_bp]['hp']
    res = dict(attacker=att['id'], commander=cmd['id'], required=required,
               n=need(th, td, tr, ch), nOc=need(th, td, tr, ch, oc=True),
               fa=dict(attacker=a_bp, commander=c_bp, n=need(fth, ftd, ftr, fch), nOc=need(fth, ftd, ftr, fch, oc=True)))
    res['mass'] = res['n'] * att['economy']['mass']
    res['massOc'] = res['nOc'] * att['economy']['mass']
    res['match'] = res['n'] == res['fa']['n'] and res['nOc'] == res['fa']['nOc']
    return res


if __name__ == '__main__':
    import json
    from pathlib import Path
    HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[2]
    D = json.load(open(ROOT / 'docs/design/factions/f3/roster.json'))
    for r in D['checks']['rush']:
        print(r['attacker'], '->', r['commander'], r['n'], r['nOc'], 'FA', r['fa']['n'], r['fa']['nOc'], '✓' if r['match'] else '✗')
