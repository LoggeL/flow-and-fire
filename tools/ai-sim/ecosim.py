#!/usr/bin/env python3
"""Flow-Eco-Simulation der KI-Eröffnungen (docs/design/ai.md §4, docs/design/ai-openings.json).

Reine Eco-Rechnung ohne Kampf: 10-Hz-Ticks, Flow-Verbrauch mit globaler Stall-Ratio wie PLAN §3.4
(ratio = min(Mass-Anteil, Energy-Anteil), ein Tier), Build Power nach FA-Semantik (Sekunden =
buildTime / BP), Laufwege aus Pfad-Distanzen auf der echten Heightmap (Dijkstra, 2-WU-Raster) bzw.
Luftlinie x Umweg-Faktor zwischen zwei Baustellen. Nach der Eröffnung übernehmen vereinfachte Manager
(Economy/Engineer/Factory/Tech wie ai.md §5), damit T2-Zeit und erste Welle bis 12 min messbar sind.

Aufruf (im Repo-Root):
  python3 tools/ai-sim/ecosim.py                   # Tabellen für alle Eröffnungen x Karten
  python3 tools/ai-sim/ecosim.py --timeline eco_standard --map setons   # Ereignisliste
  python3 tools/ai-sim/ecosim.py --maps            # Kartenanalyse (Spots, Distanzen, Zonen)
  python3 tools/ai-sim/ecosim.py --write-expect    # 'expect'-Blöcke in ai-openings.json schreiben
  python3 tools/ai-sim/ecosim.py --check           # Abweichung zu 'expect' prüfen (Exit 1 bei Verstoß)
  python3 tools/ai-sim/ecosim.py --difficulty easy # Denkpausen/Fehlerrate aus difficultyTiming

Abhängigkeiten: Python >= 3.10, numpy, scipy, Pillow. Deterministisch (fester Seed für die Easy-Fehlerrate).
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

ROOT = Path(__file__).resolve().parents[2]
ROSTER = ROOT / 'docs/design/roster.json'
OPENINGS = ROOT / 'docs/design/ai-openings.json'
MAPS = {
    # name: (Quelle, eigene Army, gegnerische Army, Kartenklasse für weights.maps)
    'setons': ('content/maps/src/setons', 0, 1, 'setons'),
    'hollow-ridge': ('content/maps/src/hollow-ridge', 0, 1, 'size512'),
}
DT = 0.1
HORIZON_S = 720.0  # 12 min: MS9-Gate "T2 in <= 12 min"
TOL = {'t': 5.0, 'income': 0.6, 'count': 1}  # --check: Toleranzen (s, M/s, Stück)

# ----------------------------------------------------------------------------------------------
# Kategorie-Ausdrücke (gleiche Grammatik wie packages/rules/src/expr.ts)
# ----------------------------------------------------------------------------------------------
_TOK = re.compile(r'\s*([A-Z][A-Z0-9_]*|[&|!()\-])')


def cat_expr(src: str):
    toks = _TOK.findall(src)
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else None

    def take():
        nonlocal pos
        pos += 1
        return toks[pos - 1]

    def expr():
        left = term()
        while peek() == '|':
            take()
            r = term()
            left = (lambda a, b: lambda c: a(c) or b(c))(left, r)
        return left

    def term():
        left = unary()
        while peek() in ('&', '-'):
            op = take()
            r = unary()
            if op == '&':
                left = (lambda a, b: lambda c: a(c) and b(c))(left, r)
            else:
                left = (lambda a, b: lambda c: a(c) and not b(c))(left, r)
        return left

    def unary():
        if peek() == '!':
            take()
            a = unary()
            return lambda c: not a(c)
        return primary()

    def primary():
        t = take()
        if t == '(':
            e = expr()
            assert take() == ')', src
            return e
        return lambda c, n=t: n in c

    e = expr()
    assert pos == len(toks), f'Ausdruck nicht vollständig gelesen: {src}'
    return e


# ----------------------------------------------------------------------------------------------
# Roster
# ----------------------------------------------------------------------------------------------
@dataclass
class Bp:
    id: str
    name: str
    cats: frozenset
    tech: int
    mass: float
    energy: float
    bt: float
    bp: float
    mps: float
    eps: float
    upkeepE: float
    storM: float
    storE: float
    speed: float
    hp: float
    dps_surface: float
    dps_air: float
    upgrades_to: str | None
    upgrade_from: str | None
    ms: str


def load_roster() -> dict[str, Bp]:
    d = json.loads(ROSTER.read_text())
    out = {}
    for u in d['units']:
        e = u['economy']
        ws = u.get('weapons') or []
        ds = sum(w['dps'] for w in ws if 'land' in w['layers'] and 'tapshot' not in w['ref'])
        da = sum(w['dps'] for w in ws if 'air' in w['layers'])
        out[u['id']] = Bp(
            id=u['id'], name=u['name']['de'], cats=frozenset(u['categories']), tech=u['tech'],
            mass=e.get('mass') or 0, energy=e.get('energy') or 0, bt=e.get('buildTime') or 0,
            bp=e.get('buildPower') or 0, mps=e.get('massPerSec') or 0, eps=e.get('energyPerSec') or 0,
            upkeepE=e.get('upkeepEnergyPerSec') or 0, storM=e.get('storageMass') or 0,
            storE=e.get('storageEnergy') or 0, speed=(u.get('motion') or {}).get('speed') or 0,
            hp=u['health']['max'] + ((u.get('shield') or {}).get('hp') or 0), dps_surface=ds, dps_air=da,
            upgrades_to=u['special'].get('upgradesTo'), upgrade_from=u['special'].get('upgradeFrom'),
            ms=u['msFirst'])
    return out


class Roles:
    def __init__(self, roster: dict[str, Bp], roles: dict[str, str]):
        self.roster = roster
        self.expr = {k: cat_expr(v) for k, v in roles.items()}

    def resolve(self, role: str, tech: int) -> Bp:
        f = self.expr[role]
        hits = [b for b in self.roster.values()
                if f(b.cats) and f'TECH{tech}' in b.cats and b.upgrade_from is None]
        if not hits:  # Upgrade-Stufen (Zapfstelle II ...) nur, wenn sonst nichts passt
            hits = [b for b in self.roster.values() if f(b.cats) and f'TECH{tech}' in b.cats]
        if len(hits) != 1:
            raise SystemExit(f'Rolle {role}@T{tech} ist nicht eindeutig: {[h.id for h in hits]}')
        return hits[0]


# ----------------------------------------------------------------------------------------------
# Karte: Passierbarkeit, Pfad-Distanzen, Zonen
# ----------------------------------------------------------------------------------------------
@dataclass
class Spot:
    x: float
    z: float
    kind: str  # 'mass' | 'hydro'
    d_own: float
    d_enemy: float
    zone: str  # own | contested | enemy | unreachable
    idx: int


@dataclass
class MapInfo:
    name: str
    size: int
    start: tuple
    enemy: tuple
    fwd: tuple
    spots: list
    d_rally_enemy: float
    klass: str
    detour: float


def analyze_map(name: str, assume: dict) -> MapInfo:
    src, a_own, a_en, klass = MAPS[name]
    mk = json.loads((ROOT / src / 'markers.json').read_text())
    raw = np.array(Image.open(ROOT / src / 'heightmap.png')).astype(np.float64)
    h = raw * mk['heightScaleRaw'] / 4096.0
    wl = mk['waterLevel']
    gz, gx = np.gradient(h)
    slope = np.hypot(gx, gz)
    pas1 = (wl - h <= assume['passability']['maxWaterDepthWu']) & (slope <= assume['passability']['maxSlope'])
    g = int(assume['passability']['gridWu'])
    n = (pas1.shape[0] - 1) // g
    p = pas1[: n * g, : n * g].reshape(n, g, n, g).all(axis=(1, 3))
    idx = np.arange(n * n).reshape(n, n)
    rows, cols, wts = [], [], []

    def add(a_mask, b_idx_a, b_idx_b, w):
        rows.append(b_idx_a[a_mask]); cols.append(b_idx_b[a_mask]); wts.append(np.full(a_mask.sum(), w))

    # rechts, unten, diagonal (ohne Eckenschneiden)
    add(p[:, :-1] & p[:, 1:], idx[:, :-1], idx[:, 1:], g)
    add(p[:-1, :] & p[1:, :], idx[:-1, :], idx[1:, :], g)
    dg = g * math.sqrt(2)
    add(p[:-1, :-1] & p[1:, 1:] & p[:-1, 1:] & p[1:, :-1], idx[:-1, :-1], idx[1:, 1:], dg)
    add(p[:-1, 1:] & p[1:, :-1] & p[:-1, :-1] & p[1:, 1:], idx[:-1, 1:], idx[1:, :-1], dg)
    graph = coo_matrix((np.concatenate(wts), (np.concatenate(rows), np.concatenate(cols))),
                       shape=(n * n, n * n)).tocsr()

    def node(x, z):
        cx, cz = int(x // g), int(z // g)
        for r in range(0, 6):
            best = None
            for dz in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dz)) != r:
                        continue
                    ix, iz = cx + dx, cz + dz
                    if 0 <= ix < n and 0 <= iz < n and p[iz, ix]:
                        d = dx * dx + dz * dz
                        if best is None or d < best[0]:
                            best = (d, idx[iz, ix])
            if best:
                return best[1]
        return None

    st = {s['army']: (s['x'], s['z']) for s in mk['starts']}
    own, en = st[a_own], st[a_en]
    dist = dijkstra(graph, directed=False, indices=[node(*own), node(*en)])
    fl = math.hypot(en[0] - own[0], en[1] - own[1])
    fwd = ((en[0] - own[0]) / fl, (en[1] - own[1]) / fl)
    spots = []
    ratios = []
    for kind, arr in (('mass', mk['mass']), ('hydro', mk['hydro'])):
        for i, s in enumerate(arr):
            nd = node(s['x'], s['z'])
            do = float(dist[0, nd]) if nd is not None else math.inf
            de = float(dist[1, nd]) if nd is not None else math.inf
            if not math.isfinite(do):
                zone = 'unreachable'
            else:
                share = do / (do + de)
                zone = 'own' if share < 0.4 else ('contested' if share <= 0.6 else 'enemy')
                eu = math.hypot(s['x'] - own[0], s['z'] - own[1])
                if eu > 30 and zone == 'own':
                    ratios.append(do / eu)
            spots.append(Spot(s['x'], s['z'], kind, do, de, zone, i))
    detour = float(np.median(ratios)) if ratios else assume['straightLineDetour']
    # Sammelpunkt 45 WU auf dem kürzesten Weg Richtung Gegner (ai.md §3)
    d_se = float(dist[1, node(*own)])
    return MapInfo(name, mk['sizeWu'], own, en, fwd, spots, d_se - 45.0, klass,
                   max(assume['straightLineDetour'], detour))


# ----------------------------------------------------------------------------------------------
# Simulation
# ----------------------------------------------------------------------------------------------
@dataclass
class Structure:
    bp: Bp
    pos: tuple
    slot: str | None = None
    progress: float = 0.0
    done: bool = False
    bonusE: float = 1.0          # Adjacency-Faktor (Glutkranz)
    upgrading: Bp | None = None  # Ziel-Blueprint während In-Place-Upgrade
    up_progress: float = 0.0
    spot: Spot | None = None
    fname: str | None = None     # Fabrik-Name (fac1, fac2, …)
    plan: list = field(default_factory=list)
    loop: list = field(default_factory=list)
    loop_i: int = 0
    prod: Bp | None = None
    prod_progress: float = 0.0
    bp_now: float = 0.0          # in diesem Tick anliegende Build Power


@dataclass
class Builder:
    name: str
    bp: Bp
    pos: tuple
    rng: float
    plan: list = field(default_factory=list)
    job: object = None      # Structure (bauen) oder ('assist', Structure)
    walk: float = 0.0       # verbleibende Laufzeit (s)
    delay: float = 0.0      # Denkpause (Schwierigkeit)
    until: float = 1e9      # Assist-Neubewertung (EngineerManager)
    idle_s: float = 0.0
    alive_s: float = 0.0
    ring: list = field(default_factory=list)  # für den Vogt reservierte Ring-Spots


class Sim:
    ASSIST_RECHECK_S = 10.0   # EngineerManager bewertet Assist-Jobs alle 10 s neu
    BOARD_NEAR_WU = 80.0      # Board-Aufgaben an der Basis nur für Bauer in <= 80 WU ...
    BOARD_ANY_AFTER_S = 20.0  # ... außer die Aufgabe wartet schon >= 20 s
    PREEMPT_PGEN_S = 5.0      # unvergebene Kraftwerks-Aufgabe -> vorn in die Vogt-Queue

    def __init__(self, op: dict, mi: MapInfo, cfg: dict, roster: dict, difficulty: str = 'normal', seed: int = 1):
        self.op, self.mi, self.cfg = op, mi, cfg
        self.R = Roles(roster, cfg['roles'])
        self.roster = roster
        self.assume = cfg['assumptions']
        self.diff = cfg['difficultyTiming'][difficulty]
        self.rnd = random.Random(seed)
        self.fu = op['followUp']
        self.t = 0.0
        acu = next(b for b in roster.values() if 'COMMAND' in b.cats)
        self.storM_cap, self.storE_cap = acu.storM, acu.storE
        self.M, self.E = acu.storM, acu.storE          # Annahme: voller Startspeicher
        self.inc_base = (acu.mps, acu.eps)
        self.structs: list[Structure] = []
        self.builders: list[Builder] = []
        self.events: list[tuple] = []
        self.reserved: set = set()
        self.board: list[dict] = []
        self.eng_plans = [list(p) for p in op['engineers']]
        self.eng_count = 0
        self.eng_spawned = 0
        self.eng_bonus = 0
        self.army: list[tuple] = []
        self.waves: list[dict] = []
        self.wave_size = self.fu['waves']['first'] + self.diff.get('waveExtra', 0)
        self.pool = 0
        self.stats = dict(ticks=0, stallE=0, stallM_bp=0.0, bp_total=0.0, overflowM=0.0, incM=0.0)
        self.samples = {}
        self.tech_started = None
        self.tech_done = None
        self.mstore_hist: list[float] = []
        self.kranz_free = 0
        self.last_mratio = 1.0
        self.near_used: dict = {}
        self.eco_used = 0
        self.eng_t2 = 0
        self.e_reserved = 0.0  # E/s, die beschlossene Mass-Senken demnächst brauchen
        self.flow_hist: list[tuple] = []
        self.stall_t: list[float] = []  # Ticks mit Energie-Ratio < 1 (--timeline zeigt die Fenster)
        own_mass = [s for s in mi.spots if s.kind == 'mass' and s.zone == 'own']
        self.own_max_t1 = acu.mps + 2.0 * len(own_mass)
        slots = cfg['baseTemplate']['slots']
        self.slots = {k: self.local(v['f'], v['s']) for k, v in slots.items()}
        self.factory_plans = dict(op['factories'])
        vogt = Builder('Vogt', acu, mi.start, self.assume['buildRangeWu']['COMMAND'], plan=self.expand(op['acu']))
        # OpeningScript reserviert beim Start so viele Ring-Spots, wie die Vogt-Queue braucht (ai.md §4.3)
        n_ring = sum(1 for s in vogt.plan if s.get('at') == 'ring')
        ring = sorted((s for s in own_mass if s.d_own <= 40), key=lambda s: (s.d_own, s.idx))[:n_ring]
        for s in ring:
            self.reserved.add((s.kind, s.idx))
        vogt.ring = ring
        self.builders.append(vogt)

    # --- Geometrie ---------------------------------------------------------------------------
    def local(self, f, s):
        fx, fz = self.mi.fwd
        x0, z0 = self.mi.start
        return (x0 + fx * f - fz * s, z0 + fz * f + fx * s)

    def dist(self, a, b):
        return math.hypot(a[0] - b[0], a[1] - b[1]) * self.mi.detour

    def expand(self, steps):
        out = []
        for st in steps:
            for _ in range(st.get('count', 1)):
                s = dict(st)
                s.pop('count', None)
                out.append(s)
        return out

    # --- Ressourcen --------------------------------------------------------------------------
    def income(self):
        m, e = self.inc_base
        up = 0.0
        for s in self.structs:
            if s.done:
                m += s.bp.mps
                e += s.bp.eps * s.bonusE
                up += s.bp.upkeepE
        return m, e, up

    def log(self, ev, **kw):
        self.events.append((round(self.t, 1), ev, kw))

    # --- Standortwahl ------------------------------------------------------------------------
    def pick_spot(self, kind, b: Builder, ring=False):
        best = None
        allow_contested = self.t >= 360 or self.tech_done is not None
        for sp in self.mi.spots:
            if sp.kind != kind or (sp.kind, sp.idx) in self.reserved:
                continue
            if sp.zone not in ('own', 'contested') or (sp.zone == 'contested' and not allow_contested):
                continue
            if ring and sp.d_own > 40:
                continue
            score = self.dist(b.pos, (sp.x, sp.z)) + 0.5 * sp.d_own
            if best is None or score < best[0] - 1e-9:
                best = (score, sp)
        return best[1] if best else None

    def site(self, step, b: Builder):
        at = step['at']
        if at == 'ring' and b.ring:
            sp = b.ring.pop(0)
            return (sp.x, sp.z, sp)
        if at in ('ring', 'mex:next'):
            sp = self.pick_spot('mass', b, ring=(at == 'ring')) or (self.pick_spot('mass', b) if at == 'ring' else None)
            return (sp.x, sp.z, sp) if sp else None
        if at == 'hydro:next':
            sp = self.pick_spot('hydro', b)
            return (sp.x, sp.z, sp) if sp else None
        if at == 'slot:eco':
            k = self.eco_used
            self.eco_used += 1
            r = 12 + 6 * (k // 8)
            ang = math.radians(45 + 90 * (k % 4) + (20 if (k // 4) % 2 else 0))
            return (*self.local(r * math.cos(ang), r * math.sin(ang)), None)
        if at.startswith('slot:'):
            name = at[5:]
            p = self.slots.get(name) or self.auto_slot(name)
            return (p[0], p[1], None)
        if at.startswith('near:'):
            ref = at[5:]
            k = self.near_used.get(ref, 0)
            self.near_used[ref] = k + 1
            base = self.cfg['baseTemplate']['slots'][ref]
            half = base['footprint'] / 2 + 1
            f, s = [(0, half), (0, -half), (-half, 0), (half, 0)][k % 4]
            return (*self.local(base['f'] + f, base['s'] + s + 2 * (k // 4)), None)
        if at == 'kranz':
            p = self.slots['estore']
            return (p[0] + 2, p[1], None)
        raise SystemExit(f'unbekannte Stelle {at}')

    def auto_slot(self, name):
        """Weitere Fabrik-Plätze hinter der Basis (Raster 13 WU), wenn die Vorlage erschöpft ist."""
        k = int(name[3:]) if name[3:].isdigit() else 9
        p = self.local(-4 - 13 * ((k - 2) // 2), 13 if k % 2 else -13)
        self.slots[name] = p
        return p

    # --- Jobs --------------------------------------------------------------------------------
    def start_build(self, b: Builder, step) -> bool:
        role, tech = step['role'], step.get('tech', 1)
        if role == 'hydro' and self.pick_spot('hydro', b) is None and 'fallback' in step:
            b.plan[:0] = self.expand([dict(step['fallback'], do='build')])
            return False
        if role == 'mex' and self.diff.get('skipChance', 0) and self.rnd.random() < self.diff['skipChance']:
            self.log('skip', who=b.name, role=role)
            return False
        bp = self.R.resolve(role, tech)
        loc = self.site(step, b)
        if loc is None:
            return False
        x, z, sp = loc
        if sp is not None:
            self.reserved.add((sp.kind, sp.idx))
        s = Structure(bp, (x, z), slot=step['at'], spot=sp)
        if step['at'] == 'kranz' and self.kranz_free > 0:
            s.bonusE = 1.25
            self.kranz_free -= 1
        if 'FACTORY' in bp.cats:
            s.fname = step['at'][5:] if step['at'].startswith('slot:') else f'fac{len(self.factories()) + 1}'
        self.structs.append(s)
        self.log('start', who=b.name, what=bp.name, at=(round(x), round(z)))
        b.job = s
        b.until = 1e9
        b.walk = max(0.0, self.dist(b.pos, (x, z)) - b.rng) / b.bp.speed
        b.pos = (x, z)
        return True

    def assist(self, b: Builder, target: Structure):
        b.job = ('assist', target)
        b.until = self.t + self.ASSIST_RECHECK_S if target.upgrading is None else 1e9
        b.walk = max(0.0, self.dist(b.pos, target.pos) - b.rng - 4) / b.bp.speed
        b.pos = target.pos

    def factories(self):
        return [s for s in self.structs if s.fname and 'FACTORY' in s.bp.cats]

    # --- EconomyManager (1 Hz) ---------------------------------------------------------------
    def eng_target(self):
        f = self.fu['engineers']
        cap = 0
        for t0, n in f['cap']:
            if self.t >= t0:
                cap = n
        free = sum(1 for sp in self.mi.spots if sp.kind == 'mass' and sp.zone in ('own', 'contested')
                   and (sp.kind, sp.idx) not in self.reserved)
        cap = max(1, int(cap * self.diff.get('engineerCapFactor', 1.0)))
        return min(cap, f['base'] + math.ceil(free / f['perFreeSpots'])) + self.eng_bonus

    def pgen_inflight(self):
        return (sum(1 for s in self.structs if not s.done and 'ENERGYPRODUCTION' in s.bp.cats)
                + sum(1 for t in self.board if t['role'] == 'pgen')
                + sum(1 for b in self.builders for st in b.plan[:2] if st.get('role') == 'pgen'))

    def energy_need(self):
        """Energie-Prognose über horizonS mit mass-gedrosseltem Bedarf (ai.md §5.1).

        Liefert (Anzahl, Tech) der zusätzlich zu bestellenden Kraftwerke."""
        f = self.fu['energy']
        m, e, up = self.income()
        dem = sum(k[1].energy * r for k, r in self.active_rates()) * self.last_mratio
        # Bilanz-Regel: Einkommen >= 1,1 x (mass-gedrosselter Bedarf + reservierte Senken); ein Speicher über
        # der Reserve wird über 60 s „verteilt“ und darf die Lücke decken. Dazu die Speicher-Prognose über horizonS.
        flow_def = 1.1 * (dem + self.e_reserved) - (e - up) - max(0.0, self.E - f['reserveE']) / 60.0
        proj = self.E + (e - up - dem - self.e_reserved) * f['horizonS']
        store_def = (f['reserveE'] - proj) / f['horizonS']
        deficit = max(flow_def, store_def)  # E/s
        if deficit <= 0:
            return 0, 1
        t2 = any(b.bp.tech >= 2 and 'ENGINEER' in b.bp.cats for b in self.builders)
        if t2 and deficit >= 150:
            inflight2 = sum(1 for x in self.structs if not x.done and 'ENERGYPRODUCTION' in x.bp.cats and x.bp.tech == 2) \
                + sum(1 for t in self.board if t['role'] == 'pgen' and t.get('tech') == 2)
            return (1 if inflight2 == 0 else 0), 2
        cap = f['maxInflight'] + int((e - up) // 100)
        need = math.ceil(deficit / 20.0)
        return max(0, min(cap, need) - self.pgen_inflight()), 1

    def post(self, step, prio):
        self.board.append(dict(step, prio=prio, t0=self.t))

    def economy_manager(self):
        n, tech = self.energy_need()
        for _ in range(n):
            at = 'kranz' if (self.kranz_free and tech == 1) else 'slot:eco'
            self.post({'do': 'build', 'role': 'pgen', 'tech': tech, 'at': at}, 90)
        self.e_reserved = max(0.0, self.e_reserved * 0.9)
        es = self.fu.get('estore')
        if (es and self.t >= es['atS'] and not any('ENERGYSTORAGE' in s.bp.cats for s in self.structs)
                and not any(t['role'] == 'estore' for t in self.board)
                and not any(st.get('role') == 'estore' for b in self.builders for st in b.plan)):
            self.post({'do': 'build', 'role': 'estore', 'tech': 1, 'at': 'slot:estore'}, 70)
        # Notfall-Vorgriff: droht der Energiespeicher in <= 10 s leer zu laufen, baut der Vogt das
        # älteste unvergebene Kraftwerk als Nächstes (sonst bleibt die Eröffnungs-Queue unangetastet)
        vogt = self.builders[0]
        m, e, up = self.income()
        dem = sum(k[1].energy * r for k, r in self.active_rates()) * self.last_mratio
        emergency = self.E + (e - up - dem) * 10.0 < 0
        for t in list(self.board):
            if emergency and t['role'] == 'pgen' and self.t - t['t0'] >= self.PREEMPT_PGEN_S:
                if not any(st.get('role') == 'pgen' for st in vogt.plan[:1]):
                    self.board.remove(t)
                    vogt.plan.insert(0, {k: v for k, v in t.items() if k not in ('prio', 't0')})
        self.spend_rule()

    # geschätzte Mass-Senke je Maßnahme in M/s (ai.md §5.1, Tabelle „Mass-Senken“)
    SINK = {'mex_upgrade': 10.0, 'factory': 3.7, 'factory_upgrade': 12.2, 'engineer': 3.0}
    ENG_BONUS_MAX = 6
    ESINK = {'mex_upgrade': 60.0, 'factory': 19.0, 'factory_upgrade': 96.0, 'engineer': 25.0}

    def spend_rule(self):
        """Mass-Senke: Speicher > Schwelle über forS -> Überschuss auf Maßnahmen verteilen (ai.md §5.1)."""
        ef = self.fu['extraFactory']
        if self.t < ef['minS'] or self.mstore_full_for() < ef['forS']:
            return
        n = int(ef['forS'] / DT)
        hist = self.flow_hist[-n:]
        surplus = sum(i - o for i, o in hist) / max(1, len(hist))
        self.mstore_hist.clear()
        m, e, up = self.income()
        mu = self.fu['mexUpgrade']
        facs = self.factories()
        used = {f.fname for f in facs} | {t['at'][5:] for t in self.board if t['role'].startswith('fac')}
        # Review R-S3: beschlossene, noch nicht begonnene Senken (Fabrik-Aufträge auf dem Board) zählen schon
        surplus -= self.SINK['factory'] * sum(1 for t in self.board if t['role'].startswith('fac'))
        e_free = self.e_free()
        actions = 0
        while surplus > 1.0 and actions < 4:
            actions += 1
            running = sum(1 for s in self.structs if s.upgrading is not None and 'MASSEXTRACTION' in s.bp.cats)
            if (self.t >= mu['minS'] or self.tech_done is not None or self.saturated_for_upgrade()) \
                    and running < 1 + int(m // 15) and self.has_mex_upgrade_candidate():
                # Review R-S2 „Energie zuerst“: Upgrade startet nur, wenn die Energie dafür frei ist;
                # sonst Reservierung buchen (Kraftwerke kommen zuerst) und im nächsten Takt neu prüfen
                if e_free < self.ESINK['mex_upgrade']:
                    self.e_reserved += self.ESINK['mex_upgrade']
                    self.log('wait_energy', what='mex_upgrade')
                    break
                self.start_mex_upgrade()
                e_free -= self.ESINK['mex_upgrade']
                surplus -= self.SINK['mex_upgrade']
                self.e_reserved += self.ESINK['mex_upgrade']
                continue
            if len(used) < 1 + int(m // 6):
                names = list(ef['slots']) + [f'fac{k}' for k in range(4, 24)]
                sl = next(x for x in names if x not in used)
                used.add(sl)
                self.post({'do': 'build', 'role': ef['role'], 'tech': 1, 'at': f'slot:{sl}'}, 60)
                self.log('spend', what='fabrik', slot=sl)
                surplus -= self.SINK['factory']
                self.e_reserved += self.ESINK['factory']
                continue
            t1 = [f for f in facs if f.done and f.bp.tech == 1 and f.upgrading is None and f.bp.upgrades_to
                  and 'LAND' in f.bp.cats] if self.tech_done is not None else []
            if t1:
                if e_free < self.ESINK['factory_upgrade']:
                    self.e_reserved += self.ESINK['factory_upgrade']
                    self.log('wait_energy', what='fabrik_upgrade')
                    break
                e_free -= self.ESINK['factory_upgrade']
                t1[0].upgrading = self.roster[t1[0].bp.upgrades_to]
                t1[0].prod = None
                self.log('spend', what='fabrik_upgrade', fac=t1[0].fname)
                surplus -= self.SINK['factory_upgrade']
                self.e_reserved += self.ESINK['factory_upgrade']
                continue
            if self.eng_bonus >= self.ENG_BONUS_MAX:
                break  # Rest bleibt im Speicher (Overflow-Kennzahl), statt die APM mit Engineers zu fluten
            self.eng_bonus += 1
            self.log('spend', what='engineer', target=self.eng_target())
            surplus -= self.SINK['engineer']
            self.e_reserved += self.ESINK['engineer']

    def e_free(self):
        """Freie Energie-Rate für neue Verbraucher (ai.md §5.1 „Energie zuerst“): Netto-Überschuss nach dem
        mass-gedrosselten Bedarf plus Speicher über der Reserve (verteilt auf 90 s = Dauer eines Mex-Upgrades) minus Reservierungen."""
        m, e, up = self.income()
        dem = sum(k[1].energy * r for k, r in self.active_rates()) * self.last_mratio
        return (e - up - dem) + max(0.0, self.E - self.fu['energy']['reserveE']) / 90.0 - self.e_reserved

    def saturated(self):
        """Eigene Zone voll: kein freier (unreservierter) Mass-Spot der Zone 'own' mehr."""
        return not any(sp.kind == 'mass' and sp.zone == 'own' and (sp.kind, sp.idx) not in self.reserved
                       for sp in self.mi.spots)

    def saturated_for_upgrade(self):
        mu = self.fu['mexUpgrade']
        return self.saturated() and self.t >= mu.get('saturatedS', 1e9) + self.diff.get('techDelayS', 0)

    def has_mex_upgrade_candidate(self):
        return any(s.done and 'MASSEXTRACTION' in s.bp.cats and s.bp.upgrades_to and s.upgrading is None
                   and s.spot is not None and s.bp.tech == 1 for s in self.structs)

    def mstore_full_for(self):
        thr = self.fu['extraFactory']['massStoreFrac']
        n = 0
        for v in reversed(self.mstore_hist):
            if v < thr:
                break
            n += 1
        return n * DT

    # --- TechManager (1 Hz) ------------------------------------------------------------------
    def tech_manager(self):
        tt = self.fu['techT2']
        m, e, up = self.income()
        delay = self.diff.get('techDelayS', 0)
        if self.tech_started is None and self.t >= tt['minS'] + delay and m >= min(tt['minMassIncome'], 0.8 * self.own_max_t1):
            dem_e = sum(k[1].energy * r for k, r in self.active_rates()) * self.last_mratio
            if e - up - dem_e >= tt['minEnergySurplus'] or self.E >= 2000:
                fac = next((f for f in self.factories() if f.done and f.bp.upgrades_to), None)
                if fac is not None:
                    fac.upgrading = self.roster[fac.bp.upgrades_to]
                    fac.prod = None
                    fac.prod_progress = 0.0
                    self.tech_started = self.t
                    self.log('tech_start', fac=fac.fname)
        mu = self.fu['mexUpgrade']
        sat = self.saturated_for_upgrade()
        if (self.t < mu['minS'] + delay and not sat) or m < min(mu['minMassIncome'], 0.9 * self.own_max_t1):
            return
        teching = self.tech_started is not None and self.tech_done is None
        if teching and not sat:
            return  # Tech-Upgrade hat Vorrang, außer die eigene Zone ist voll (Review R-S2, FA-Konvention)
        running = sum(1 for s in self.structs if s.upgrading is not None and 'MASSEXTRACTION' in s.bp.cats)
        if running < (1 if teching else mu['maxParallel']) and self.has_mex_upgrade_candidate():
            if self.e_free() < self.ESINK['mex_upgrade']:
                self.e_reserved = max(self.e_reserved, self.ESINK['mex_upgrade'])  # Kraftwerke zuerst
                return
            self.start_mex_upgrade()
            self.e_reserved += self.ESINK['mex_upgrade']

    def start_mex_upgrade(self):
        cands = [s for s in self.structs if s.done and 'MASSEXTRACTION' in s.bp.cats and s.bp.upgrades_to
                 and s.upgrading is None and s.spot is not None and s.bp.tech == 1]
        if not cands:
            return False
        s = min(cands, key=lambda c: (c.spot.d_own, c.spot.idx))
        s.upgrading = self.roster[s.bp.upgrades_to]
        self.log('mex_upgrade_start', at=(s.spot.x, s.spot.z))
        return True

    # --- EngineerManager (2 Hz, hier bei Bedarf) ---------------------------------------------
    def policy_step(self, b: Builder):
        base = self.mi.start
        btech = max(1, b.bp.tech)
        cands = [t for t in self.board if t.get('tech', 1) <= btech and
                 (self.dist(b.pos, base) <= self.BOARD_NEAR_WU or self.t - t['t0'] >= self.BOARD_ANY_AFTER_S)]
        if cands:
            t = max(cands, key=lambda t: (t['prio'], -t['t0']))
            self.board.remove(t)
            return {k: v for k, v in t.items() if k not in ('prio', 't0')}
        up = self.upgrade_target(b)
        if up is not None:
            return {'do': 'assist', 'target': up}
        if b.name != 'Vogt':
            if self.pick_spot('hydro', b) is not None:
                return {'do': 'build', 'role': 'hydro', 'tech': 1, 'at': 'hydro:next'}
            if self.pick_spot('mass', b) is not None:
                return {'do': 'build', 'role': 'mex', 'tech': 1, 'at': 'mex:next'}
        elif self.pick_spot('mass', b, ring=True) is not None:
            return {'do': 'build', 'role': 'mex', 'tech': 1, 'at': 'ring'}
        # Review R-S4: bei Mass-Überschuss laufende große Baustellen (Fabrik, Speicher, Dampfquelle) beschleunigen,
        # statt eine Fabrik zu bewachen (Prio 12 zwischen Mex-Upgrade-Assist und Guard)
        if self.M / self.storM_cap >= 0.3 and b.name != 'Vogt':
            sites = [s for s in self.structs if not s.done and s.bp.mass >= 150 and
                     self.dist(s.pos, self.mi.start) <= self.BOARD_NEAR_WU and
                     sum(1 for x in self.builders if (x.job is s) or (isinstance(x.job, tuple) and x.job[1] is s)) < 4]
            if sites:
                return {'do': 'assist', 'target': min(sites, key=lambda s: (self.dist(b.pos, s.pos), s.pos))}
        facs = [f for f in self.factories() if f.done and f.upgrading is None]
        if facs:
            return {'do': 'assist', 'target': min(facs, key=lambda f: self.dist(b.pos, f.pos))}
        return None

    def upgrade_target(self, b: Builder):
        """Assist-Ziele mit Sollbesetzung: Tech-/Mex-Upgrades und T2-Kraftwerke (ai.md §5.3)."""
        best = None
        for s in self.structs:
            big_pgen = not s.done and 'ENERGYPRODUCTION' in s.bp.cats and s.bp.tech >= 2
            if s.upgrading is None and not big_pgen:
                continue
            is_mex = 'MASSEXTRACTION' in s.bp.cats
            want = self.fu['mexUpgrade']['assistEngineers'] if is_mex else self.fu['techT2']['assistEngineers']
            if big_pgen:
                want = 3
            have = sum(1 for x in self.builders if isinstance(x.job, tuple) and x.job[1] is s and x.name != 'Vogt')
            if b.name == 'Vogt':
                if is_mex or not self.fu['techT2'].get('acuAssist'):
                    continue
            elif have >= want:
                continue
            d = self.dist(b.pos, s.pos)
            if best is None or d < best[0]:
                best = (d, s)
        return best[1] if best else None

    # --- FactoryManager ----------------------------------------------------------------------
    def factory_next(self, f: Structure):
        while f.plan:
            st = f.plan.pop(0)
            if st['do'] == 'produce':
                n = st.get('count', 1)
                if n > 1:  # count = n Einzelaufträge in Folge (Review R-S1: vorher nur 1 Stück)
                    f.plan.insert(0, dict(st, count=n - 1))
                return self.R.resolve(st['role'], f.bp.tech if st['role'] == 'eng' else st.get('tech', 1))
            if st['do'] == 'loop':
                f.loop = st['items']
                break
        if f.bp.tech >= 2 and 'LAND' in f.bp.cats and self.eng_t2 < self.fu['techT2'].get('t2Engineers', 2):
            self.eng_t2 += 1
            return self.R.resolve('eng', f.bp.tech)
        if self.eng_count < self.eng_target() and 'LAND' in f.bp.cats:
            return self.R.resolve('eng', f.bp.tech)
        if f.loop:
            it = f.loop[f.loop_i % len(f.loop)]
            f.loop_i += 1
            for tech in range(f.bp.tech, 0, -1):
                try:
                    return self.R.resolve(it['role'], tech)
                except SystemExit:
                    continue
        return None

    # --- Tick --------------------------------------------------------------------------------
    def active_rates(self):
        """((Ziel, Blueprint), Fortschritt pro Sekunde bei Ratio 1)."""
        out = []
        for s in self.structs:
            if s.bp_now <= 0:
                continue
            if not s.done:
                out.append(((s, s.bp), s.bp_now / s.bp.bt))
            elif s.upgrading is not None:
                out.append(((s, s.upgrading), s.bp_now / s.upgrading.bt))
            elif s.prod is not None:
                out.append(((s, s.prod), s.bp_now / s.prod.bt))
        return out

    def dispatch(self, b: Builder):
        guard = 0
        while b.job is None and guard < 8:
            guard += 1
            if b.delay > 0:
                return
            if b.plan:
                st = b.plan.pop(0)
                if self.diff.get('stepDelayS'):
                    b.delay = self.diff['stepDelayS']
            else:
                st = self.policy_step(b)
                if st is None:
                    return
            if st['do'] == 'build':
                self.start_build(b, st)
            elif st['do'] == 'assist':
                self.assist(b, st['target'])

    def run(self, horizon=HORIZON_S):
        spawn_q = []
        next_sample = [180, 300, 480, 600, 720]
        while self.t < horizon - 1e-9:
            if abs(self.t - round(self.t)) < 1e-6:
                self.economy_manager()
                self.tech_manager()
                # waves.maxS erzwingt die erste Welle (Pflichtangriff, ai.md §5.5)
                if not self.waves and self.pool > 0 and self.t >= self.fu['waves']['maxS']:
                    self.launch_wave()
            for b in self.builders:
                if b.delay > 0:
                    b.delay = max(0.0, b.delay - DT)
                if isinstance(b.job, tuple) and self.t >= b.until:
                    b.job = None
                self.dispatch(b)
            for f in self.factories():
                if f.done and f.upgrading is None and f.prod is None:
                    f.prod = self.factory_next(f)
                    f.prod_progress = 0.0
            for s in self.structs:
                s.bp_now = s.bp.bp if (s.done and (s.prod is not None or s.upgrading is not None)) else 0.0
            for b in self.builders:
                b.alive_s += DT
                if b.job is None:
                    b.idle_s += DT
                    continue
                if b.walk > 0:
                    b.walk = max(0.0, b.walk - DT)
                    continue
                tgt = b.job[1] if isinstance(b.job, tuple) else b.job
                if tgt.done and tgt.upgrading is None and tgt.prod is None:
                    if isinstance(b.job, tuple):
                        # Fabrik wartet auf den nächsten Auftrag: Helfer bleibt am Guard, zählt aber als idle
                        # (Review R-G3: Guard ohne Arbeit darf das Idle-Gate nicht verdecken)
                        b.idle_s += DT
                        continue
                    b.job = None
                    continue
                tgt.bp_now += b.bp.bp
            # Flow-Eco (PLAN §3.4: ein Tier, ratio = min(Mass-Anteil, Energy-Anteil))
            rates = self.active_rates()
            dM = sum(k[1].mass * r for k, r in rates) * DT
            dE = sum(k[1].energy * r for k, r in rates) * DT
            m, e, up = self.income()
            rM = 1.0 if dM <= 0 else min(1.0, (self.M + m * DT) / dM)
            rE = 1.0 if dE <= 0 else min(1.0, (self.E + (e - up) * DT) / dE)
            ratio = max(0.0, min(rM, rE))
            self.last_mratio = rM
            bp_sum = sum(k[0].bp_now for k, _ in rates)
            self.stats['ticks'] += 1
            if dE > 0 and rE < 0.999:
                self.stats['stallE'] += 1
                self.stall_t.append(self.t)
            self.stats['bp_total'] += bp_sum * DT
            self.stats['stallM_bp'] += bp_sum * DT * ((1 - rM) if rM <= rE else 0.0)
            self.stats['incM'] += m * DT
            newM = self.M + m * DT - ratio * dM
            newE = self.E + (e - up) * DT - ratio * dE
            if newM > self.storM_cap:
                self.stats['overflowM'] += newM - self.storM_cap
            self.M = min(self.storM_cap, max(0.0, newM))
            self.E = min(self.storE_cap, max(0.0, newE))
            self.mstore_hist.append(self.M / self.storM_cap)
            self.flow_hist.append((m, ratio * dM / DT))
            if len(self.flow_hist) > 600:
                del self.flow_hist[:100]
            for (s, bpx), r in rates:
                inc = r * ratio * DT
                if not s.done and bpx is s.bp:
                    s.progress += inc
                    if s.progress >= 1 - 1e-9:
                        self.complete(s)
                elif bpx is s.upgrading:
                    s.up_progress += inc
                    if s.up_progress >= 1 - 1e-9:
                        self.complete_upgrade(s)
                elif bpx is s.prod:
                    s.prod_progress += inc
                    if s.prod_progress >= 1 - 1e-9:
                        spawn_q.append((self.t + self.assume['rollOffS'], s, s.prod))
                        if 'ENGINEER' in s.prod.cats:
                            self.eng_count += 1
                        s.prod = None
            for item in [q for q in spawn_q if q[0] <= self.t + 1e-9]:
                spawn_q.remove(item)
                self.spawn(item[1], item[2])
            self.t = round(self.t + DT, 6)
            if next_sample and self.t >= next_sample[0] - 1e-9:
                m, e, up = self.income()
                self.samples[next_sample[0]] = dict(
                    massInc=round(m, 1), energyInc=round(e - up, 1),
                    mex=sum(1 for s in self.structs if s.done and 'MASSEXTRACTION' in s.bp.cats),
                    eng=self.eng_count, army=len(self.army),
                    fac=sum(1 for f in self.factories() if f.done))
                next_sample.pop(0)
        return self

    def complete(self, s: Structure):
        s.done = True
        if 'ENERGYSTORAGE' in s.bp.cats:
            self.kranz_free = 4
        self.storM_cap += s.bp.storM
        self.storE_cap += s.bp.storE
        for b in self.builders:
            if b.job is s or (isinstance(b.job, tuple) and b.job[1] is s):
                b.job = None
        self.log('done', what=s.bp.name, at=s.slot)
        if s.fname:
            s.plan = [dict(x) for x in self.factory_plans.get(s.fname, [])]
            if not s.plan:  # zusätzliche Fabriken übernehmen die Schleife von fac1
                loop = next((x for x in self.factory_plans['fac1'] if x['do'] == 'loop'), None)
                s.plan = [dict(loop)] if loop else []

    def complete_upgrade(self, s: Structure):
        old = s.bp
        s.bp = s.upgrading
        s.upgrading = None
        s.up_progress = 0.0
        self.storM_cap += s.bp.storM - old.storM
        for b in self.builders:
            if isinstance(b.job, tuple) and b.job[1] is s:
                b.job = None
        self.log('upgrade_done', what=s.bp.name)
        if 'FACTORY' in s.bp.cats and self.tech_done is None:
            self.tech_done = self.t

    def spawn(self, f: Structure, bp: Bp):
        if 'ENGINEER' in bp.cats:
            k = self.eng_spawned
            self.eng_spawned += 1
            plan = self.expand(self.eng_plans[k]) if k < len(self.eng_plans) else []
            b = Builder(f'Eng{k + 1}', bp, f.pos, self.assume['buildRangeWu']['ENGINEER & TECH%d' % bp.tech], plan=plan)
            self.builders.append(b)
            self.log('eng', n=k + 1, tech=bp.tech)
            return
        self.army.append((self.t, bp))
        self.log('unit', what=bp.name)
        if 'AIR' in bp.cats or 'SCOUT' in bp.cats:
            return
        self.pool += 1
        if self.pool >= self.wave_size:
            self.launch_wave()

    def launch_wave(self):
        members = [u for _, u in self.army if 'AIR' not in u.cats and 'SCOUT' not in u.cats][-self.pool:]
        spd = min(u.speed for u in members) * self.assume['platoonSpeedFactor']
        arr = self.t + self.mi.d_rally_enemy / spd
        self.waves.append(dict(depart=round(self.t, 1), size=self.pool, arrive=round(arr, 1)))
        self.log('wave', size=self.pool, arrive=round(arr, 1))
        self.pool = 0
        self.wave_size += self.fu['waves']['grow']

    # --- Kennzahlen --------------------------------------------------------------------------
    def nth(self, pred, n=1):
        k = 0
        for t, what, kw in self.events:
            if pred(what, kw):
                k += 1
                if k == n:
                    return t
        return None

    def summary(self):
        st = self.stats
        by_name = {b.name: b for b in self.roster.values()}
        mex = lambda w, k: w == 'done' and 'MASSEXTRACTION' in by_name[k['what']].cats
        combat = lambda w, k: w == 'unit' and not ({'SCOUT', 'ENGINEER', 'AIR'} & by_name[k['what']].cats)
        eng_idle = [b.idle_s / b.alive_s for b in self.builders if b.name != 'Vogt' and b.alive_s > 0]
        return {
            'fac1': self.nth(lambda w, k: w == 'done' and 'FACTORY' in by_name[k['what']].cats),
            'eng1': self.nth(lambda w, k: w == 'eng', 1),
            'eng4': self.nth(lambda w, k: w == 'eng', 4),
            'mex4': self.nth(mex, 4),
            'mex8': self.nth(mex, 8),
            'mex12': self.nth(mex, 12),
            'firstCombat': self.nth(combat),
            'airFac': self.nth(lambda w, k: w == 'done' and {'FACTORY', 'AIR'} <= by_name[k['what']].cats),
            'firstBomber': self.nth(lambda w, k: w == 'unit' and 'BOMBER' in by_name[k['what']].cats),
            'wave1Depart': self.waves[0]['depart'] if self.waves else None,
            'wave1Arrive': self.waves[0]['arrive'] if self.waves else None,
            'techStart': round(self.tech_started, 1) if self.tech_started is not None else None,
            'techT2': round(self.tech_done, 1) if self.tech_done is not None else None,
            'massInc': {str(k): v['massInc'] for k, v in self.samples.items()},
            'energyInc': {str(k): v['energyInc'] for k, v in self.samples.items()},
            'mexAt': {str(k): v['mex'] for k, v in self.samples.items()},
            'facAt': {str(k): v['fac'] for k, v in self.samples.items()},
            'engAt': {str(k): v['eng'] for k, v in self.samples.items()},
            'stallE': round(100 * st['stallE'] / max(1, st['ticks']), 1),
            'stallMbp': round(100 * st['stallM_bp'] / max(1e-9, st['bp_total']), 1),
            'overflowM': round(100 * st['overflowM'] / max(1e-9, st['incM']), 1),
            'engIdle': round(100 * (sum(eng_idle) / len(eng_idle)), 1) if eng_idle else None,
        }

# ----------------------------------------------------------------------------------------------
def fmt_t(s):
    if s is None:
        return '–'
    s = int(round(s))
    return f'{s // 60}:{s % 60:02d}'


def run_all(cfg, roster, maps, difficulty):
    res = {}
    for op in cfg['openings']:
        for mname, mi in maps.items():
            if op['weights']['maps'].get(mi.klass, 0) <= 0:
                continue
            sim = Sim(op, mi, cfg, roster, difficulty).run()
            res[(op['id'], mname)] = (sim, sim.summary())
    return res


def expect_block(s):
    keep = ['fac1', 'eng1', 'eng4', 'mex4', 'mex8', 'firstCombat', 'airFac', 'firstBomber', 'wave1Depart',
            'wave1Arrive', 'techStart', 'techT2', 'stallE', 'engIdle']
    out = {k: s[k] for k in keep if s.get(k) is not None}
    out['massInc'] = {k: s['massInc'][k] for k in ('180', '300', '480', '720') if k in s['massInc']}
    out['mexAt'] = {k: s['mexAt'][k] for k in ('180', '300', '480', '720') if k in s['mexAt']}
    return out


def check(cfg, res):
    bad = []
    for op in cfg['openings']:
        for mname, exp in (op.get('expect') or {}).items():
            if (op['id'], mname) not in res:
                bad.append(f'{op["id"]}/{mname}: nicht simuliert')
                continue
            got = expect_block(res[(op['id'], mname)][1])
            for k, v in exp.items():
                g = got.get(k)
                if isinstance(v, dict):
                    for kk, vv in v.items():
                        gg = (g or {}).get(kk)
                        tol = TOL['income'] if k == 'massInc' else TOL['count']
                        if gg is None or abs(gg - vv) > tol:
                            bad.append(f'{op["id"]}/{mname}.{k}.{kk}: erwartet {vv}, simuliert {gg}')
                elif g is None or abs(g - v) > (TOL['t'] if k not in ('stallE', 'engIdle') else 1.0):
                    bad.append(f'{op["id"]}/{mname}.{k}: erwartet {v}, simuliert {g}')
            # harte Gates (PLAN MS9, nur Normal)
            s = res[(op['id'], mname)][1]
            if op['followUp']['waves']['maxS'] > 450:
                bad.append(f'{op["id"]}: waves.maxS > 450 s lässt keine Reserve für das 8-min-Gate (ai.md §5.5)')
            if s['techT2'] is None or s['techT2'] > 720:
                bad.append(f'{op["id"]}/{mname}: T2 nicht <= 12:00 (MS9-Gate)')
            if s['wave1Depart'] is None or s['wave1Depart'] > 480:
                bad.append(f'{op["id"]}/{mname}: erste Welle nicht <= 8:00 (MS9-Gate)')
            if s['stallE'] > 5.0:
                bad.append(f'{op["id"]}/{mname}: Energie-Stall {s["stallE"]} % > 5 % (MS10-Gate)')
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeline')
    ap.add_argument('--map', default='setons')
    ap.add_argument('--maps', action='store_true')
    ap.add_argument('--write-expect', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--difficulty', default='normal', choices=['easy', 'normal', 'hard'])
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--threat', action='store_true', help='Threat-Werte je Blueprint (ai.md §5.6)')
    a = ap.parse_args()
    cfg = json.loads(OPENINGS.read_text())
    roster = load_roster()
    maps = {m: analyze_map(m, cfg['assumptions']) for m in MAPS}

    if a.threat:
        print('| Blueprint | Name | Mass | HP | DPS Boden | DPS Luft | Threat Boden | Threat Luft | je 100 Mass |')
        print('|---|---|---|---|---|---|---|---|---|')
        for b in sorted(roster.values(), key=lambda b: (b.tech, b.id)):
            if not (b.dps_surface or b.dps_air):
                continue
            ts = math.sqrt(b.dps_surface * b.hp)
            ta = math.sqrt(b.dps_air * b.hp)
            per = 100 * max(ts, ta) / b.mass if b.mass and 'COMMAND' not in b.cats else float('nan')
            print(f'| `{b.id[5:]}` | {b.name} | {b.mass:.0f} | {b.hp:.0f} | {b.dps_surface:.1f} | {b.dps_air:.1f} | '
                  f'{ts:.0f} | {ta:.0f} | {per:.1f} |')
        return

    if a.maps:
        for mi in maps.values():
            own = [s for s in mi.spots if s.zone == 'own']
            print(f'## {mi.name} ({mi.size} WU) Start {mi.start} -> Gegner {mi.enemy}, Umweg-Faktor {mi.detour:.2f}, '
                  f'Rally->Gegner {mi.d_rally_enemy:.0f} WU')
            for z in ('own', 'contested', 'enemy', 'unreachable'):
                ms = [s for s in mi.spots if s.zone == z and s.kind == 'mass']
                hs = [s for s in mi.spots if s.zone == z and s.kind == 'hydro']
                print(f'  {z}: {len(ms)} Mass, {len(hs)} Hydro')
            print('  eigene Spots nach Pfad-Distanz:')
            for s in sorted(own, key=lambda s: s.d_own):
                print(f'    {s.kind:5s} ({s.x:4.0f},{s.z:4.0f}) d={s.d_own:5.0f} dGegner={s.d_enemy:5.0f}')
            for s in mi.spots:
                if s.zone == 'contested':
                    print(f'    umkämpft {s.kind} ({s.x},{s.z}) d={s.d_own:.0f}/{s.d_enemy:.0f}')
        return

    if a.timeline:
        op = next(o for o in cfg['openings'] if o['id'] == a.timeline)
        sim = Sim(op, maps[a.map], cfg, roster, a.difficulty).run()
        for t, what, kw in sim.events:
            print(f'{fmt_t(t):>6}  {what:18s} {kw}')
        win = []
        for t in sim.stall_t:
            if win and t - win[-1][1] <= 1.0:
                win[-1][1] = t
            else:
                win.append([t, t])
        print('Energie-Stall-Fenster:', ', '.join(f'{fmt_t(a)}–{fmt_t(b)}' for a, b in win) or 'keine')
        print(json.dumps(sim.summary(), ensure_ascii=False, indent=1))
        return

    res = run_all(cfg, roster, maps, a.difficulty)
    if a.write_expect:
        if a.difficulty != 'normal':
            raise SystemExit('--write-expect nur mit --difficulty normal')
        for op in cfg['openings']:
            op['expect'] = {m: expect_block(s) for (oid, m), (_, s) in res.items() if oid == op['id']}
        OPENINGS.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n')
        print('expect geschrieben')
    if a.check:
        bad = check(cfg, res)
        for b in bad:
            print('FEHLER', b)
        print('check:', 'OK' if not bad else f'{len(bad)} Verstöße')
        sys.exit(1 if bad else 0)
    if a.json:
        print(json.dumps({f'{k[0]}/{k[1]}': v[1] for k, v in res.items()}, ensure_ascii=False, indent=1))
        return
    hdr = ('Eröffnung', 'Karte', 'Fabrik', 'Eng1', 'Eng4', 'Mex4', 'Mex8', '1. Kampf', 'Welle1 ab/an',
           'T2 Start/fertig', 'M/s 3/5/8/12', 'Mex 5/12', 'E-Stall', 'M-BP-Stall', 'Overfl.', 'Eng idle')
    print('| ' + ' | '.join(hdr) + ' |')
    print('|' + '---|' * len(hdr))
    for (oid, m), (sim, s) in res.items():
        mi = s['massInc']
        print('| ' + ' | '.join([
            oid, m, fmt_t(s['fac1']), fmt_t(s['eng1']), fmt_t(s['eng4']), fmt_t(s['mex4']), fmt_t(s['mex8']),
            fmt_t(s['firstCombat']), f"{fmt_t(s['wave1Depart'])} / {fmt_t(s['wave1Arrive'])}",
            f"{fmt_t(s['techStart'])} / {fmt_t(s['techT2'])}",
            '/'.join(str(mi.get(k, '–')) for k in ('180', '300', '480', '720')),
            f"{s['mexAt'].get('300', '–')}/{s['mexAt'].get('720', '–')}",
            f"{s['stallE']} %", f"{s['stallMbp']} %", f"{s['overflowM']} %", f"{s['engIdle']} %"]) + ' |')


if __name__ == '__main__':
    main()
