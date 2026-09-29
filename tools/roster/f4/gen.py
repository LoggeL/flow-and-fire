# Generator für docs/design/factions/f4/roster.json (Flow & Fire, Fraktion f4 „Aurith-Chor“).
# Vorlage: tools/roster/gen.py (Varkan, Schema faf-roster/1). FA-Referenz = Vorbild-Fraktion (XS*/DSLK004)
# aus fa_ref.json (FAForever/spooky-db app/data/index.json, v3810; DPS nach app/js/dps.js), extrahiert mit ref.py.
# Aufruf: python3 gen.py  (Pfade relativ zum Skript, keine Abhängigkeiten außer der Standardbibliothek)
import json, math, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / 'docs/design/factions/f4/roster.json'
FA = json.load(open(HERE / 'fa_ref.json'))
NS = 'f4'

# Tris LOD0 je Part (faction.md §3.3)
TRIS = dict(keel=48, lens=36, legs=60, fork=40, horn=32, pipe=20, spindle=24, crystal=24, sickle=36,
            ring=48, fin=16, mast=24, shell=36)


def P(spec):
    """'fork*yaw' -> Part mit Animation; 'fin:team' -> Material; 'lens@dreipass' -> Rollen-Notiz."""
    out = []
    for s in spec.split():
        anim = mat = note = None
        if '@' in s: s, note = s.split('@')
        if '*' in s: s, anim = s.split('*')
        if ':' in s: s, mat = s.split(':')
        assert s in TRIS, s
        out.append({k: v for k, v in dict(part=s, mat=mat, anim=anim, note=note).items() if v})
    return out


def W(ref, typ, dmg, reload, rng, proj, salvo=1, minr=None, splash=0, mv=None, layers=('land',), extra=None):
    dps = dmg * salvo / reload
    w = dict(ref=f'{NS}:{ref}', type=typ, damage=dmg, salvo=salvo, reloadS=reload, dps=round(dps, 2),
             rangeMin=minr, range=rng, projectile=proj, muzzleVelocity=mv, splash=splash, layers=list(layers))
    if extra: w['notes'] = extra
    return {k: v for k, v in w.items() if v is not None}


def PM(*items):
    """Post-MVP-Markierungen: (Feature-ID, Vorbild-Verhalten, MVP-Verhalten ohne Feature)."""
    return [dict(feature=f, behavior=b, mvp=m) for f, b, m in items]


R = []
def U(**k):
    k['id'] = f"{NS}:{k['id']}"
    for key in ('upgradesTo', 'upgradeFrom'):
        if k.get(key): k[key] = f'{NS}:{k[key]}'
    R.append(k)


LAND_T1 = 'FACTORY & LAND & (TECH1 | TECH2 | TECH3)'
LAND_T2 = 'FACTORY & LAND & (TECH2 | TECH3)'
LAND_T3 = 'FACTORY & LAND & TECH3'
AIR_T1 = 'FACTORY & AIR & (TECH1 | TECH2)'
AIR_T2 = 'FACTORY & AIR & TECH2'
ENG_T1 = '(ENGINEER & (TECH1 | TECH2 | TECH3)) | COMMAND'
ENG_T2 = 'ENGINEER & (TECH2 | TECH3)'
ENG_T3 = 'ENGINEER & TECH3'
GH, HH, BAU = 'Grundhalle', 'Himmelshalle', 'Bau'
AMPHIB = ('M13', 'amphibisch: fährt unter Wasser (Vorbild-Engineers)', 'nur Land, wie Varkan-Engineers')
CHARGE = 'Glyphen sammeln sich 1,5 s vor dem Schuss an der Mündung (nur View, §3.5): der schwere Schuss ist vorher sichtbar.'

# ---------------------------------------------------------------- Kantor & Engineers
U(id='cmd_commander', de='Kantor', en='Cantor', roleDe='Kommandant', roleEn='Commander', tech=0, group='cmd',
  visual='v_cmd', ms='MS4', msNote='MS4 Bauen ohne Waffe; MS5 Waffe + Zerspringen; MS6 Aufschrei (U8)', ms9=True,
  faRef='XSL0001', faDpsIdx=[0], faRole='Armored Command Unit (ACU), nur Hauptwaffe',
  cats=['LAND', 'MOBILE', 'COMMAND', 'ENGINEER', 'DIRECTFIRE', 'RECLAIM', 'REPAIR', 'UNIQUE'],
  buildableBy=None, mass=2000, energy=5000000, bt=6000000, bp=10, hp=11500, regen=10,
  eco=dict(massPerSec=1, energyPerSec=20, storageMass=650, storageEnergy=3900),
  weapons=[W('wpn_cantor_fork', 'Gabelton (Brustgabel)', 100, 1.0, 22, 'linear', minr=1, mv=35),
           W('wpn_cantor_outcry', 'Aufschrei (Overcharge, manuell/auto)', 15000, 3.3, 22, 'linear', splash=2.5, mv=25,
             extra='Formel identisch zum Vogt (FAF OverchargeProjectile/OverchargeShared, siehe core:wpn_reeve_tapshot): Schaden = clamp(max. HP der '
                   'mobilen Nicht-Kommandanten im Umkreis 2,7 WU [ohne Ziel 1250], 1250, min(15000, 0,9 x Vorrat / 6)); Drain = 6 x Schaden; '
                   'gegen Strukturen fix 800, gegen Kommandanten fix 400; feuert erst ab 7500 E Vorrat (braucht Lichtkammer). Nicht in DPS/Mass gewertet.')],
  compareDpsIdx=[0],
  speed=1.7, turn=90, accel=2.0, sizeClass=2, footprint=[2, 2], vision=26,
  toggles=['auto_outcry (MS10, C17)'],
  death=dict(ref=f'{NS}:wpn_cantor_shatter', inner=dict(damage=2000, radius=30), outer=dict(damage=500, radius=40),
             note='Zerspringen, Phasenwelle, Kamera-Shake X4, FA-Relation 1:1 (FAF develop bestätigt 2000/30 + 500/40)'),
  special='Einzigartig, Tod = Niederlage (U1/A4). Baut alle T1-Strukturen. Regeneration 10 HP/s. HP 11.500 = FA-Vorbild (−4 % zum Vogt). Wrack offen (faction.md §11.2 Nr. 11).',
  postMvp=PM(('U14', 'Upgrades: Regenerations-Aura, Schadensstabilisierung, Feuerrate, Teleport', 'Grundregeneration 10 HP/s wie Vogt'),
             ('K16', 'Taktische Rakete als Upgrade', 'entfällt'),
             ('P19', 'Aufklang: Bernsteinsäule steigt auf und zerspringt', '3-s-View-Platzhalter, spielbar ab Tick 0')),
  hotbuild=None, icon='cmd_commander',
  parts=P('legs keel:amber*yaw@spindel_torso fin:team@hinterkamm crystal:glow@krone sickle:pearl@bau_halbkreis fork*pitch@brustgabel lens:team@brustschale'),
  kitbash='Dreibein mit rückwärts geknickten Gelenken (legs count 3), hoher Spindel-Torso, Krone aus drei Kristallen als stärkster Leuchtpunkt, '
          'Perlglas-Sichel als Halbkreis hinter der Krone, breite Gabel mittig vor der Brust; keine Arme, kein Kopf. Höhe ≥ 2,8 WU.')

U(id='lnd_t1_engineer', de='Chorist', en='Chorister', roleDe='Ingenieur', roleEn='Engineer', tech=1, group='cmd',
  visual='v_eng', ms='MS6', msNote='U2 (T1) in MS6', ms9=True, faRef='XSL0105', faRole='T1 Engineer',
  cats=['LAND', 'MOBILE', 'ENGINEER', 'TECH1', 'RECLAIM', 'REPAIR'], buildableBy=LAND_T1,
  mass=52, energy=260, bt=260, bp=5, hp=128, speed=1.9, turn=180, accel=3.0, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[], special='Baut T1-Strukturen, Assist, Reclaim, Repair. Fragil (A9): HP/Mass −20 % zum Varkan-Lehrling, FA-Vorbild-Relation. '
                      'HP 128 hält die Breakpoints 2 Kantor-, 3 Horn-, 4 Triller- und 32 Pfiff-Treffer.',
  postMvp=PM(AMPHIB), hotbuild=(GH, 'E'), icon='eng_build_t1',
  parts=P('keel:pearl@perlglas_ruecken lens@schwebespalt fin:team@kamm_seitenband sickle:pearl*yaw crystal:glow*pitch@emitter'),
  kitbash='Kurzer breiter Kiel mit Perlglas-Rücken, eine Perlglas-Sichel diagonal vom linken Heck nach vorn rechts, Kristall an der Sichelspitze; '
          'teamfarbenes Kiel-Seitenband und kleiner Kamm; 1 Tonpunkt Pechglas.')

U(id='lnd_t2_engineer', de='Solist', en='Soloist', roleDe='Ingenieur', roleEn='Engineer', tech=2, group='cmd',
  visual='v_eng', ms='MS8', msNote='U2 T2 als Daten in MS8', ms9=True, faRef='XSL0208', faRole='T2 Engineer',
  cats=['LAND', 'MOBILE', 'ENGINEER', 'TECH2', 'RECLAIM', 'REPAIR'], buildableBy=LAND_T2,
  mass=130, energy=650, bt=650, bp=13, hp=360, speed=1.9, turn=160, accel=2.8, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[], special='Baut T1+T2-Strukturen (Stimmstock II direkt, Resonator II, Gabel II, Pfeifenwerk II, Dämpfer II, Fanfare).',
  postMvp=PM(AMPHIB), hotbuild=(GH, 'E'), icon='eng_build_t2',
  parts=P('keel:pearl@perlglas_ruecken lens@schwebespalt fin:team@kamm_seitenband sickle:pearl*yaw sickle:pearl@zweite_sichel crystal:glow*pitch@emitter'),
  kitbash='Chorist ×1,3 mit zwei verschieden großen Sicheln (Anzahl = Tech), 2 Tonpunkte Pechglas.')

U(id='lnd_t3_engineer', de='Vorsänger', en='Precentor', roleDe='Ingenieur', roleEn='Engineer', tech=3, group='cmd',
  visual='v_eng', ms='MS13', msNote='Rest U2 (T3-Engineer) in MS13', ms9=False, faRef='XSL0309', faRole='T3 Engineer',
  cats=['LAND', 'MOBILE', 'ENGINEER', 'TECH3', 'RECLAIM', 'REPAIR'], buildableBy=LAND_T3,
  mass=310, energy=1550, bt=1550, bp=32, hp=700, speed=1.9, turn=140, accel=2.6, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[], special='Baut T1–T3-Strukturen (Hochorgel, Großhorn, Resonator III, Stimmstock III).',
  postMvp=PM(AMPHIB), hotbuild=(GH, 'E'), icon='eng_build_t3',
  parts=P('keel:pearl@perlglas_ruecken lens@schwebespalt fin:team@kamm_seitenband sickle:pearl*yaw sickle:pearl@zweite_sichel sickle:pearl@dritte_sichel crystal:glow@emitter'),
  kitbash='Maßstab 1,4 (Deckel 1×1), drei Sicheln (Anzahl = Tech), 3 Tonpunkte Pechglas; zweite und dritte Sichel statisch (Anim-Limit 2).')

# ---------------------------------------------------------------- Land T1
U(id='lnd_t1_scout', de='Pfiff', en='Whistle', roleDe='Kampfspäher', roleEn='Combat Scout', tech=1, group='land',
  visual='v_scout', ms='MS6', msNote='erste Fabrik-Einheit im Opening (MS6, übernimmt die LAB-Rolle); U4 abgenommen MS7; Radar-Feld ab MS10 (I3)',
  ms9=True, faRef='XSL0101', faRole='T1 Combat Scout (deckt Scout + LAB)',
  cats=['LAND', 'MOBILE', 'SCOUT', 'INTELLIGENCE', 'DIRECTFIRE', 'TECH1'], buildableBy=LAND_T1,
  mass=20, energy=80, bt=90, hp=36, speed=3.8, turn=80, accel=4.0, sizeClass=1, footprint=[1, 1], vision=24, radar=40,
  weapons=[W('wpn_whistle_fork_t1', 'Kurzgabel (Schnellfeuer)', 4, 0.3, 18, 'linear', mv=25)],
  special='Hybrid (A1): Späher und Raider in einem Blueprint, ersetzt Späher + leichten Sturmläufer. Hotbuild A und S (beide T1-Rollen). '
          'Icon land_bot_t1 (Gefahr vor Funktion, faction.md §6.2).',
  postMvp=PM(('I5', 'Tarnung im Stand (unsichtbar für Radar und Sicht), Unterhalt 1 E/s', 'kein Tarnen, kein Unterhalt')),
  hotbuild=(GH, 'A'), icon='land_bot_t1',
  parts=P('keel:amber lens@schwebespalt fin:team@kamm mast@horchmast fork*yaw@kurze_gabel'),
  kitbash='Kleinster Kiel, hoher dünner Mast ≥ 1,0 × Kiellänge, kurze waagerechte Gabel (Primär Direktfeuer ≥ 1,5 × Mast-Ø); Kamm niedriger als der Mast, kein Reif.')

U(id='lnd_t1_tank', de='Triller', en='Trill', roleDe='Kampfgleiter', roleEn='Battle Glider', tech=1, group='land',
  visual='v_tank', ms='MS5', msNote='erste Kampfeinheit (Konsole, MS5), Fabrik ab MS6', ms9=True,
  faRef='XSL0201', faRole='T1 Medium Tank',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'TANK', 'TECH1'], buildableBy=LAND_T1,
  mass=54, energy=270, bt=290, hp=285, speed=3.5, turn=90, accel=2.6, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[W('wpn_fork_t1', 'Gabelton', 33, 1.3, 18, 'linear', mv=25)],
  special='Linienhalter nach Vorbild-Relation. HP 285 hält die Breakpoints: 3 Kantor-, 6 Gabel-I-, 7 Horn-, 2 Heuler-, 9 Triller-Treffer.',
  hotbuild=(GH, 'Q'), icon='land_direct_t1',
  parts=P('keel:amber lens@schwebespalt fork*yaw fin:team@kamm fin:team@glyphenfeld'),
  kitbash='Schlanker Kiel 0,9 × 0,5 × 1,4 WU, 0,25 WU über dem Boden; waagerechte Gabel (Zinken Ø 0,17, Länge 0,9 WU ≈ 65 % der Kiellänge) über die Kielspitze; Kamm 0,8 WU hoch, 1 Tonpunkt.')

U(id='lnd_t1_arty', de='Horn', en='Horn', roleDe='Mobile Artillerie', roleEn='Mobile Artillery', tech=1, group='land',
  visual='v_arty', ms='MS7', msNote='K2 Ballistik in MS7', ms9=True, faRef='XSL0103', faRole='T1 Mobile Light Artillery',
  cats=['LAND', 'MOBILE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH1'], buildableBy=LAND_T1,
  mass=54, energy=180, bt=290, hp=180, speed=2.7, turn=90, accel=2.2, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[W('wpn_horn_t1', 'Streuklang', 44, 2.8, 30, 'ballistisch', minr=8, splash=1.6, mv=14)],
  special='A2: wenig Schaden pro Treffer, großer Splash, teuer und fragil. Räumt Engineers (3 Treffer) und Pulks, bricht keine Linie (Triller 7 Treffer). '
          'Einschläge hinterlassen ≈ 3 s einen blauen Klangring (nur View).',
  hotbuild=(GH, 'W'), icon='land_arty_t1',
  parts=P('keel:amber lens@schwebespalt ring*yaw@schwenkfuss horn:team*pitch fin:team@kamm_gegengewicht'),
  kitbash='Kiel mit großem offenem Trichter (Öffnung Ø 0,6 WU, 50° geneigt) auf Schwenkfuß, Kamm als Gegengewicht weit nach hinten; keine Gabel.')

U(id='lnd_t1_aa', de='Pfeife', en='Pipe', roleDe='Mobile Flugabwehr', roleEn='Mobile AA', tech=1, group='land',
  visual='v_aa', ms='MS7', msNote='U4 in MS7, Wirkung gegen Luft MS12', ms9=True, faRef='XSL0104', faRole='T1 Mobile Anti-Air Gun',
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'TECH1'], buildableBy=LAND_T1,
  mass=55, energy=275, bt=220, hp=315, speed=3.4, turn=90, accel=2.5, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[W('wpn_pipe_aa_t1', 'Orgel-Staccato (2 Pfeifen)', 7, 0.5, 32, 'linear (Vorhalt)', salvo=2, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=(GH, 'R'), icon='land_aa_t1',
  parts=P('keel:amber lens@schwebespalt fin:team*yaw@pfeifenplatte pipe@senkrecht_lang pipe@senkrecht_kurz fin:team@kamm'),
  kitbash='Kiel mit teamfarbener Kamm-Platte, darauf 2 senkrechte Pfeifen (≥ 75°) mit gestufter Länge quer zur Fahrtrichtung.')

# ---------------------------------------------------------------- Land T2
U(id='lnd_t2_tank', de='Heuler', en='Howler', roleDe='Stoßgleiter', roleEn='Strike Glider', tech=2, group='land',
  visual='v_tank', ms='MS8', msNote='U6 in MS8', ms9=True, faRef='XSL0203', faRole='T2 Hover Tank',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'TANK', 'TECH2'], buildableBy=LAND_T2,
  mass=220, energy=1300, bt=1050, hp=1400, speed=4.0, turn=90, accel=2.8, sizeClass=2, footprint=[1, 1], vision=20,
  weapons=[W('wpn_fork_t2_charged', 'Stoßton (schwerer Einzelschuss)', 210, 3.5, 20, 'linear', mv=30, extra=CHARGE)],
  special='A3: schnell, ein schwerer Schuss (Alpha): Triller in 2, Chorist und Pfiff in 1 Schuss. Schwach gegen Masse (Overkill).',
  postMvp=PM(('M13', 'echtes Schweben über Wasser (Hover)', 'normale LAND-Einheit; Gleiter-Look ist reine Optik')),
  hotbuild=(GH, 'Q'), icon='land_direct_t2',
  parts=P('keel:amber lens@schwebespalt fork*yaw lens@ladekammer fin:team@kamm fin:team@glyphenfeld'),
  kitbash='Triller ×1,3, längere Gabelzinken mit Linse (Ladekammer) dazwischen, Kamm +30 %, 2 Tonpunkte.')

U(id='lnd_t2_bot', de='Brüller', en='Roarer', roleDe='Sturmläufer', roleEn='Assault Walker', tech=2, group='land',
  visual='v_bot', ms='MS8', msNote='U6 in MS8 (Linienanker der Fraktion, ● statt Nachzügler)', ms9=True,
  faRef='XSL0202', faRole='T2 Assault Bot',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'BOT', 'TECH2'], buildableBy=LAND_T2,
  mass=360, energy=1800, bt=1600, hp=2550, speed=2.6, turn=90, accel=2.2, sizeClass=2, footprint=[1, 1], vision=24,
  weapons=[W('wpn_fork_t2_rapid', 'Breitgabel (Dauerfeuer)', 37, 0.3, 26, 'linear', mv=30)],
  special='A3: schwerer, langsamer Linienanker (Mass 360, HP 2.550: der zäheste T2-Körper beider Fraktionen). RW 26 = Gabel I, hält Stellungen auf Augenhöhe.',
  hotbuild=(GH, 'S'), icon='land_bot_t2',
  parts=P('legs keel:amber*yaw@torso fork*pitch@breite_gabel fin:team@kamm fin:team@glyphenfeld'),
  kitbash='Dreibein mit Kiel-Torso, breite Gabel (Zinkenabstand ≥ 0,5 × Rumpfbreite), Kamm nach hinten ≥ 1,0 × Rumpflänge, 2 Tonpunkte; kein Trichter, keine Pfeifen.')

U(id='lnd_t2_mml', de='Posaune', en='Trombone', roleDe='Raketenwerfer', roleEn='Missile Launcher', tech=2, group='land',
  visual='v_mml', ms='MS8', msNote='U6 inkl. MML über K11 in MS8', ms9=True, faRef='XSL0111', faRole='T2 Mobile Missile Launcher',
  cats=['LAND', 'MOBILE', 'INDIRECTFIRE', 'ARTILLERY', 'SILO', 'TECH2'], buildableBy=LAND_T2,
  mass=180, energy=1300, bt=800, hp=820, speed=2.9, turn=90, accel=2.2, sizeClass=2, footprint=[1, 1], vision=18,
  weapons=[W('wpn_spindle_t2', 'Stoßton-Rakete (Einzelgeschoss)', 400, 6.0, 64, 'homing (Wenderate, K11)', minr=10, splash=0.5, mv=4, extra=CHARGE)],
  special='A4: eine schwere Lenkrakete statt 2er-Salve, RW 64 (Varkan-Rinne 60). Gabel II fällt nach 6 Raketen wie im Vorbild.',
  hotbuild=(GH, 'W'), icon='land_mml_t2',
  parts=P('keel:amber lens@schwebespalt ring*yaw@schwenkfuss spindle*pitch fin:team@kamm fin:team@glyphenfeld'),
  kitbash='Kiel mit einer dicken Spindel (Ø ≥ 2 × Pfeifen-Ø), 50° geneigt, auf Schwenkfuß; ≥ 25° flacher als die Pfeifen, kein Trichter.')

U(id='lnd_t2_aa', de='Bordun', en='Bourdon', roleDe='Flak', roleEn='Flak', tech=2, group='land',
  visual='v_aa', ms='MS8', msNote='U6 in MS8, Wirkung/Näherungszünder MS12', ms9=True, faRef='XSL0205', faRole='T2 Mobile AA Flak Artillery',
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'TECH2'], buildableBy=LAND_T2,
  mass=160, energy=800, bt=800, hp=1050, speed=2.7, turn=120, accel=2.4, sizeClass=2, footprint=[1, 1], vision=20,
  weapons=[W('wpn_pipe_flak_t2', 'Bordunflak', 70, 0.5, 40, 'linear + Näherungszünder (MS12)', splash=4, mv=20, layers=('air',))],
  special='Nur Luftziele, Splash trifft Pulks.', hotbuild=(GH, 'R'), icon='land_aa_t2',
  parts=P('keel:amber lens@schwebespalt fin:team*yaw@pfeifenplatte pipe pipe pipe fin:team@kamm'),
  kitbash='Pfeife ×1,3 mit 3 gestuften senkrechten Pfeifen, 2 Tonpunkte.')

# ---------------------------------------------------------------- Land T3
U(id='lnd_t3_tank', de='Grollen', en='Rumble', roleDe='Belagerungsgleiter', roleEn='Siege Glider', tech=3, group='land',
  visual='v_tank', ms='MS13', msNote='U10 T3-Landarmee in MS13', ms9=False, faRef='XSL0303', faDpsIdx=[0, 1],
  faRole='T3 Siege Tank (Referenz-DPS ohne Torpedo)',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'INDIRECTFIRE', 'TANK', 'TECH3'], buildableBy=LAND_T3,
  mass=840, energy=9500, bt=3600, hp=4800, speed=2.8, turn=90, accel=2.2, sizeClass=2, footprint=[2, 2], vision=22,
  weapons=[W('wpn_fork_t3', 'Gabelton, schwer (beide Zinken)', 66, 0.5, 22, 'linear', salvo=2, mv=30),
           W('wpn_horn_t3_small', 'Kleiner Trichter (Stoßklang)', 600, 4.0, 28, 'ballistisch (flach)', splash=1.2, mv=40, extra=CHARGE)],
  compareDpsIdx=[0, 1],
  special='Hybrid A6: Direkt- und Indirektwaffe in einem Blueprint (ersetzt T3-Bot plus Begleit-Artillerie, spart Unit-Cap U7). Beide Waffen im DPS-Vergleich. '
          'Die Referenz hat zwei gleiche Direktwaffen (spooky-db `WeaponNumber` 2, Review R1); die Gabel feuert deshalb beide Zinken (Salve 2). '
          'Stärkster T3-Landkörper pro Mass, dafür langsam (2,8) und kurz (RW 22/28): Konter sind Heerhorn/Präzisionsläufer auf Abstand und Bomber.',
  postMvp=PM(('M13', 'amphibisch (fährt unter Wasser)', 'nur Land'),
             ('U18', 'Torpedowerfer als Drittwaffe', 'entfällt; DPS/Mass auch in der FA-Referenz ohne Torpedo gemessen')),
  hotbuild=(GH, 'Q'), icon='land_direct_t3',
  parts=P('keel:amber lens@schwebespalt fork*yaw horn:team*pitch@kleiner_trichter fin:team@kamm fin:team@doppelkamm'),
  kitbash='Überlanger Kiel, Gabel mit aufgesetztem kleinem Trichter (Primär Gabel ≥ 1,5 × Trichterlänge), Doppelkamm, 3 Tonpunkte; kein Kristall.')

U(id='lnd_t3_arty', de='Heerhorn', en='Warhorn', roleDe='Schwere Artillerie', roleEn='Heavy Artillery', tech=3, group='land',
  visual='v_arty', ms='MS13', msNote='U10 in MS13', ms9=False, faRef='XSL0304', faRole='T3 Mobile Heavy Artillery',
  cats=['LAND', 'MOBILE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH3'], buildableBy=LAND_T3,
  mass=800, energy=8000, bt=4300, hp=950, speed=2.2, turn=75, accel=1.8, sizeClass=2, footprint=[2, 2], vision=26,
  weapons=[W('wpn_horn_t3', 'Heerstoß', 720, 10.0, 88, 'ballistisch', minr=25, splash=4.8, mv=24, extra=CHARGE)],
  special='Kein Deploy.', hotbuild=(GH, 'W'), icon='land_arty_t3',
  parts=P('keel:amber lens@schwebespalt ring*yaw@schwenkfuss horn:team*pitch fin:team@kamm_gegengewicht fin:team@doppelkamm'),
  kitbash='Horn ×1,7 auf überlangem Kiel, Doppelkamm, 3 Tonpunkte; kein Kristall.')

U(id='lnd_t3_sniper', de='Diskant', en='Descant', roleDe='Präzisionsläufer', roleEn='Sniper Walker', tech=3, group='land',
  visual='v_sniper', ms='MS13', msNote='U10 in MS13; Modus-Toggle mit C17', ms9=False, faRef='XSL0305', faDpsIdx=[1],
  faRole='T3 Sniper Bot (Referenz-DPS = schneller Modus; Modi schließen sich aus)',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'SNIPER', 'BOT', 'TECH3'], buildableBy=LAND_T3,
  mass=780, energy=26000, bt=5400, hp=720, speed=2.2, turn=90, accel=2.2, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[W('wpn_descant_fast_t3', 'Diskantgabel (schneller Modus)', 600, 4.0, 55, 'linear (schnell)', mv=80),
           W('wpn_descant_heavy_t3', 'Diskantgabel (schwerer Modus)', 1900, 14.5, 65, 'linear (schnell)', mv=90, extra=CHARGE)],
  compareDpsIdx=[0],
  special='Hybrid A6: zwei Feuermodi, eine Form. Nur ein Modus aktiv (Toggle), DPS-Vergleich über den schnellen Modus. '
          'Schwerer Modus: Heuler 1 Schuss, Brüller 2 Schüsse (FA-Relation).',
  toggles=['fire_mode (MS13, C17)'],
  hotbuild=(GH, 'F'), icon='land_sniper_t3',
  parts=P('legs keel:amber*yaw@torso fork*pitch@langgabel fin:team@kamm fin:team@glyphenfeld'),
  kitbash='Schlankes Dreibein, Gabel mit extrem langen, eng stehenden Zinken (≥ 1,2 × Rumpflänge), schmaler Kamm; Maßstab 1,4 (1×1-Deckel), 3 Tonpunkte.')

U(id='lnd_t3_aa', de='Zimbel', en='Cymbal', roleDe='Entladungsgleiter', roleEn='Discharge Glider (AA)', tech=3, group='land',
  visual='v_aa', ms='MS13', msNote='U10 in MS13', ms9=False, faRef='DSLK004', faRole='T3 Mobile AA, Luft + Boden (FAF-Einheit)',
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'DIRECTFIRE', 'TECH3'], buildableBy=LAND_T3,
  mass=720, energy=9000, bt=3600, hp=1850, speed=3.4, turn=75, accel=2.4, sizeClass=2, footprint=[2, 2], vision=26,
  weapons=[W('wpn_discharge_aa_t3', 'Entladung (Luft)', 210, 0.9, 58, 'Entladungsbogen (Hitscan-Puls)', splash=1, layers=('air',)),
           W('wpn_discharge_ground_t3', 'Entladung (Boden)', 70, 4.0, 28, 'Entladungsbogen (Hitscan-Puls)', salvo=3, splash=1)],
  compareDpsIdx=[0, 1],
  special='Hybrid A6, Primär Flugabwehr: trifft Luft und (schwächer) Boden; beide Waffen im DPS-Vergleich wie die Referenz. '
          'Hitscan-Puls braucht dieselbe K1-Entscheidung wie Gabel II (§19).',
  hotbuild=(GH, 'R'), icon='land_aa_t3',
  parts=P('keel:amber lens@schwebespalt fin:team*yaw@pfeifenplatte pipe pipe pipe fork@kurze_gabel'),
  kitbash='Bordun ×1,7 mit 3 dicken Pfeifen und kurzer Gabel davor (Sekundärmerkmal, Pfeifen ≥ 1,5 × Gabellänge), 3 Tonpunkte; kein zweiter Kamm (Superset-Limit).')

U(id='lnd_t3_shield', de='Stille', en='Hush', roleDe='Großschild', roleEn='Heavy Mobile Shield', tech=3, group='land',
  visual='v_shield_mobile', ms='MS13', msNote='Rest U6 (mobiler Schild) mit K10 in MS13 – wie Varkan-Schürze', ms9=False,
  faRef='XSL0307', faRole='T3 Mobile Shield Generator',
  cats=['LAND', 'MOBILE', 'SHIELD', 'DEFENSE', 'TECH3'], buildableBy=LAND_T3,
  mass=720, energy=6200, bt=3600, hp=450, speed=3.8, turn=150, accel=2.8, sizeClass=2, footprint=[2, 2], vision=20,
  shield=dict(hp=9600, radius=20, regenPerSec=130, regenStartS=3, rechargeS=40, upkeepEnergyPerSec=170),
  eco=dict(upkeepEnergyPerSec=170), weapons=[], toggles=['shield (MS13, C17)'],
  special='A5: kein mobiler T2-Schild, dafür ein großer T3-Schild, der einen ganzen Pulk deckt. Energy-Stall schaltet ab (E3). Vergleich über HP+Schild.',
  postMvp=PM(('M13', 'echtes Schweben über Wasser (Hover)', 'normale LAND-Einheit')),
  hotbuild=(GH, 'D'), icon='land_shield_t3',
  parts=P('keel:amber lens@schwebespalt mast ring:team*yaw@waagerecht fin:team@doppelkamm'),
  kitbash='Überlanger Kiel mit Mast, waagerechter Reif (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt, Doppelkamm, 3 Tonpunkte; keine Gabel, kein Trichter.')

# ---------------------------------------------------------------- Luft
U(id='air_t1_scout', de='Grille', en='Cricket', roleDe='Aufklärer', roleEn='Air Scout', tech=1, group='air',
  visual='v_air_scout', ms='MS12', msNote='U11 Luftwaffe in MS12', ms9=False, faRef='XSA0101', faRole='T1 Air Scout',
  cats=['AIR', 'MOBILE', 'SCOUT', 'INTELLIGENCE', 'TECH1'], buildableBy=AIR_T1,
  mass=40, energy=560, bt=200, hp=34, speed=18.5, turn=100, sizeClass=0, footprint=[1, 1], vision=42, radar=60,
  weapons=[], death=dict(ref=f'{NS}:wpn_air_crash_s', damage=10, radius=1, note='Absturzschaden (K12)'),
  special='Unbewaffnet.', hotbuild=(HH, 'A'), icon='air_intel_t1',
  parts=P('keel:amber@rumpf fin:team@fluegel fin:team@senkrechter_kamm'),
  kitbash='Kleinster Flieger, kurzer Flügel, ein einzelner senkrechter Kamm; keine Waffen-Parts.')

U(id='air_t1_fighter', de='Zikade', en='Cicada', roleDe='Abfangjäger', roleEn='Interceptor', tech=1, group='air',
  visual='v_fighter', ms='MS12', msNote='U11 in MS12', ms9=False, faRef='XSA0102', faRole='T1 Interceptor',
  cats=['AIR', 'MOBILE', 'ANTIAIR', 'TECH1'], buildableBy=AIR_T1,
  mass=50, energy=2200, bt=500, hp=300, speed=15, turn=120, sizeClass=0, footprint=[1, 1], vision=28,
  weapons=[W('wpn_cicada_aa_t1', 'Zirpgeschütz', 17, 1.0, 25, 'linear (Vorhalt)', salvo=3, mv=90, layers=('air',))],
  death=dict(ref=f'{NS}:wpn_air_crash_s', damage=25, radius=1, note='Absturzschaden (K12)'),
  special='Nur Luftziele.', hotbuild=(HH, 'Q'), icon='air_aa_t1',
  parts=P('keel:amber fin:team@pfeilblatt_l fin:team@pfeilblatt_r'),
  kitbash='Schmales Pfeilblatt aus zwei Kämmen zu einem spitzen V (lang > breit); keine Fächer, keine Gondeln.')

U(id='air_t1_bomber', de='Maikäfer', en='Cockchafer', roleDe='Bomber', roleEn='Bomber', tech=1, group='air',
  visual='v_bomber', ms='MS12', msNote='U11 in MS12 (Bomber-FSM)', ms9=False, faRef='XSA0103', faRole='T1 Attack Bomber',
  cats=['AIR', 'MOBILE', 'BOMBER', 'TECH1'], buildableBy=AIR_T1,
  mass=90, energy=2000, bt=500, hp=220, speed=10, turn=80, sizeClass=0, footprint=[1, 1], vision=32, radar=40,
  weapons=[W('wpn_hum_bomb_t1', 'Summbombe', 240, 5.0, 40, 'ballistisch (Abwurf)', splash=4, mv=0,
             extra='DPS = Salve/Nachladezeit (pro Anflug). Eine große Bombe statt einer Reihe (A10).')],
  death=dict(ref=f'{NS}:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='A10: eine Bombe mit großem Splash, weniger DPS/Mass als die Varkan-Dohle.', hotbuild=(HH, 'W'), icon='air_bomb_t1',
  parts=P('lens:amber@bauchlinse shell:team@faecher fin@leitkamm'),
  kitbash='Breiter Fächer (Deckflügel-Muschel von oben, breit ≥ lang) mit Bauch-Linse; keine Pfeilung, keine Gabel.')

U(id='air_t2_gunship', de='Schwebfliege', en='Hoverfly', roleDe='Kampfschweber', roleEn='Gunship', tech=2, group='air',
  visual='v_gunship', ms='MS12', msNote='U11 in MS12 (Orbit)', ms9=False, faRef='XSA0203', faRole='T2 Gunship',
  cats=['AIR', 'MOBILE', 'GUNSHIP', 'DIRECTFIRE', 'TECH2'], buildableBy=AIR_T2,
  mass=500, energy=9800, bt=3300, hp=1850, speed=11, turn=90, sizeClass=0, footprint=[1, 1], vision=32,
  weapons=[W('wpn_hoverfly_fork_t2', 'Bauchgabel (Doppelstoß beider Zinken)', 21, 0.7, 24, 'linear', salvo=4, mv=35)],
  death=dict(ref=f'{NS}:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='A10: teuer und zäh (Mass 500 statt 200 beim Varkan-Gunship). Referenz mit beiden Bordwaffen gezählt (spooky-db `WeaponNumber` 2, Review R1). Kein Transport (U13 Post-MVP).', hotbuild=(HH, 'E'), icon='air_direct_t2',
  parts=P('keel:team@oberschale ring*yaw@antrieb_l ring@antrieb_r fork*yaw@gabel_unten'),
  kitbash='Keine Flügel: Kiel mit zwei senkrechten Reifen seitlich, Gabel unten.')

U(id='air_t2_fbomber', de='Schwärmer', en='Hawkmoth', roleDe='Jagdbomber', roleEn='Fighter-Bomber', tech=2, group='air',
  visual='v_fbomber', ms='MS12', msNote='U11 in MS12', ms9=False, faRef='XSA0202', faRole='T2 Fighter/Bomber',
  cats=['AIR', 'MOBILE', 'BOMBER', 'ANTIAIR', 'TECH2'], buildableBy=AIR_T2,
  mass=420, energy=8200, bt=2400, hp=1050, speed=15, turn=110, sizeClass=0, footprint=[1, 1], vision=32, radar=60,
  weapons=[W('wpn_hawkmoth_aa_t2', 'Zirpgeschütz, schwer (beide Gondeln)', 24, 1.0, 30, 'linear (Vorhalt)', salvo=6, mv=90, layers=('air',)),
           W('wpn_hawkmoth_bomb_t2', 'Schwere Summbombe', 1200, 10.0, 60, 'ballistisch (Abwurf)', splash=3, mv=0)],
  death=dict(ref=f'{NS}:wpn_air_crash_l', damage=200, radius=1, note='Absturzschaden (K12)'),
  special='A10: eine schwere Einzelbombe. Beide Waffen addiert im DPS-Vergleich (wie Referenz); Luftwaffe aus beiden Gondeln (Referenz `WeaponNumber` 2, Review R1).', hotbuild=(HH, 'R'), icon='air_fbomb_t2',
  parts=P('keel:amber fin:team@pfeilblatt_l fin:team@pfeilblatt_r lens@gondel_l lens@gondel_r'),
  kitbash='Pfeilblatt mit zwei Linsen-Gondeln an den Spitzen, Spannweite +30 % gegenüber Zikade; keine Reifen.')

# ---------------------------------------------------------------- Wirtschaft
TRI = 'lens:team@dreipass lens:team@dreipass lens:team@dreipass'
U(id='str_t1_mex', de='Stimmstock I', en='Soundpost I', roleDe='Massebohrung', roleEn='Mass Extractor', tech=1, group='eco',
  visual='v_mex', ms='MS4', msNote='E5 in MS4', ms9=True, faRef='XSB1103', faRole='T1 Mass Extractor',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=36, energy=360, bt=60, bp=10, hp=400, footprint=[2, 2], vision=None,
  eco=dict(massPerSec=2, upkeepEnergyPerSec=2), weapons=[], upgradesTo='str_t2_mex',
  adjacency='Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Bernsteinkammer.',
  special='Nur auf Mass-Spots; produziert während des Upgrades weiter (B4).', hotbuild=(BAU, 'Q'), icon='struct_mass_t1',
  parts=P(f'{TRI} ring@reif crystal:glow*tilt@zentralkristall'),
  kitbash='Niedriger Dreipass-Sockel, Reif um den Spot, zentraler Kristall (pulsiert als gezupfte Saite).')

U(id='str_t2_mex', de='Stimmstock II', en='Soundpost II', roleDe='Massebohrung', roleEn='Mass Extractor', tech=2, group='eco',
  visual='v_mex', ms='MS8', msNote='B4 (T1→T2) in MS8', ms9=True, faRef='XSB1202', faRole='T2 Mass Extractor (Upgrade-Kosten)',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH2', 'SIZE4'], buildableBy=ENG_T2 + ' | UPGRADE',
  mass=900, energy=5400, bt=900, bp=15, hp=2000, footprint=[2, 2], vision=20,
  eco=dict(massPerSec=6, upkeepEnergyPerSec=9), weapons=[], upgradesTo='str_t3_mex', upgradeFrom='str_t1_mex',
  adjacency='Fabriken −10 % Mass-Verbrauch; +12,5 % je Bernsteinkammer.',
  special='Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Solist/Vorsänger baubar. Fällt mit 1 Fanfare-Schuss (FA-Relation).',
  hotbuild=(BAU, 'Q (Upgrade: Command Card)'), icon='struct_mass_t2',
  parts=P(f'{TRI} ring@reif crystal:glow*tilt@zentralkristall'),
  kitbash='Stimmstock mit Höhe ×1,2, 2 Tonpunkte auf dem Sockelrand.')

U(id='str_t3_mex', de='Stimmstock III', en='Soundpost III', roleDe='Massebohrung', roleEn='Mass Extractor', tech=3, group='eco',
  visual='v_mex', ms='MS13', msNote='Rest B4 (T3-Mex) in MS13', ms9=False, faRef='XSB1302', faRole='T3 Mass Extractor (Upgrade-Kosten)',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH3', 'SIZE4'], buildableBy=ENG_T3 + ' | UPGRADE',
  mass=4500, energy=31000, bt=2900, hp=6900, footprint=[2, 2], vision=20,
  eco=dict(massPerSec=18, upkeepEnergyPerSec=54), weapons=[], upgradeFrom='str_t2_mex',
  adjacency='Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Bernsteinkammer.',
  special='Upgrade-Kosten.', hotbuild=(BAU, 'Q (Upgrade: Command Card)'), icon='struct_mass_t3',
  parts=P(f'{TRI} ring@reif ring@zweiter_reif crystal:glow*tilt@zentralkristall'),
  kitbash='Stimmstock mit doppeltem Reif, Höhe ×1,4, 3 Tonpunkte; keine Harfenbögen (unterscheidet sich so von der Äolsharfe).')

U(id='str_t1_pgen', de='Resonator I', en='Resonator I', roleDe='Kraftwerk', roleEn='Power Generator', tech=1, group='eco',
  visual='v_pgen', ms='MS4', msNote='E6 in MS4', ms9=True, faRef='XSB1101', faRole='T1 Power Generator',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=75, energy=750, bt=125, hp=570, footprint=[2, 2], vision=None, eco=dict(energyPerSec=20), weapons=[],
  death=dict(ref=f'{NS}:wpn_resonator_burst_t1', damage=250, radius=2, note='K14, Kettenreaktion-Golden MS10'),
  adjacency='Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzender Lichtkammer (SIZE4).',
  special='Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA).', hotbuild=(BAU, 'W'), icon='struct_energy_t1',
  parts=P(f'{TRI} crystal:glow@stehender_kristall'),
  kitbash='Dreipass-Sockel mit einem stehenden Kristall (Zahl der Kristalle = Tech, Höhe ≥ 1,5 × Sockel-Ø); keine Pfeifen.')

U(id='str_t2_pgen', de='Resonator II', en='Resonator II', roleDe='Kraftwerk', roleEn='Power Generator', tech=2, group='eco',
  visual='v_pgen', ms='MS8', msNote='E6-Tech-Leiter mit T2-Engineer (MS8); KI-Tech bis T2 in MS9', ms9=True,
  faRef='XSB1201', faRole='T2 Power Generator',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH2', 'SIZE12'], buildableBy=ENG_T2,
  mass=1200, energy=12000, bt=2200, hp=2350, footprint=[6, 6], vision=20, eco=dict(energyPerSec=500), weapons=[],
  death=dict(ref=f'{NS}:wpn_resonator_burst_t2', damage=1500, radius=5, note='K14'),
  adjacency='Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzender Lichtkammer (SIZE12).',
  special='Fällt mit 1 Fanfare-Schuss (FA-Relation: HP = Schaden der T2-Artillerie).', hotbuild=(BAU, 'W'), icon='struct_energy_t2',
  parts=P(f'{TRI} crystal:glow crystal:glow'),
  kitbash='Resonator auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Kristallen, 2 Tonpunkte.')

U(id='str_t3_pgen', de='Resonator III', en='Resonator III', roleDe='Kraftwerk', roleEn='Power Generator', tech=3, group='eco',
  visual='v_pgen', ms='MS13', msNote='T3-Pgen-Nachlieferung in MS13', ms9=False, faRef='XSB1301', faRole='T3 Power Generator',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH3', 'SIZE16'], buildableBy=ENG_T3,
  mass=3200, energy=57000, bt=6800, hp=7100, footprint=[8, 8], vision=20, eco=dict(energyPerSec=2500), weapons=[],
  death=dict(ref=f'{NS}:wpn_resonator_burst_t3', damage=5500, radius=10, note='K14, FA-Relation 1:1'),
  adjacency='Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzender Lichtkammer (SIZE16).', special='—',
  hotbuild=(BAU, 'W'), icon='struct_energy_t3',
  parts=P(f'{TRI} crystal:glow crystal:glow crystal:glow'),
  kitbash='Resonator auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Kristallen, 3 Tonpunkte.')

U(id='str_t1_hydro', de='Äolsharfe', en='Aeolian Harp', roleDe='Dampfkraftwerk', roleEn='Geothermal Plant', tech=1, group='eco',
  visual='v_hydro', ms='MS10', msNote='E9 in MS10; als Daten-Vorgriff im MS9-Kern (nur Spot-Regel wie E5)', ms9=True,
  faRef='XSB1102', faRole='T1 Hydrocarbon Power Plant',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'HYDROCARBON', 'TECH1', 'SIZE12'], buildableBy=ENG_T1,
  mass=160, energy=800, bt=400, hp=1750, footprint=[6, 6], vision=None, eco=dict(energyPerSec=100), weapons=[],
  adjacency='Wie Resonator II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzender Lichtkammer (SIZE12).',
  special='Nur auf Hydro-Spots; keine Death-Weapon (wie FA).', hotbuild=(BAU, 'E'), icon='struct_hydro_t1',
  parts=P(f'{TRI} ring@reif fin@harfenbogen fin@harfenbogen fin@harfenbogen crystal:glow@kern'),
  kitbash='Reif mit drei gebogenen Kämmen (Harfenbogen) um einen Kristall; keine senkrechten Pfeifen.')

U(id='str_t1_mstore', de='Bernsteinkammer', en='Amber Vault', roleDe='Massespeicher', roleEn='Mass Storage', tech=1, group='eco',
  visual='v_mstore', ms='MS10', msNote='E10 in MS10; Daten-Vorgriff im MS9-Kern (E4-Speicherlimit existiert ab MS4)', ms9=True,
  faRef='XSB1106', faRole='T1 Mass Storage',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSSTORAGE', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=200, energy=1500, bt=250, hp=720, footprint=[2, 2], vision=None, eco=dict(storageMass=500), weapons=[],
  adjacency='+12,5 % Produktion je angrenzendem Stimmstock (FA-Relation, max. 4 Seiten = +50 %).',
  special='Keine Death-Weapon.', hotbuild=(BAU, 'R'), icon='struct_mstore_t1',
  parts=P(f'{TRI} crystal:amber@sechseckblock_ohne_spitze'),
  kitbash='Flaches Sechseckprisma aus Bernstein (Kristall-Primitiv mit Spitzenhöhe 0, Parameter im Platzhalter), Mass = eckig; keine Spitze, kein Leuchten.')

U(id='str_t1_estore', de='Lichtkammer', en='Light Vault', roleDe='Energiespeicher', roleEn='Energy Storage', tech=1, group='eco',
  visual='v_estore', ms='MS6', msNote='Aufschrei (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10', ms9=True,
  faRef='XSB1105', faRole='T1 Energy Storage',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYSTORAGE', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=250, energy=1200, bt=200, hp=520, footprint=[2, 2], vision=None, eco=dict(storageEnergy=10000), weapons=[],
  death=dict(ref=f'{NS}:wpn_lightvault_burst', damage=1000, radius=5, note='K14'),
  adjacency='Bufft alle angrenzenden Energieproduzenten (FA-Relation): Resonator I +25 % (SIZE4), Resonator II und Äolsharfe +8,3 % (SIZE12), Resonator III +6,25 % (SIZE16).',
  special='—', hotbuild=(BAU, 'T'), icon='struct_estore_t1',
  parts=P(f'{TRI} lens:amber@stapel_unten lens:amber@stapel_oben ring:glow@leuchtfuge'),
  kitbash='Zwei gestapelte flache Linsen (Energy = rund), dazwischen eine leuchtende Fuge; keine stehenden Kristalle.')

# ---------------------------------------------------------------- Hallen
FAC_ADJ = 'Empfängt Adjacency von Stimmstöcken (Mass) und Resonatoren (Energy).'
HALL = f'{TRI} shell:team@apsis crystal:glow@scheitelkristall'
U(id='str_t1_fac_land', de='Grundhalle I', en='Ground Hall I', roleDe='Landfabrik', roleEn='Land Factory', tech=1, group='fac',
  visual='v_fac', ms='MS6', msNote='B3 in MS6', ms9=True, faRef='XSB0101', faRole='T1 Land Factory',
  cats=['STRUCTURE', 'FACTORY', 'LAND', 'TECH1', 'SIZE16'], buildableBy=ENG_T1,
  mass=240, energy=2100, bt=300, bp=20, hp=3600, footprint=[8, 8], vision=20, eco=dict(storageMass=80), weapons=[],
  upgradesTo='str_t2_fac_land', adjacency=FAC_ADJ,
  special='Queue/Repeat/Rally (B3). Upgrade-Verb „Einstimmen“.', hotbuild=(BAU, 'A'), icon='struct_fac_land_t1',
  parts=P(f'{HALL} fin:team@kamm_rampe'),
  kitbash='Apsis (halb offene Muschel, offene Seite = Ausgang) mit Kamm-Rampe, Kristall über dem Scheitel.')

U(id='str_t2_fac_land', de='Grundhalle II', en='Ground Hall II', roleDe='Landfabrik', roleEn='Land Factory', tech=2, group='fac',
  visual='v_fac', ms='MS8', msNote='U5 in MS8', ms9=True, faRef='XSB0201', faRole='T2 Land Factory HQ (Upgrade-Kosten)',
  cats=['STRUCTURE', 'FACTORY', 'LAND', 'TECH2', 'SIZE16'], buildableBy='UPGRADE',
  mass=1400, energy=11000, bt=2300, bp=40, hp=7200, footprint=[8, 8], vision=20, eco=dict(storageMass=160), weapons=[],
  upgradesTo='str_t3_fac_land', upgradeFrom='str_t1_fac_land', adjacency=FAC_ADJ,
  special='Nur per Upgrade (kein HQ/Support-System, B9 Post-MVP).', hotbuild=(BAU, 'Upgrade (Command Card)'), icon='struct_fac_land_t2',
  parts=P(f'{HALL} fin:team@kamm_rampe crystal:glow@zweiter_kristall'),
  kitbash='Grundhalle Höhe ×1,2 mit zweitem Scheitelkristall, 2 Tonpunkte.')

U(id='str_t3_fac_land', de='Grundhalle III', en='Ground Hall III', roleDe='Landfabrik', roleEn='Land Factory', tech=3, group='fac',
  visual='v_fac', ms='MS13', msNote='U5 T3 / U10 in MS13', ms9=False, faRef='XSB0301', faRole='T3 Land Factory HQ (Upgrade-Kosten)',
  cats=['STRUCTURE', 'FACTORY', 'LAND', 'TECH3', 'SIZE16'], buildableBy='UPGRADE',
  mass=5200, energy=47000, bt=12000, bp=90, hp=14500, footprint=[8, 8], vision=20, eco=dict(storageMass=320), weapons=[],
  upgradeFrom='str_t2_fac_land', adjacency=FAC_ADJ, special='Nur per Upgrade.',
  hotbuild=(BAU, 'Upgrade (Command Card)'), icon='struct_fac_land_t3',
  parts=P(f'{HALL} fin:team@kamm_rampe crystal:glow@zweiter_kristall crystal:glow@dritter_kristall'),
  kitbash='Grundhalle Höhe ×1,4 mit drei Scheitelkristallen, 3 Tonpunkte (8 Parts).')

U(id='str_t1_fac_air', de='Himmelshalle I', en='Sky Hall I', roleDe='Luftfabrik', roleEn='Air Factory', tech=1, group='fac',
  visual='v_fac', ms='MS12', msNote='Luftfabrik T1→T2 in MS12', ms9=False, faRef='XSB0102', faRole='T1 Air Factory',
  cats=['STRUCTURE', 'FACTORY', 'AIR', 'TECH1', 'SIZE16'], buildableBy=ENG_T1,
  mass=210, energy=2400, bt=300, bp=20, hp=3600, footprint=[8, 8], vision=20, eco=dict(storageMass=80), weapons=[],
  upgradesTo='str_t2_fac_air', adjacency=FAC_ADJ, special='Baut keine Engineers (wie FA).',
  hotbuild=(BAU, 'S'), icon='struct_fac_air_t1',
  parts=P(f'{HALL} ring@landereif'),
  kitbash='Apsis mit Landereif statt Kamm-Rampe (teilt das Visual mit der Grundhalle, Tech-Bitmaske + Rollenbit).')

U(id='str_t2_fac_air', de='Himmelshalle II', en='Sky Hall II', roleDe='Luftfabrik', roleEn='Air Factory', tech=2, group='fac',
  visual='v_fac', ms='MS12', msNote='MS12', ms9=False, faRef='XSB0202', faRole='T2 Air Factory HQ (Upgrade-Kosten)',
  cats=['STRUCTURE', 'FACTORY', 'AIR', 'TECH2', 'SIZE16'], buildableBy='UPGRADE',
  mass=920, energy=17500, bt=2300, bp=40, hp=7200, footprint=[8, 8], vision=20, eco=dict(storageMass=160), weapons=[],
  upgradeFrom='str_t1_fac_air', adjacency=FAC_ADJ, special='Nur per Upgrade; keine T3-Himmelshalle (U12 Post-MVP).',
  hotbuild=(BAU, 'Upgrade (Command Card)'), icon='struct_fac_air_t2',
  parts=P(f'{HALL} ring@landereif crystal:glow@zweiter_kristall'),
  kitbash='Himmelshalle Höhe ×1,2 mit zweitem Scheitelkristall, 2 Tonpunkte.')

# ---------------------------------------------------------------- Verteidigung
U(id='str_t1_pd', de='Gabel I', en='Fork I', roleDe='Punktverteidigung', roleEn='Point Defense', tech=1, group='def',
  visual='v_pd', ms='MS8', msNote='B5 in MS8; Minimal-A8 der KI in MS9', ms9=True, faRef='XSB2101', faRole='T1 Point Defense',
  cats=['STRUCTURE', 'DEFENSE', 'DIRECTFIRE', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=250, energy=2000, bt=250, hp=1320, footprint=[1, 1], vision=24,
  weapons=[W('wpn_fork_pd_t1', 'Gabelton (Stellung)', 52, 0.3, 26, 'linear', mv=35)],
  special='Dieselbe Gabel wie der Triller, auf Dreipass-Sockel.', hotbuild=(BAU, 'Z'), icon='struct_direct_t1',
  parts=P(f'{TRI} fork*yaw'),
  kitbash='Dreipass-Sockel mit waagerechter Gabel.')

U(id='str_t2_pd', de='Gabel II', en='Fork II', roleDe='Strahlverteidigung', roleEn='Beam Defense', tech=2, group='def',
  visual='v_pd', ms='MS8', msNote='B5 (T2) in MS8; Strahl-Modell (K1) muss vorher entschieden sein', ms9=True,
  faRef='XSB2301', faRole='T2 Point Defense (Beam)',
  cats=['STRUCTURE', 'DEFENSE', 'DIRECTFIRE', 'TECH2', 'SIZE4'], buildableBy=ENG_T2,
  mass=540, energy=3700, bt=680, hp=2200, footprint=[2, 2], vision=28,
  weapons=[W('wpn_beam_t2', 'Schwebung (Dauerstrahl)', 50, 4.0, 50, 'Strahl: Hitscan-Puls alle 0,1 s (12 Pulse = 1,2 s Strahl)', salvo=12,
             extra='A7. Strahl als Folge von Hitscan-Pulsen (faction.md §11.2 Nr. 5); salvo = Pulse pro Zyklus. Fallback bis K1 entschieden ist: '
                   'Projektilwaffe mit 600 Schaden / 4,0 s, gleicher DPS und Reichweite.')],
  special='Kein Upgrade von Gabel I (wie FA). RW 50 statt 48 (Varkan-Riegel II), kein Splash.', hotbuild=(BAU, 'Z'), icon='struct_direct_t2',
  parts=P(f'{TRI} fork*yaw lens@strahllinse'),
  kitbash='Gabel ×2 (2×2) mit Linse zwischen den Zinken (Strahl), 2 Tonpunkte.')

U(id='str_t1_aa', de='Pfeifenwerk I', en='Pipework I', roleDe='Flugabwehrturm', roleEn='AA Tower', tech=1, group='def',
  visual='v_aa_struct', ms='MS8', msNote='B5 in MS8, Wirkung MS12', ms9=True, faRef='XSB2104', faRole='T1 Anti-Air Turret',
  cats=['STRUCTURE', 'DEFENSE', 'ANTIAIR', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=150, energy=1500, bt=190, hp=810, footprint=[1, 1], vision=24,
  weapons=[W('wpn_pipework_aa_t1', 'Orgel-Staccato (3 Pfeifen)', 7, 0.3, 44, 'linear (Vorhalt)', salvo=3, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=(BAU, 'X'), icon='struct_aa_t1',
  parts=P(f'{TRI} fin:team*yaw@pfeifenplatte pipe pipe'),
  kitbash='Dreipass-Sockel mit teamfarbener Kamm-Platte und 2 gestuften senkrechten Pfeifen.')

U(id='str_t2_aa', de='Pfeifenwerk II', en='Pipework II', roleDe='Flakturm', roleEn='Flak Tower', tech=2, group='def',
  visual='v_aa_struct', ms='MS8', msNote='B5 (T2) in MS8, Näherungszünder MS12', ms9=True, faRef='XSB2204', faRole='T2 Anti-Air Flak Artillery',
  cats=['STRUCTURE', 'DEFENSE', 'ANTIAIR', 'TECH2', 'SIZE4'], buildableBy=ENG_T2,
  mass=400, energy=4000, bt=540, hp=2600, footprint=[2, 2], vision=24,
  weapons=[W('wpn_pipework_flak_t2', 'Bordunflak (Stellung)', 48, 0.7, 44, 'linear + Näherungszünder (MS12)', salvo=2, splash=4, mv=35, layers=('air',))],
  special='Nur Luftziele.', hotbuild=(BAU, 'X'), icon='struct_aa_t2',
  parts=P(f'{TRI} fin:team*yaw@pfeifenplatte pipe pipe pipe'),
  kitbash='Pfeifenwerk auf 2×2 mit 3 Pfeifen, 2 Tonpunkte.')

U(id='str_t3_sam', de='Hochorgel', en='Grand Organ', roleDe='Raketenabwehr', roleEn='SAM Site', tech=3, group='def',
  visual='v_sam', ms='MS8', msNote='MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Vorsänger)',
  ms9=True, faRef='XSB2304', faRole='T3 Anti-Air SAM Launcher',
  cats=['STRUCTURE', 'DEFENSE', 'ANTIAIR', 'TECH3', 'SIZE4'], buildableBy=ENG_T3,
  mass=800, energy=8000, bt=1400, hp=5100, footprint=[2, 2], vision=28,
  weapons=[W('wpn_grand_organ_t3', 'Stoßton-Flugabwehr (2er)', 580, 3.4, 60, 'homing + Näherungszünder', salvo=2, splash=1.5, mv=100, layers=('air',))],
  special='Nur Luftziele. Wenige, sehr schwere Treffer (Schwebfliege 2, Schwärmer 1 Salve).', hotbuild=(BAU, 'X'), icon='struct_sam_t3',
  parts=P(f'{TRI} fin:team*yaw@platte spindle@senkrecht spindle@senkrecht spindle@senkrecht spindle@senkrecht'),
  kitbash='Dreipass-Sockel mit teamfarbener Platte und 4 senkrechten Spindeln (doppelt so viele wie Pfeifenwerk I), 3 Tonpunkte.')

U(id='str_t1_wall', de='Grat', en='Ridge', roleDe='Mauer', roleEn='Wall', tech=1, group='def',
  visual='v_wall', ms='MS8', msNote='B5/Minimal-Drag (DECISIONS 3) in MS8', ms9=True, faRef='XSB5101', faRole='Wall Section',
  cats=['STRUCTURE', 'DEFENSE', 'WALL', 'TECH1'], buildableBy=ENG_T1,
  mass=3, energy=20, bt=15, hp=520, footprint=[1, 1], vision=0, weapons=[],
  special='wall-Flag (Drag-Linie), blockiert Schüsse und Pathing.', hotbuild=(BAU, 'C'), icon='wall',
  parts=P('fin@flachkamm fin:team@firstkante'),
  kitbash='Niedrige Kette flacher Kämme, nur die Firstkante teamfarben (≈ 10 %).')

# ---------------------------------------------------------------- Intel & Schilde
U(id='str_t1_radar', de='Widerhall I', en='Reverb I', roleDe='Radar', roleEn='Radar', tech=1, group='intel',
  visual='v_radar', ms='MS10', msNote='I3 in MS10', ms9=False, faRef='XSB3101', faRole='T1 Radar System',
  cats=['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=80, energy=720, bt=80, bp=13, hp=11, footprint=[2, 2], vision=20, radar=116,
  eco=dict(upkeepEnergyPerSec=20), weapons=[], toggles=['radar (MS10, C17)'], upgradesTo='str_t2_radar',
  special='Stall schaltet ab (E3). Sehr fragil (FA-Relation).', hotbuild=(BAU, 'D'), icon='struct_intel_t1',
  parts=P(f'{TRI} mast shell*yaw@schale_35grad'),
  kitbash='Hoher dünner Mast mit 35° gekippter Muschel-Schale, rotierend; kein Reif.')

U(id='str_t2_radar', de='Widerhall II', en='Reverb II', roleDe='Radar', roleEn='Radar', tech=2, group='intel',
  visual='v_radar', ms='MS10', msNote='I3 T1→T2 in MS10', ms9=False, faRef='XSB3201', faRole='T2 Radar System (Upgrade-Kosten)',
  cats=['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH2', 'SIZE4'], buildableBy='UPGRADE',
  mass=180, energy=3600, bt=780, bp=20, hp=52, footprint=[2, 2], vision=24, radar=200,
  eco=dict(upkeepEnergyPerSec=150), weapons=[], toggles=['radar (MS10, C17)'],
  upgradesTo='str_t3_radar', upgradeFrom='str_t1_radar', special='Nur per Upgrade.',
  hotbuild=(BAU, 'Upgrade (Command Card)'), icon='struct_intel_t2',
  parts=P(f'{TRI} mast mast@zweiter_mast shell*yaw@schale_35grad'),
  kitbash='Widerhall Höhe ×1,2 mit Doppelmast, 2 Tonpunkte.')

U(id='str_t3_radar', de='Widerhall III', en='Reverb III', roleDe='Radar', roleEn='Radar', tech=3, group='intel',
  visual='v_radar', ms='MS13', msNote='Rest I3 (T3-Radar) in MS13', ms9=False,
  faRef='XSB3104', faRole='T3 Omni Sensor Suite (Upgrade-Kosten; hier ohne Omni)',
  cats=['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH3', 'SIZE4'], buildableBy='UPGRADE',
  mass=1200, energy=15000, bt=1200, hp=52, footprint=[2, 2], vision=30, radar=300,
  eco=dict(upkeepEnergyPerSec=400), weapons=[], toggles=['radar (MS10, C17)'], upgradeFrom='str_t2_radar',
  special='Kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert (wie Varkan-Horcher III), HP/Mass in Relation; Unterhalt 400 E/s statt 2.000.',
  postMvp=PM(('I4', 'Omni-Sensor (FA-Vorbild: Radar 600 + Omni)', 'reines Radar r300')),
  hotbuild=(BAU, 'Upgrade (Command Card)'), icon='struct_intel_t3',
  parts=P(f'{TRI} mast mast@zweiter_mast shell*yaw@schale_35grad shell@zweite_schale'),
  kitbash='Widerhall Höhe ×1,4 mit zweiter Schale, 3 Tonpunkte.')

U(id='str_t2_shield', de='Dämpfer II', en='Damper II', roleDe='Schildgenerator', roleEn='Shield Generator', tech=2, group='intel',
  visual='v_shield', ms='MS13', msNote='K10 in MS13', ms9=False, faRef='XSB4202', faRole='T2 Shield Generator',
  cats=['STRUCTURE', 'SHIELD', 'DEFENSE', 'TECH2', 'SIZE12'], buildableBy=ENG_T2,
  mass=700, energy=7000, bt=1250, bp=20, hp=420, footprint=[6, 6], vision=20,
  shield=dict(hp=12600, radius=27, regenPerSec=150, regenStartS=3, rechargeS=25, upkeepEnergyPerSec=240),
  eco=dict(upkeepEnergyPerSec=240), weapons=[], toggles=['shield (MS13, C17)'], upgradesTo='str_t3_shield',
  special='A8: stärker und teurer als Varkan-Schirm II (Mass 700 statt 600). Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab. Vergleich über HP+Schild.',
  hotbuild=(BAU, 'F'), icon='struct_shield_t2',
  parts=P(f'{TRI} mast ring:team*yaw@waagerecht'),
  kitbash='Mast mit waagerechtem Reif (Ø ≥ 0,8 × Footprint-Kante); keine Muschel.')

U(id='str_t3_shield', de='Dämpfer III', en='Damper III', roleDe='Schildgenerator', roleEn='Shield Generator', tech=3, group='intel',
  visual='v_shield', ms='MS13', msNote='K10 in MS13', ms9=False, faRef='XSB4301', faRole='T3 Heavy Shield Generator (Upgrade-Kosten)',
  cats=['STRUCTURE', 'SHIELD', 'DEFENSE', 'TECH3', 'SIZE12'], buildableBy='UPGRADE',
  mass=3600, energy=58000, bt=5800, hp=620, footprint=[6, 6], vision=20,
  shield=dict(hp=20500, radius=44, regenPerSec=165, regenStartS=3, rechargeS=25, upkeepEnergyPerSec=480),
  eco=dict(upkeepEnergyPerSec=480), weapons=[], toggles=['shield (MS13, C17)'], upgradeFrom='str_t2_shield',
  special='Nur per Upgrade.', hotbuild=(BAU, 'Upgrade (Command Card)'), icon='struct_shield_t3',
  parts=P(f'{TRI} mast ring:team*yaw@waagerecht ring@zweiter_reif'),
  kitbash='Dämpfer Höhe ×1,4 mit zweitem Reif, 3 Tonpunkte.')

# ---------------------------------------------------------------- Artillerie-Stellungen
U(id='str_t2_arty', de='Fanfare', en='Fanfare', roleDe='Artilleriestellung', roleEn='Artillery Emplacement', tech=2, group='arty',
  visual='v_arty_struct', ms='MS13', msNote='K13 in MS13', ms9=False, faRef='XSB2303', faRole='T2 Artillery Installation',
  cats=['STRUCTURE', 'DEFENSE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH2', 'SIZE4'], buildableBy=ENG_T2,
  mass=2000, energy=14000, bt=1600, hp=2950, footprint=[2, 2], vision=28,
  weapons=[W('wpn_fanfare_t2', 'Fanfarenstoß', 2350, 20.0, 112, 'ballistisch', minr=50, splash=3, mv=26, extra=CHARGE)],
  special='Ein Schuss tötet Stimmstock II, Resonator II und Gabel I (FA-Relation). Artillerie-Adjacency optional mit E11.',
  hotbuild=(BAU, 'V'), icon='struct_arty_t2',
  parts=P(f'{TRI} ring*yaw@lafette horn:team*pitch fin@gegengewicht'),
  kitbash='Großer Trichter auf Lafette über dem Dreipass-Sockel, Kamm als Gegengewicht; keine Gabel.')

U(id='str_t3_arty', de='Großhorn', en='Great Horn', roleDe='Schwere Artilleriestellung', roleEn='Heavy Artillery Emplacement',
  tech=3, group='arty', visual='v_arty_struct', ms='MS13', msNote='K13 + Reichweiten-Gate in MS13', ms9=False,
  faRef='XSB2302', faRole='T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert)',
  cats=['STRUCTURE', 'DEFENSE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH3', 'SIZE16'], buildableBy=ENG_T3,
  mass=47000, energy=880000, bt=73000, hp=9000, footprint=[8, 8], vision=28,
  weapons=[W('wpn_great_horn_t3', 'Großhornstoß', 4900, 15.0, 200, 'ballistisch', minr=60, splash=7, mv=55, extra=CHARGE)],
  special='FA-Referenz: RW 825, 70.800 Mass, 5.000 Schaden alle 10 s. Skaliert wie Varkan-Hochofen: RW 200 (Gate ≤ 40 % der kleinsten Kartendiagonale), '
          'Kosten ≈ 66 %, fast gleicher Einzelschuss (Schild-Burst), Feuerrate ×⅔; DPS/Mass und HP/Mass bleiben in Relation.',
  hotbuild=(BAU, 'V'), icon='struct_arty_t3',
  parts=P(f'{TRI} ring*yaw@lafette horn:team*pitch@ueberlanger_trichter fin@gegengewicht fin:team@zweiter_kamm'),
  kitbash='Fanfare-Silhouette auf 8×8 mit überlangem Trichter (Länge ≥ 2 × Öffnung) und zweitem Kamm, 3 Tonpunkte; kein Kristall.')

# ---------------------------------------------------------------- abgeleitete Felder
H_TECH = {0: 1.0, 1: 1.0, 2: 1.2, 3: 1.4}
MOB_SCALE = {0: 1.0, 1: 1.0, 2: 1.3, 3: 1.7}
MOB_CAP_1x1 = 1.4
FLOW_CATS = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
BY_ID = {u['id']: u for u in R}


def fa_reload(rof):
    return math.floor(10 / rof + 1e-6) / 10


def fa_weapon(bp, idx=None):
    ws = FA[bp]['weapons']
    if idx is not None:
        w = ws[idx]
    else:
        ok = [w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
        w = max(ok, key=lambda w: w['dps'])
    rel = fa_reload(w['rof'])
    salvo = round(w['dps'] * rel / w['dmg'])
    return dict(damage=w['dmg'], salvo=salvo, reloadS=rel, splash=w['splash'] or 0)


def fa_dps(bp, idx=None):
    ws = FA[bp]['weapons']
    if idx is None:
        return FA[bp]['dps']
    return round(sum(ws[i]['dps'] for i in idx), 2)


def fa_metrics(u):
    bp = u['faRef']; r = FA[bp]
    dps = fa_dps(bp, u.get('faDpsIdx'))
    hp = r['hp'] + (r['shield'] or 0)
    return dict(bp=bp, mass=r['mass'], energy=r['energy'], buildTime=r['bt'], hp=r['hp'], shieldHp=r['shield'],
                dps=dps, dpsWeapons=u.get('faDpsIdx'), dpsPerMass=round(dps / r['mass'], 4) if dps else None,
                hpPerMass=round(hp / r['mass'], 4), speed=r['speed'],
                range=max([w['range'] or 0 for w in r['weapons'] if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0] or [0]) or None)


def pulk_targets(splash):
    return math.pi * (splash + 0.5) ** 2 / 4


VIS_BASE = {}
for u in R:
    b = VIS_BASE.get(u['visual'])
    if b is None or u['tech'] < b['tech']:
        VIS_BASE[u['visual']] = u

out = []
for u in R:
    idx = u.get('compareDpsIdx')
    ws = u['weapons']
    dps = sum(w['dps'] for i, w in enumerate(ws) if (idx is None or i in idx))
    hp_eff = u['hp'] + (u.get('shield') or {}).get('hp', 0)
    fa = fa_metrics(u)
    fr = FA[u['faRef']]
    fa_dpm = fa['dps'] / fr['mass'] if fa['dps'] else None
    fa_hpm = (fr['hp'] + (fr['shield'] or 0)) / fr['mass']
    rd = (dps / u['mass']) / fa_dpm if dps and fa_dpm else None
    rh = (hp_eff / u['mass']) / fa_hpm
    dev_d = round((rd - 1) * 100, 1) if rd else None
    dev_h = round((rh - 1) * 100, 1)
    dev_p = round((rd * rh - 1) * 100, 1) if rd else None
    inband = all(abs(x) <= 25 for x in (dev_d, dev_h) if x is not None)
    in15 = all(abs(x) <= 15 for x in (dev_d, dev_h, dev_p) if x is not None)
    pulk = None
    if 'ARTILLERY' in u['cats'] and ws and ws[0].get('splash'):
        w = ws[0]; fw = fa_weapon(u['faRef'])
        ours = w['damage'] * w['salvo'] * pulk_targets(w['splash']) / w['reloadS'] / u['mass']
        theirs = fw['damage'] * fw['salvo'] * pulk_targets(fw['splash']) / fw['reloadS'] / fr['mass']
        pulk = dict(splash=w['splash'], faSplash=fw['splash'], pulkDpsPerMass=round(ours, 4),
                    faPulkDpsPerMass=round(theirs, 4), devPct=round((ours / theirs - 1) * 100, 1))
    parts = u['parts']
    tris = sum(TRIS[p['part']] for p in parts)
    anim = sum(1 for p in parts if p.get('anim'))
    mobile = u['group'] in ('cmd', 'land', 'air')
    if mobile:
        s = MOB_SCALE[u['tech']]
        if u['footprint'] == [1, 1] and s > MOB_CAP_1x1:
            s = MOB_CAP_1x1
        scale = dict(xz=s, y=s)
    else:
        b = VIS_BASE[u['visual']]
        xz = u['footprint'][0] / b['footprint'][0]
        scale = dict(xz=round(xz, 2), y=round(xz * H_TECH[u['tech']] / H_TECH[b['tech']], 2))
    dots = 0 if (u['tech'] == 0 or 'WALL' in u['cats']) else u['tech']
    dot_mat = 'body' if ('ENGINEER' in u['cats'] and 'COMMAND' not in u['cats']) else 'pearl'
    e = dict(
        id=u['id'], name=dict(de=u['de'], en=u['en']), role=dict(de=u['roleDe'], en=u['roleEn']),
        tech=u['tech'], group=u['group'], visual=u['visual'], ms9Core=u['ms9'], msFirst=u['ms'], msNote=u['msNote'],
        faReference=dict(devOnly=True, role=u['faRole'], bp=u['faRef'], crossCheckBp=u.get('faCross')),
        categories=u['cats'], buildableBy=u['buildableBy'],
        economy={k: v for k, v in dict(mass=u['mass'], energy=u['energy'], buildTime=u['bt'], buildPower=u.get('bp'),
                                       **(u.get('eco') or {})).items() if v is not None},
        health=dict(max=u['hp'], **({'regenPerSec': u['regen']} if u.get('regen') else {})),
        shield=u.get('shield'), weapons=ws,
        motion=(dict(layer='air' if u['group'] == 'air' else 'land', speed=u['speed'], turnRateDeg=u['turn'],
                     accel=u.get('accel'), sizeClass=u['sizeClass'], footprint=u['footprint']) if mobile
                else dict(layer='land', speed=0, footprint=u['footprint'], structure=True)),
        intel={k: v for k, v in dict(vision=u.get('vision'), radar=u.get('radar')).items() if v is not None},
        special=dict(toggles=u.get('toggles', []), upgradesTo=u.get('upgradesTo'), upgradeFrom=u.get('upgradeFrom'),
                     adjacency=u.get('adjacency'), deathWeapon=u.get('death'), notes=u['special'],
                     postMvp=u.get('postMvp', [])),
        hotbuild=(dict(menu=u['hotbuild'][0], slot=u['hotbuild'][1]) if u['hotbuild'] else None),
        icon=u['icon'],
        kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris, techStripes=dots,
                     techStripeMat=dot_mat if dots else None, scale=scale, description=u['kitbash']),
        balance=dict(dps=round(dps, 2) if dps else None, dpsPerMass=round(dps / u['mass'], 4) if dps else None,
                     hpPerMass=round(hp_eff / u['mass'], 4),
                     hpBasis='HP+Schild' if (u.get('shield') or fr['shield']) else 'HP',
                     fa=fa, devDpsPerMassPct=dev_d, devHpPerMassPct=dev_h, devProductPct=dev_p,
                     pulk=pulk, withinBand25=inband, withinTarget15=in15),
    )
    if u['group'] == 'air':
        e['motion']['accel'] = None
        e['motion']['note'] = 'kinematisches Flugmodell: speed = Reisetempo, turnRateDeg = Entwurfswert (FA: Air.TurnSpeed)'
    out.append(e)
E = {e['id']: e for e in out}

# ---------------------------------------------------------------- Treffer-bis-Tod-Matrix (exakt FA-Vorbild)
def f(x): return f'{NS}:{x}'
HTK_PAIRS = (
    [(f('cmd_commander'), 0, 0, f(t)) for t in ('lnd_t1_scout', 'lnd_t1_tank', 'lnd_t1_arty', 'lnd_t1_aa', 'lnd_t1_engineer', 'lnd_t2_engineer')] +
    [(f('lnd_t1_scout'), 0, None, f(t)) for t in ('lnd_t1_scout', 'lnd_t1_engineer')] +
    [(f('lnd_t1_tank'), 0, None, f(t)) for t in ('lnd_t1_scout', 'lnd_t1_tank', 'lnd_t1_arty', 'lnd_t1_engineer')] +
    [(f('str_t1_pd'), 0, None, f(t)) for t in ('lnd_t1_tank', 'lnd_t1_scout')] +
    [(f('lnd_t1_arty'), 0, None, f(t)) for t in ('lnd_t1_scout', 'lnd_t1_engineer', 'lnd_t1_tank')] +
    [(f('lnd_t2_tank'), 0, None, f(t)) for t in ('lnd_t1_scout', 'lnd_t1_tank', 'lnd_t1_engineer')] +
    [(f('lnd_t2_bot'), 0, None, f(t)) for t in ('lnd_t1_scout', 'lnd_t1_tank', 'lnd_t1_engineer')] +
    [(f('lnd_t2_mml'), 0, None, f('str_t2_pd'))] +
    [(f('lnd_t3_sniper'), 0, 1, f('lnd_t1_tank')), (f('lnd_t3_sniper'), 0, 1, f('lnd_t2_bot')),
     (f('lnd_t3_sniper'), 1, 2, f('lnd_t2_tank')), (f('lnd_t3_sniper'), 1, 2, f('lnd_t2_bot'))] +
    [(f('str_t2_arty'), 0, None, f(t)) for t in ('str_t2_mex', 'str_t1_pd', 'str_t2_pgen')] +
    [(f('str_t1_aa'), 0, None, f('air_t1_scout')), (f('air_t1_fighter'), 0, None, f('air_t1_scout')),
     (f('lnd_t3_aa'), 0, 1, f('air_t1_fighter')), (f('lnd_t3_aa'), 0, 1, f('air_t2_gunship'))] +
    [(f('str_t3_sam'), 0, None, f(t)) for t in ('air_t2_gunship', 'air_t2_fbomber')]
)
htk = []
for a, wi, fwi, t in HTK_PAIRS:
    w = E[a]['weapons'][wi]; fw = fa_weapon(BY_ID[a]['faRef'], fwi)
    thp = E[t]['health']['max']; fthp = FA[BY_ID[t]['faRef']]['hp']
    ours = math.ceil(thp / (w['damage'] * w['salvo'])); theirs = math.ceil(fthp / (fw['damage'] * fw['salvo']))
    htk.append(dict(attacker=a, weapon=w['ref'], target=t, salvoDamage=w['damage'] * w['salvo'], targetHp=thp,
                    hits=ours, ttkS=round((ours - 1) * w['reloadS'], 1),
                    fa=dict(attacker=BY_ID[a]['faRef'], weaponIdx=fwi, target=BY_ID[t]['faRef'], salvoDamage=fw['damage'] * fw['salvo'],
                            targetHp=fthp, hits=theirs, ttkS=round((theirs - 1) * fw['reloadS'], 1)),
                    match=ours == theirs))

# ---------------------------------------------------------------- Schildbrechen (Info)
def shots_to_break(w, sh):
    net_regen = sh['regenPerSec'] * max(0.0, w['reloadS'] - sh['regenStartS'])
    dmg = w['damage'] * w['salvo']
    if dmg <= net_regen: return None
    n = 1
    while n * dmg - (n - 1) * net_regen < sh['hp']: n += 1
    return n

FA_SHIELD = {'XSB4202': dict(regenPerSec=153, regenStartS=3), 'XSB4301': dict(regenPerSec=168, regenStartS=3),
             'XSL0307': dict(regenPerSec=133, regenStartS=3)}  # FAF develop *_unit.bp (spooky-db führt keine Regeneration)
shield_break = []
for a, t in ((f('str_t2_arty'), f('str_t2_shield')), (f('str_t3_arty'), f('str_t2_shield')),
             (f('str_t3_arty'), f('str_t3_shield')), (f('lnd_t3_arty'), f('str_t2_shield')), (f('lnd_t3_sniper'), f('lnd_t3_shield'))):
    w = E[a]['weapons'][0]; sh = E[t]['shield']; n = shots_to_break(w, sh)
    tb = BY_ID[t]['faRef']
    fw = fa_weapon(BY_ID[a]['faRef']); fsh = dict(hp=FA[tb]['shield'], **FA_SHIELD[tb]); fn = shots_to_break(fw, fsh)
    shield_break.append(dict(attacker=a, target=t, shots=n, timeS=round((n - 1) * w['reloadS'], 1) if n else None,
                             faShots=fn, faTimeS=round((fn - 1) * fw['reloadS'], 1) if fn else None,
                             note='Einzelner Schütze; FA-Waffe gegen FA-Schild (HP, Regeneration, Verzögerung aus FAF develop)'))

# ---------------------------------------------------------------- Visuals
visuals = {}
for e in out:
    v = visuals.setdefault(e['visual'], dict(members=[], counts={}))
    v['members'].append(e['id'])
    c = {}
    for p in e['kitbash']['parts']:
        k = p['part'] + (':' + p['mat'] if p.get('mat') else '')
        c[k] = c.get(k, 0) + 1
    for k, n_ in c.items():
        v['counts'][k] = max(v['counts'].get(k, 0), n_)
for vid, v in visuals.items():
    v['supersetParts'] = sum(v['counts'].values())
    v['trisEstimate'] = sum(TRIS[k.split(':')[0]] * n_ for k, n_ in v['counts'].items())
    v['mobile'] = E[v['members'][0]]['group'] in ('cmd', 'land', 'air')

# ---------------------------------------------------------------- Checks / Lints
# Monopol-Formen (faction.md §5.2): Part -> erlaubte Kategorien (mindestens eine muss passen)
MONOPOLY = {
    'crystal': FLOW_CATS, 'sickle': {'ENGINEER'}, 'pipe': {'ANTIAIR'}, 'horn': {'ARTILLERY', 'INDIRECTFIRE'},
    'spindle': {'SILO', 'ANTIAIR'}, 'fork': {'DIRECTFIRE'}, 'shell': {'RADAR', 'FACTORY', 'BOMBER'},
}
ids = [e['id'] for e in out]
assert len(ids) == len(set(ids))
for e in out:
    k = e['kitbash']; b = e['balance']; cats = set(e['categories'])
    assert e['id'].startswith(NS + ':'), e['id']
    assert k['animatedParts'] <= 2, e['id']
    assert k['partCount'] <= (7 if e['group'] in ('cmd', 'land', 'air') else 9), (e['id'], k['partCount'])
    assert k['trisEstimate'] <= 350, e['id']
    assert b['withinBand25'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'])
    assert b['withinTarget15'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'], b['devProductPct'])
    if b['pulk']: assert abs(b['pulk']['devPct']) <= 15, (e['id'], b['pulk'])
    for kk in ('upgradesTo', 'upgradeFrom'):
        if e['special'][kk]: assert e['special'][kk] in ids, (e['id'], kk)
    for p in k['parts']:
        if p.get('mat') == 'glow': assert cats & FLOW_CATS, ('Resonanz-Monopol glow', e['id'], p)
        if p['part'] in MONOPOLY: assert cats & MONOPOLY[p['part']], ('Monopol', e['id'], p)
        if p['part'] == 'sickle' or (p.get('mat') == 'pearl'): assert 'ENGINEER' in cats, ('Perlglas', e['id'])
    assert any(p.get('mat') == 'team' for p in k['parts']), ('Teamfarbe', e['id'])
    if e['special']['upgradesTo'] and 'STRUCTURE' in cats:
        assert e['economy'].get('buildPower'), ('buildPower', e['id'])
    if e['shield']: assert 'regenStartS' in e['shield'], e['id']
    for w in e['weapons']:
        assert abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, w['ref']
    for pm in e['special']['postMvp']:
        assert re.fullmatch(r'[A-Z]\d+', pm['feature']), pm
for h in htk:
    assert h['match'], ('Treffer-bis-Tod', h)
for vid, v in visuals.items():
    assert v['supersetParts'] <= (8 if v['mobile'] else 9), (vid, v['supersetParts'])
    assert v['trisEstimate'] <= 350, (vid, v['trisEstimate'])

glyphs = sorted({re.sub(r'^(land|air|eng|struct)_', '', re.sub(r'_t\d$', '', e['icon'])) for e in out
                 if e['icon'] not in ('cmd_commander', 'wall')})
VARKAN_GLYPHS = ['aa', 'arty', 'bomb', 'bot', 'build', 'direct', 'energy', 'estore', 'fac_air', 'fac_land', 'fbomb', 'hydro',
                 'intel', 'mass', 'mml', 'mstore', 'sam', 'shield', 'sniper']
assert set(glyphs) <= set(VARKAN_GLYPHS), set(glyphs) - set(VARKAN_GLYPHS)  # keine neue Glyphe (faction.md §6.1)

n9 = sum(e['ms9Core'] for e in out)
mob = sum(1 for e in out if e['group'] in ('cmd', 'land', 'air'))
assert (len(out), mob, n9, len(visuals)) == (49, 22, 26, 28), (len(out), mob, n9, len(visuals))

# ---------------------------------------------------------------- Experimentals (T4, Post-MVP; exp.py, experimentals.md)
import exp as EXP  # noqa: E402
X = EXP.entries(EXP.build(NS, P, W, PM, TRIS), TRIS)
EXP.check(X, glyphs, set(ids))
doc = dict(
    schema='faf-roster/1', faction='f4 (Aurith-Chor)', generated='2026-09-29', language='de',
    sourceOfTruth='roster.json ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts der Fraktion f4; '
                  'factions/f4/faction.md und roster.md verweisen darauf.',
    counts=dict(total=len(out), mobile=mob, structures=len(out) - mob, ms9Core=n9, visuals=len(visuals), iconGlyphs=len(glyphs),
                experimentals=len(X), experimentalVisuals=len({e['visual'] for e in X})),
    conventions=dict(
        units='1 WU = 1 FA-Ogrid (20-km-Karte = 1024 WU, DECISIONS „Setons“); Reichweiten/Tempo 1:1 in WU bzw. WU/s',
        buildTime='Sekunden = buildTime / Build Power des Erbauers (FA-Semantik); Upgrade-Dauer = buildTime der Zielstufe / buildPower der Vorstufe',
        upgradeCost='Kosten von Upgrade-Stufen (upgradeFrom gesetzt) sind Upgrade-Kosten, nicht Gesamtkosten (FA-Semantik)',
        reload='reloadS ist ein Vielfaches von 0,1 s (10-Hz-Tick); dps = damage × salvo / reloadS',
        beam='Strahlwaffen (Gabel II, Zimbel) als Hitscan-Pulse: salvo = Pulse pro Zyklus, damage = Schaden pro Puls (Vorschlag für K1, faction.md §11.2 Nr. 5)',
        dpsBomber='Bomber-DPS = Salvenschaden / Nachladezeit (theoretisch, pro Anflug)',
        balanceGate='Hart: |devDpsPerMassPct| und |devHpPerMassPct| ≤ 25 (PLAN U3). Ziel (vom Generator erzwungen): Einzelachsen, Produkt '
                    '(DPS/Mass × HP/Mass) und Pulk-DPS/Mass der Artillerie je ≤ ±15 %; Treffer-bis-Tod-Matrix exakt wie FA. '
                    'Referenz ist die Vorbild-Fraktion (Blueprints XS*/DSLK004), nicht die Varkan-Referenz.',
        productGate='devProductPct = (dpsPerMass/FA) × (hpPerMass/FA) − 1; bestimmt die Stärke im direkten Gefecht',
        pulkModel='Pulk-DPS/Mass = Schaden × Salve × Ziele / Nachladezeit / Mass, Ziele = π (Splash + 0,5)² / 4 '
                  '(1 Ziel pro 4 WU², Zielradius 0,5); gilt für Kategorie ARTILLERY',
        hitsToKill='Treffer (Salven) bis zum Tod = ceil(Ziel-HP / Salvenschaden); Pflichtpaare in checks.hitsToKill müssen exakt der FA-Referenz entsprechen',
        faDps='balance.fa.dpsWeapons: Indizes der FA-Waffen, die in die Referenz-DPS eingehen (null = spooky-DPS aller Waffen). '
              'Kantor: nur Hauptwaffe; Grollen: ohne Torpedo (U18); Diskant: nur schneller Modus (Modi schließen sich aus).',
        hpBasis='Bei Schild-Einheiten (eigene oder FA-Referenz) wird HP+Schild-HP verglichen',
        shieldRegen='regenStartS = Verzögerung nach dem letzten Treffer, bis die Regeneration einsetzt (Vorbild: 3 s bei allen Schilden)',
        commander='Kantor: Mass 2000 nominell (nicht baubar), DPS nur Hauptwaffe',
        postMvp='special.postMvp (Erweiterung gegenüber Varkan, optional): Asymmetrien der Vorbild-Fraktion, die ein Post-MVP-Feature brauchen. '
                'Rein additiv; alle Balance-Werte gelten ohne sie.',
        faReference='dev-only: faReference wird beim Blueprint-Build per Lint entfernt und darf nie in view.json oder i18n landen (faction.md §2.4)',
        scale='Mobil uniform T1 1,0 / T2 1,3 / T3 1,7, bei 1×1-Footprint max. 1,4. Strukturen: xz = Footprint-Kante / Footprint-Kante der '
              'niedrigsten Stufe des Visuals (Sockel füllt 100 % des Footprints), y = xz × Höhenfaktor (T1 1,0 / T2 1,2 / T3 1,4) relativ zur Basis.',
        techStripes='Bei f4 = Tonpunkte (faction.md §3.4): 1–3 runde Punkte auf dem hinteren Kamm, Ø 0,12 WU × Maßstab, Abstand 0,08 WU; '
                    'Perlglas (pearl), bei Engineers Pechglas (body); Kantor und Grat ohne Punkte. Feldname wie Varkan (Schema faf-roster/1).',
        dreipass='Dreipass-Sockel = drei lens-Parts mit mat team (Teamfarbe nur als Randmaske, 20–30 % der Draufsicht)',
        visual='Ein Visual = ein Superset-Mesh pro Rolle (Vereinigung der Parts aller Tech-Stufen nach Part+Material). Jeder Vertex trägt eine '
               'Tech-Bitmaske; v_fac trägt zusätzlich ein Rollenbit (Land/Luft). Ein Draw pro (Visual, LOD).',
        experimentals='T4 stehen im eigenen Schlüssel `experimentals` (tier T4, postMvp true) und zählen nicht in total/ms9Core/visuals; '
                      'cross.py und die MVP-Gates sehen sie nicht. Referenz: tools/roster/f4/fa_ref_t4.json (Vorbild XSL0401/XSA0402/XSB2401, '
                      'Fremdreferenz UEL0401/XAB1401). Gates: Δ DPS/Mass (Boden), Δ HP/Mass, Produkt je ≤ ±15 %, Δ Luft-DPS/Mass ≤ ±25 %, Δ Mass ≤ ±15 %. '
                      'Icon: gemeinsame Grammatik mit Stufe `t4` (eckige Klammer um die Grundform statt Kerben, wie f2). Design: experimentals.md.',
        t4Budget=EXP.T4_BUDGET,
        t4Bridge='Setons-Brücke (engste Stelle ≈ 74 WU, Gate 72 WU, wie f2): Außenmaß ≤ 12 WU, also ≥ 6 T4 nebeneinander; sizeClass = ceil(Außenmaß / 2) ≤ 7 (Clearance ≥ Radius, Schema 0–7).',
        faSource='FAForever/spooky-db app/data/index.json (Version 3810), DPS-Formel app/js/dps.js, extrahiert mit tools/roster/f4/ref.py; '
                 'Stichprobe und Schild-Regeneration gegen FAForever/fa develop (2026-09-29)',
    ),
    hotbuildGrid={
        GH: {'Q': 'Gleiter (Triller/Heuler/Grollen)', 'W': 'Artillerie (Horn/Posaune/Heerhorn)',
             'E': 'Engineer (Chorist/Solist/Vorsänger)', 'R': 'Flugabwehr (Pfeife/Bordun/Zimbel)',
             'A': 'Späher (Pfiff)', 'S': 'Läufer (Pfiff T1 / Brüller T2)', 'D': 'Support (Stille, ab T3)',
             'F': 'Präzision (Diskant)'},
        HH: {'Q': 'Abfangjäger (Zikade)', 'W': 'Bomber (Maikäfer)', 'E': 'Gunship (Schwebfliege)',
             'R': 'Jagdbomber (Schwärmer)', 'A': 'Aufklärer (Grille)'},
        BAU: {'Q': 'Stimmstock', 'W': 'Resonator', 'E': 'Äolsharfe', 'R': 'Bernsteinkammer', 'T': 'Lichtkammer',
              'A': 'Grundhalle', 'S': 'Himmelshalle', 'D': 'Widerhall', 'F': 'Dämpfer',
              'Z': 'Gabel', 'X': 'Pfeifenwerk/Hochorgel', 'C': 'Grat', 'V': 'Fanfare/Großhorn'},
        'rule': 'Belegung identisch zu Varkan (gleiche Taste = gleiche Rolle über alle Tech-Stufen). Ausnahme: Der Pfiff liegt auf A und S, '
                'weil er Späher und leichten Sturmläufer vereint; S wechselt ab T2 zum Brüller. D ist bis T3 leer.'},
    silhouettePairs=dict(
        ms9=[[f('lnd_t1_scout'), f('lnd_t1_engineer')], [f('lnd_t1_scout'), f('lnd_t1_tank')], [f('lnd_t1_tank'), f('lnd_t1_aa')], [f('lnd_t1_arty'), f('lnd_t2_mml')],
             [f('lnd_t2_mml'), f('lnd_t1_aa')], [f('lnd_t2_tank'), f('lnd_t2_bot')], [f('lnd_t2_bot'), f('cmd_commander')],
             [f('str_t1_pd'), f('str_t1_aa')], [f('str_t1_mex'), f('str_t1_pgen')], [f('str_t1_pgen'), f('str_t1_estore')],
             [f('str_t1_mstore'), f('str_t1_estore')]],
        ms14=[[f('air_t1_fighter'), f('air_t2_fbomber')], [f('air_t1_bomber'), f('air_t1_fighter')], [f('air_t1_scout'), f('air_t1_bomber')],
              [f('str_t1_radar'), f('str_t2_shield')], [f('lnd_t1_scout'), f('lnd_t3_shield')], [f('str_t3_arty'), f('str_t3_pgen')],
              [f('str_t3_mex'), f('str_t1_hydro')], [f('lnd_t3_aa'), f('lnd_t2_aa')], [f('lnd_t3_tank'), f('lnd_t2_tank')],
              [f('lnd_t3_sniper'), f('lnd_t2_bot')]],
        crossFaction=[[f('lnd_t1_tank'), 'core:lnd_t1_tank'], [f('lnd_t1_arty'), 'core:lnd_t1_arty'], [f('lnd_t1_aa'), 'core:lnd_t1_aa'],
                      [f('lnd_t1_tank'), 'f2:lnd_t1_tank'], [f('lnd_t1_tank'), 'f3:lnd_t1_tank'], [f('lnd_t1_arty'), 'f3:lnd_t1_arty']],
        t4=[[e['id'], p] for e in X for p in e['silhouettePairs']],
        crossFactionRule='Schattenriss: dieselbe Rolle (Winkel-Code); Graustufenbild: verschiedene Fraktionen (faction.md §5.4)',
    ),
    iconGlyphs=glyphs,
    visuals={k: dict(members=v['members'], supersetParts=v['supersetParts'], trisEstimate=v['trisEstimate'], parts=v['counts'])
             for k, v in visuals.items()},
    checks=dict(hitsToKill=htk, shieldBreak=shield_break),
    units=out,
    experimentals=X,
)
for pr in doc['silhouettePairs']['ms9']:
    assert all(E[i]['ms9Core'] for i in pr), pr
OUT.parent.mkdir(parents=True, exist_ok=True)
json.dump(doc, open(OUT, 'w'), ensure_ascii=False, indent=2)
print('total', len(out), 'mobile', mob, 'ms9', n9, 'visuals', len(visuals), 'glyphs', len(glyphs))
for e in out:
    b = e['balance']
    print(f"{e['id']:22s} {'●' if e['ms9Core'] else '○'} {e['msFirst']:5s} dps/m {b['dpsPerMass']} ({b['devDpsPerMassPct']}) "
          f"hp/m {b['hpPerMass']} ({b['devHpPerMassPct']}) prod {b['devProductPct']} pulk {b['pulk'] and b['pulk']['devPct']}")
for h in htk: print('HTK', h['attacker'], '->', h['target'], h['hits'], h['fa']['hits'])
for s in shield_break: print('SHIELD', s['attacker'], s['target'], s['shots'], s['timeS'], s['faShots'], s['faTimeS'])
for k, v in visuals.items(): print('VIS', k, v['supersetParts'], v['trisEstimate'])
for e in X:
    b = e['balance']
    print(f"{e['id']:24s} T4 M {e['economy']['mass']} dps/m {b['dpsPerMass']} ({b['devDpsPerMassPct']}) air {b['devAirDpsPerMassPct']} "
          f"hp/m {b['hpPerMass']} ({b['devHpPerMassPct']}) prod {b['devProductPct']} pulk {b['pulk'] and b['pulk']['devPct']} "
          f"parts {e['kitbash']['partCount']}/{e['kitbash']['animatedParts']} tris {e['kitbash']['trisEstimate']} bridge {(e['motion'].get('bridge') or {}).get('abreast')}")
