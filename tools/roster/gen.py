# Generator for docs/design/roster.json + roster.md (Flow & Fire, Varkan faction).
# FA reference numbers come from fa_ref.json (FAForever/spooky-db app/data/index.json, v3810,
# DPS via spooky-db app/js/dps.js "NotNukeDpsCalculator").
import json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FA = json.load(open(HERE / 'fa_ref.json'))
FEATURE_IDS = {f['id'] for c in json.load(open(REPO / 'docs' / 'features.json'))['categories'] for f in c['features']}

TRIS = dict(hull=28, tracks=24, legs=60, bell=56, barrel=24, ladle=48, plumb=40, boom=24, boiler=48,
            stack=24, grate=12, mast=24, ring=48, wing=12, ductfan=56)

def P(spec):
    """'bell*yaw' -> part with anim; 'barrel:copper' -> material; 'hull@skirt' -> role note."""
    out = []
    for s in spec.split():
        anim = None; mat = None; note = None
        if '@' in s: s, note = s.split('@')
        if '*' in s: s, anim = s.split('*')
        if ':' in s: s, mat = s.split(':')
        out.append({k: v for k, v in dict(part=s, mat=mat, anim=anim, note=note).items() if v})
    return out

def W(ref, typ, dmg, reload, rng, proj, salvo=1, minr=None, splash=0, mv=None, layers=('land',), extra=None):
    dps = dmg * salvo / reload
    w = dict(ref=ref, type=typ, damage=dmg, salvo=salvo, reloadS=reload, dps=round(dps, 2),
             rangeMin=minr, range=rng, projectile=proj, muzzleVelocity=mv, splash=splash, layers=list(layers))
    if extra: w['notes'] = extra
    return {k: v for k, v in w.items() if v is not None}

R = []
def U(**k):
    R.append(k)

LAND_T1 = 'FACTORY & LAND & (TECH1 | TECH2 | TECH3)'
LAND_T2 = 'FACTORY & LAND & (TECH2 | TECH3)'
LAND_T3 = 'FACTORY & LAND & TECH3'
AIR_T1 = 'FACTORY & AIR & (TECH1 | TECH2)'
AIR_T2 = 'FACTORY & AIR & TECH2'
ENG_T1 = '(ENGINEER & (TECH1 | TECH2 | TECH3)) | COMMAND'
ENG_T2 = 'ENGINEER & (TECH2 | TECH3)'
ENG_T3 = 'ENGINEER & TECH3'

# ---------------------------------------------------------------- Kommandant & Engineers
U(id='core:cmd_commander', de='Vogt', en='Reeve', roleDe='Kommandant', roleEn='Commander', tech=0, group='cmd',
  visual='v_cmd', ms='MS4', msNote='MS4 Bauen ohne Waffe; MS5 Waffe + Lotbruch; MS6 Abstich (U8)', ms9=True,
  faRef='UEL0001', faCross='URL0001', faRole='Armored Command Unit (ACU)',
  cats=['LAND', 'MOBILE', 'COMMAND', 'ENGINEER', 'DIRECTFIRE', 'RECLAIM', 'REPAIR', 'UNIQUE'],
  buildableBy=None, mass=2000, energy=5000000, bt=6000000, bp=10, hp=12000, regen=10,
  eco=dict(massPerSec=1, energyPerSec=20, storageMass=650, storageEnergy=3900),
  weapons=[W('core:wpn_reeve_cannon', 'Direktfeuer-Kanone', 100, 1.0, 22, 'linear', minr=1, mv=35),
           W('core:wpn_reeve_tapshot', 'Abstich (Overcharge, manuell/auto)', 15000, 3.3, 22, 'linear', splash=2.5, mv=25,
             extra='FAF-Formel (OverchargeProjectile/OverchargeShared): Schaden = clamp(max. HP der mobilen Nicht-Vogt-Einheiten im Umkreis 2,7 WU '
                   '[ohne Ziel: 1250], 1250, min(15000, 0,9 x Vorrat / 6)); Drain = 6 x tatsächlicher Schaden. Unter 7500 E Vorrat: Schaden = 0,9 x Vorrat / 6. '
                   'Gegen Strukturen fix 800, gegen Vogt fix 400. Feuern erst ab 7500 E Vorrat (> Grundspeicher 3900 E => braucht Glutspeicher). '
                   'Kosten: gegen Punze 7500 E, gegen Meißel 9600 E; mit 1 Glutspeicher und +120 E/s ≈ 1 Abstich pro 60 s (FA-Relation). Nicht in DPS/Mass gewertet.')],
  compareDpsIdx=[0],
  speed=1.7, turn=90, accel=2.0, sizeClass=2, footprint=[2, 2], vision=26, radar=None,
  toggles=['auto_tapshot (MS10, C17)'], upgradesTo=None,
  death=dict(ref='core:wpn_plumb_break', inner=dict(damage=2000, radius=30), outer=dict(damage=500, radius=40),
             note='Lotbruch, Kamera-Shake X4, FA-Relation 1:1'),
  special='Einzigartig, Tod = Niederlage (U1/A4). Baut alle T1-Strukturen. Regeneration 10 HP/s. Wrack offen (faction.md §10.2 Nr. 3).',
  hotbuild=None, icon='cmd_commander',
  parts=P('legs hull*yaw@torso plumb:team@kopf stack:glow@rueckenschlot bell:team@rechte_schulter barrel*pitch boom:ceramic@rueckenkran'),
  kitbash='Lot-Kopf auf Bot-Beinen, Torso-Wanne mit Schulterplatten (Team), Rücken-Schlot als stärkster Glutpunkt; Glocke mit Rohr auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter (kein Waffen-/Bauarm-Schema). Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU.')

U(id='core:lnd_t1_engineer', de='Lehrling', en='Prentice', roleDe='Ingenieur', roleEn='Engineer', tech=1, group='cmd',
  visual='v_eng', ms='MS6', msNote='U2 (T1) in MS6', ms9=True, faRef='UEL0105', faRole='T1 Engineer',
  cats=['LAND', 'MOBILE', 'ENGINEER', 'TECH1', 'RECLAIM', 'REPAIR'], buildableBy=LAND_T1,
  mass=52, energy=260, bt=260, bp=5, hp=160, speed=1.9, turn=180, accel=3.0, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[], special='Baut T1-Strukturen, Assist, Reclaim, Repair. FA-Engineers sind amphibisch, hier nur land (Marine Post-MVP).',
  hotbuild=('Landwerk', 'E'), icon='eng_build_t1',
  parts=P('hull:ceramic tracks boiler:team@kessel_bauchband boom:copper*yaw ring:glow*pitch@emitter'),
  kitbash='Kurze breite Wanne mit Keramik-Deck, ein diagonaler Kupfer-Kranarm mit Glut-Emitter, liegender Kessel mit teamfarbenem Bauchband; 1 Tech-Streifen graphit auf dem Keramik-Deck.')

U(id='core:lnd_t2_engineer', de='Geselle', en='Journeyman', roleDe='Ingenieur', roleEn='Engineer', tech=2, group='cmd',
  visual='v_eng', ms='MS8', msNote='U2 T2 als Daten in MS8', ms9=True, faRef='UEL0208', faRole='T2 Engineer',
  cats=['LAND', 'MOBILE', 'ENGINEER', 'TECH2', 'RECLAIM', 'REPAIR'], buildableBy=LAND_T2,
  mass=130, energy=650, bt=650, bp=13, hp=420, speed=1.9, turn=150, accel=2.8, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[], special='Baut T1+T2-Strukturen (u. a. Zapfstelle II direkt, Glutkessel II, Riegel II, Rost II).',
  hotbuild=('Landwerk', 'E'), icon='eng_build_t2',
  parts=P('hull:ceramic tracks boiler:team@kessel_bauchband boom:copper*yaw boom:copper*yaw@kurzer_arm ring:glow@emitter'),
  kitbash='Wie Lehrling, Maßstab 1,3, zwei Kupfer-Kranarme verschiedener Länge, 2 Tech-Streifen graphit.')

U(id='core:lnd_t3_engineer', de='Meister', en='Master', roleDe='Ingenieur', roleEn='Engineer', tech=3, group='cmd',
  visual='v_eng', ms='MS13', msNote='Rest U2 (T3-Engineer) in MS13', ms9=False, faRef='UEL0309', faRole='T3 Engineer',
  cats=['LAND', 'MOBILE', 'ENGINEER', 'TECH3', 'RECLAIM', 'REPAIR'], buildableBy=LAND_T3,
  mass=310, energy=1550, bt=1550, bp=32, hp=840, speed=1.9, turn=120, accel=2.6, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[], special='Baut T1–T3-Strukturen (Hochrost, Hochofen, Glutkessel III, Zapfstelle III).',
  hotbuild=('Landwerk', 'E'), icon='eng_build_t3',
  parts=P('hull:ceramic tracks boiler:team@kessel_bauchband boom:copper*yaw boom:copper*yaw boom:copper@dritter_arm ring:glow@emitter'),
  kitbash='Maßstab 1,4 (Deckel für 1×1-Footprint), drei Kupfer-Kranarme (Anzahl = Tech), 3 Tech-Streifen graphit; dritter Arm statisch (Anim-Limit 2).')

# ---------------------------------------------------------------- Land T1
U(id='core:lnd_t1_scout', de='Funke', en='Spark', roleDe='Späher', roleEn='Scout', tech=1, group='land',
  visual='v_scout', ms='MS7', msNote='U4 T1-Armee in MS7; Radar-Feld wirkt ab MS10 (I3)', ms9=True,
  faRef='UEL0101', faCross='URL0101', faRole='T1 Land Scout',
  cats=['LAND', 'MOBILE', 'SCOUT', 'INTELLIGENCE', 'TECH1', 'DIRECTFIRE'], buildableBy=LAND_T1,
  mass=12, energy=80, bt=60, hp=32, speed=4.5, turn=90, accel=4.0, sizeClass=1, footprint=[1, 1], vision=26, radar=40,
  weapons=[W('core:wpn_spark_mg_t1', 'Rumpf-MG (fester Bugwinkel 90°)', 4, 2.0, 22, 'linear', mv=25)],
  special='Kein Turm (Monopol-Regel); Waffe starr im Rumpf, arcDeg 90.',
  hotbuild=('Landwerk', 'A'), icon='land_intel_t1',
  parts=P('hull:team tracks mast:copper'),
  kitbash='Kleinster Rumpf (Deck teamfarben), hoher dünner Mast ≥ 1,0 × Rumpflänge ohne Kopfteil, Glutnaht an der Spitze.')

U(id='core:lnd_t1_bot', de='Stichel', en='Graver', roleDe='Leichter Sturmläufer', roleEn='Light Assault Bot', tech=1, group='land',
  visual='v_bot', ms='MS6', msNote='erste Fabrik-Einheit im Opening (MS6); U4 abgenommen MS7', ms9=True,
  faRef='UEL0106', faCross='URL0106', faRole='T1 Light Assault Bot',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'BOT', 'TECH1'], buildableBy=LAND_T1,
  mass=32, energy=130, bt=130, hp=70, speed=4.3, turn=60, accel=4.0, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[W('core:wpn_mg_t1', 'Schnellfeuer-MG', 7, 0.3, 14, 'linear', mv=25)],
  special='Raider/Engineer-Jäger: höchste DPS/Mass der T1-Armee, wenig HP.',
  hotbuild=('Landwerk', 'S'), icon='land_bot_t1',
  parts=P('legs hull bell:team*yaw barrel*pitch'),
  kitbash='Kleine Wanne auf Beinen, Glocke mit kurzem waagerechtem Rohr.')

U(id='core:lnd_t1_tank', de='Punze', en='Punch', roleDe='Kampfpanzer', roleEn='Battle Tank', tech=1, group='land',
  visual='v_tank', ms='MS5', msNote='erste Kampfeinheit (Konsole, MS5), Fabrik ab MS6', ms9=True,
  faRef='UEL0201', faCross='URL0107', faRole='T1 Medium Tank',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'TANK', 'TECH1'], buildableBy=LAND_T1,
  mass=56, energy=280, bt=300, hp=300, speed=3.3, turn=90, accel=2.5, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[W('core:wpn_cannon_t1', 'Glockenkanone', 28, 1.2, 18, 'linear', mv=25)],
  special='Linienhalter nach FA-Relation. HP 300 hält die Breakpoints: 3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven.',
  hotbuild=('Landwerk', 'Q'), icon='land_direct_t1',
  parts=P('hull:team tracks bell:team*yaw barrel*pitch barrel:copper@kupferleitung'),
  kitbash='Gedrungene Wanne 1,0×0,4×1,4 WU auf Ketten, mittige Glocke, Rohr ≈ 65 % der Rumpflänge über den Bug.')

U(id='core:lnd_t1_arty', de='Kelle', en='Ladle', roleDe='Mobile Artillerie', roleEn='Mobile Artillery', tech=1, group='land',
  visual='v_arty', ms='MS7', msNote='K2 Ballistik in MS7', ms9=True,
  faRef='UEL0103', faCross='URL0103', faRole='T1 Mobile Light Artillery',
  cats=['LAND', 'MOBILE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH1'], buildableBy=LAND_T1,
  mass=36, energy=180, bt=200, hp=210, speed=2.7, turn=90, accel=2.2, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[W('core:wpn_slag_mortar_t1', 'Schlackenmörser', 100, 9.0, 30, 'ballistisch', minr=6, splash=1.1, mv=14)],
  special='Splash 1,1 statt 1 (FA), dafür langsamer (9,0 s statt 8,3 s). Schaden 100 wie FA: 1 Treffer Stichel, 2 Lehrling, 3 Punze. Glüht nur beim Schuss (0,5 s).',
  hotbuild=('Landwerk', 'W'), icon='land_arty_t1',
  parts=P('hull:team tracks boom*yaw ladle:team*pitch hull@gegengewicht'),
  kitbash='Lange schmale Wanne, offene Kelle auf kurzem Schwenkarm, Gegengewicht am Heck; keine Glocke, kein waagerechtes Rohr.')

U(id='core:lnd_t1_aa', de='Sieb', en='Sieve', roleDe='Mobile Flugabwehr', roleEn='Mobile AA', tech=1, group='land',
  visual='v_aa', ms='MS7', msNote='U4 in MS7, Wirkung gegen Luft MS12', ms9=True,
  faRef='UEL0104', faCross='URL0104', faRole='T1 Mobile Anti-Air Gun',
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'TECH1'], buildableBy=LAND_T1,
  mass=55, energy=275, bt=220, hp=310, speed=3.3, turn=80, accel=2.5, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[W('core:wpn_aa_repeater_t1', 'Zwillings-Flugabwehrkanone', 14, 1.0, 30, 'linear (Vorhalt)', salvo=2, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Landwerk', 'R'), icon='land_aa_t1',
  parts=P('hull:team tracks grate*yaw barrel@senkrecht barrel@senkrecht'),
  kitbash='Wanne mit Rost-Platte, darauf 2 dünne senkrechte Rohre (≥ 75°) als Kamm quer zur Fahrtrichtung.')

# ---------------------------------------------------------------- Land T2
U(id='core:lnd_t2_tank', de='Meißel', en='Chisel', roleDe='Schwerer Panzer', roleEn='Heavy Tank', tech=2, group='land',
  visual='v_tank', ms='MS8', msNote='U6 in MS8', ms9=True, faRef='UEL0202', faCross='URL0202', faRole='T2 Heavy Tank',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'TANK', 'TECH2'], buildableBy=LAND_T2,
  mass=200, energy=1000, bt=900, hp=1600, speed=2.9, turn=90, accel=2.2, sizeClass=2, footprint=[1, 1], vision=20,
  weapons=[W('core:wpn_cannon_t2', 'Doppel-Glockenkanone', 35, 1.3, 22, 'linear', salvo=2, mv=30)],
  special='Rohre am Glocken-Part geparentet (1 animierter Part).', hotbuild=('Landwerk', 'Q'), icon='land_direct_t2',
  parts=P('hull:team tracks bell:team*yaw barrel barrel hull@schuerze_l hull@schuerze_r'),
  kitbash='Punze ×1,3, breitere Glocke mit zwei parallelen Rohren, seitliche Schürzenplatten, 2 Tech-Streifen.')

U(id='core:lnd_t2_mml', de='Rinne', en='Runner', roleDe='Raketenwerfer', roleEn='Missile Launcher', tech=2, group='land',
  visual='v_mml', ms='MS8', msNote='U6 inkl. MML über K11 in MS8', ms9=True, faRef='UEL0111', faCross='URL0111',
  faRole='T2 Mobile Missile Launcher',
  cats=['LAND', 'MOBILE', 'INDIRECTFIRE', 'ARTILLERY', 'SILO', 'TECH2'], buildableBy=LAND_T2,
  mass=180, energy=1300, bt=800, hp=780, speed=2.8, turn=90, accel=2.2, sizeClass=2, footprint=[1, 1], vision=18,
  weapons=[W('core:wpn_runner_missile_t2', 'Glutraketen (2er-Salve)', 300, 10.0, 60, 'homing (Wenderate, K11)', salvo=2,
             minr=12, splash=1.0, mv=3)],
  special='Lenkflugkörper mit begrenzter Wenderate (ausweichbar, K11).', hotbuild=('Landwerk', 'W'), icon='land_mml_t2',
  parts=P('hull:team tracks boiler boom*yaw hull*pitch@raketenkasten'),
  kitbash='Wanne mit liegendem Kessel, ein breiter Raketenkasten 0,5 × 0,25 × 1,1 WU auf Schwenkarm, 50° geneigt (≥ 25° flacher als AA-Rohre, Breite ≥ 2 × AA-Rohr-Ø); kein Rohr.')

U(id='core:lnd_t2_aa', de='Rüttelsieb', en='Riddle', roleDe='Flak', roleEn='Flak', tech=2, group='land',
  visual='v_aa', ms='MS8', msNote='U6 in MS8, Wirkung/Näherungszünder MS12', ms9=True, faRef='UEL0205', faCross='URL0205',
  faRole='T2 Mobile AA Flak Artillery',
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'TECH2'], buildableBy=LAND_T2,
  mass=160, energy=800, bt=800, hp=1050, speed=3.0, turn=90, accel=2.4, sizeClass=2, footprint=[1, 1], vision=20,
  weapons=[W('core:wpn_flak_t2', 'Splitterflak', 70, 0.5, 38, 'linear + Näherungszünder (MS12)', splash=4, mv=20, layers=('air',))],
  special='Nur Luftziele, Splash trifft Pulks.', hotbuild=('Landwerk', 'R'), icon='land_aa_t2',
  parts=P('hull:team tracks grate*yaw barrel barrel barrel hull@schuerze'),
  kitbash='Sieb ×1,3 mit 3 senkrechten Rohren (≥ 75°) und Schürzenplatte, 2 Tech-Streifen.')

U(id='core:lnd_t2_shield', de='Schürze', en='Apron', roleDe='Mobiler Schild', roleEn='Mobile Shield', tech=2, group='land',
  visual='v_shield_mobile', ms='MS13', msNote='Rest U6 (mobiler Schild) mit K10 in MS13', ms9=False,
  faRef='UEL0307', faRole='T2 Mobile Shield Generator',
  cats=['LAND', 'MOBILE', 'SHIELD', 'DEFENSE', 'TECH2'], buildableBy=LAND_T2,
  mass=220, energy=950, bt=700, hp=160, speed=3.4, turn=120, accel=2.8, sizeClass=1, footprint=[1, 1], vision=20,
  shield=dict(hp=3200, radius=16, regenPerSec=50, regenStartS=3, rechargeS=25, upkeepEnergyPerSec=80),
  weapons=[], toggles=['shield (MS13, C17)'],
  special='Kuppelschild; Energy-Stall schaltet ab (E3). Vergleich HP/Mass über HP+Schild.',
  hotbuild=('Landwerk', 'D'), icon='land_shield_t2',
  parts=P('hull:team tracks mast ring:team*yaw@waagerecht'),
  kitbash='Wanne mit Mast, waagerechter Ring (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt; kein Rohr, keine Glocke.')

U(id='core:lnd_t2_bot', de='Zange', en='Tongs', roleDe='Sturmläufer', roleEn='Assault Bot', tech=2, group='land',
  visual='v_bot', ms='MS14', msNote='Roster-Auffüllung auf 45–55 BP (MS14); nicht Teil von U6', ms9=False,
  faRef='DEL0204', faRole='T2 Gatling Bot (FAF)',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'BOT', 'TECH2'], buildableBy=LAND_T2,
  mass=190, energy=950, bt=950, hp=650, speed=3.2, turn=80, accel=3.2, sizeClass=1, footprint=[1, 1], vision=24,
  weapons=[W('core:wpn_gatling_t2', 'Glut-Gatling', 20, 0.3, 30, 'linear', mv=28)],
  special='Sturm-Bot, der Riegel I (RW 26) überreicht; RW 30 statt 34 (FA), 1 Waffe statt 2.',
  hotbuild=('Landwerk', 'S'), icon='land_bot_t2',
  parts=P('legs hull:team bell:team*yaw barrel*pitch hull@schuerze_l hull@schuerze_r'),
  kitbash='Stichel ×1,3 mit Schürzenplatten und 2 Tech-Streifen.')

# ---------------------------------------------------------------- Land T3
U(id='core:lnd_t3_bot', de='Fallhammer', en='Drophammer', roleDe='Belagerungsläufer', roleEn='Siege Bot', tech=3, group='land',
  visual='v_bot', ms='MS13', msNote='U10 T3-Landarmee in MS13', ms9=False, faRef='UEL0303', faCross='URL0303',
  faRole='T3 Heavy Assault Bot',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'BOT', 'TECH3'], buildableBy=LAND_T3,
  mass=500, energy=5000, bt=2500, hp=3200, speed=3.3, turn=100, accel=2.6, sizeClass=2, footprint=[2, 2], vision=22,
  weapons=[W('core:wpn_cannon_t3', 'Doppel-Glocke, schwer', 60, 0.8, 24, 'linear', salvo=2, mv=35)],
  special='Kein Personal-Schild (FA-Referenz hat 700 Schild-HP) – dafür mehr Rumpf-HP; Vergleich über HP+Schild.',
  hotbuild=('Landwerk', 'S'), icon='land_bot_t3',
  parts=P('legs hull:team bell:team*yaw barrel bell:team*yaw barrel'),
  kitbash='Überlange Wanne auf Beinen, Doppelaufbau aus zwei Glocken, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')

U(id='core:lnd_t3_arty', de='Pfanne', en='Pour Pan', roleDe='Schwere Artillerie', roleEn='Heavy Artillery', tech=3, group='land',
  visual='v_arty', ms='MS13', msNote='U10 in MS13', ms9=False, faRef='UEL0304', faCross='URL0304',
  faRole='T3 Mobile Heavy Artillery',
  cats=['LAND', 'MOBILE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH3'], buildableBy=LAND_T3,
  mass=800, energy=8000, bt=4300, hp=1000, speed=2.2, turn=75, accel=1.8, sizeClass=2, footprint=[2, 2], vision=26,
  weapons=[W('core:wpn_pour_shell_t3', 'Gießgranate', 700, 10.0, 85, 'ballistisch', minr=25, splash=4.4, mv=24)],
  special='Kein Deploy (FA-Referenz muss sich aufstellen) – ein Mechanik-Sonderfall weniger.',
  hotbuild=('Landwerk', 'W'), icon='land_arty_t3',
  parts=P('hull:team tracks boom*yaw ladle:team*pitch hull@gegengewicht'),
  kitbash='Kelle ×1,7 auf überlanger Wanne, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')

U(id='core:lnd_t3_sniper', de='Reißnadel', en='Scriber', roleDe='Präzisionsläufer', roleEn='Sniper Bot', tech=3, group='land',
  visual='v_sniper', ms='MS13', msNote='U10 in MS13', ms9=False, faRef='XAL0305', faCross='XSL0305',
  faRole='T3 Sniper Bot (UEF/Cybran haben keinen – Referenz aus anderer FA-Fraktion)',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'SNIPER', 'BOT', 'TECH3'], buildableBy=LAND_T3,
  mass=720, energy=20000, bt=4800, hp=560, speed=2.4, turn=110, accel=2.4, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[W('core:wpn_scriber_rail_t3', 'Langrohr-Präzisionskanone', 1000, 7.0, 58, 'linear (schnell)', mv=90)],
  special='Energy-Anteil niedriger als FA (20k statt 25k), sonst FA-Relation.',
  hotbuild=('Landwerk', 'F'), icon='land_sniper_t3',
  parts=P('legs hull:team bell:team*yaw barrel*pitch@langrohr'),
  kitbash='Schlanke Beine, Glocke mit extrem langem waagerechtem Rohr (≥ 1,2 × Rumpflänge), kein zweites Rohr; Maßstab 1,4 (1×1-Deckel).')

U(id='core:lnd_t3_aa', de='Trommelsieb', en='Trommel', roleDe='Schwere Flugabwehr', roleEn='Heavy AA', tech=3, group='land',
  visual='v_aa', ms='MS13', msNote='U10 in MS13', ms9=False, faRef='DELK002', faRole='T3 Mobile Rapid-fire AA Cannon (FAF)',
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'TECH3'], buildableBy=LAND_T3,
  mass=600, energy=7000, bt=3000, hp=2000, speed=3.3, turn=100, accel=2.4, sizeClass=2, footprint=[1, 1], vision=26,
  weapons=[W('core:wpn_aa_drum_t3', 'Trommel-Flugabwehrkanone', 105, 0.5, 55, 'linear (Vorhalt)', splash=1.5, mv=100, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Landwerk', 'R'), icon='land_aa_t3',
  parts=P('hull:team tracks grate*yaw barrel barrel barrel barrel'),
  kitbash='Sieb ×1,4 (1×1-Deckel) mit 4 senkrechten Rohren, 3 Tech-Streifen.')

# ---------------------------------------------------------------- Luft
U(id='core:air_t1_scout', de='Lerche', en='Lark', roleDe='Aufklärer', roleEn='Air Scout', tech=1, group='air',
  visual='v_air_scout', ms='MS12', msNote='U11 Luftwaffe in MS12', ms9=False, faRef='UEA0101', faRole='T1 Air Scout',
  cats=['AIR', 'MOBILE', 'SCOUT', 'INTELLIGENCE', 'TECH1'], buildableBy=AIR_T1,
  mass=40, energy=560, bt=200, hp=40, speed=18, turn=100, accel=None, sizeClass=0, footprint=[1, 1], vision=40, radar=60,
  weapons=[], death=dict(ref='core:wpn_air_crash_s', damage=10, radius=1, note='Absturzschaden (K12)'),
  special='Unbewaffnet, Mindesttempo 16.', hotbuild=('Luftwerk', 'A'), icon='air_intel_t1',
  parts=P('hull:team wing:team wing@seitenleitwerk'),
  kitbash='Kleinster Flieger, gerader Kurzflügel, einzelnes Seitenleitwerk.')

U(id='core:air_t1_fighter', de='Turmfalke', en='Kestrel', roleDe='Abfangjäger', roleEn='Interceptor', tech=1, group='air',
  visual='v_fighter', ms='MS12', msNote='U11 in MS12', ms9=False, faRef='UEA0102', faCross='URA0102', faRole='T1 Interceptor',
  cats=['AIR', 'MOBILE', 'ANTIAIR', 'TECH1'], buildableBy=AIR_T1,
  mass=50, energy=2200, bt=500, hp=280, speed=15, turn=120, accel=None, sizeClass=0, footprint=[1, 1], vision=28,
  weapons=[W('core:wpn_kestrel_gun_t1', 'Zwillings-Luftkanone', 25, 1.0, 25, 'linear (Vorhalt)', salvo=2, mv=90, layers=('air',))],
  death=dict(ref='core:wpn_air_crash_s', damage=25, radius=1, note='Absturzschaden (K12)'),
  special='Nur Luftziele; verfolgt mit Vorhalt.', hotbuild=('Luftwerk', 'Q'), icon='air_aa_t1',
  parts=P('hull wing:team@delta wing@leitwerk'),
  kitbash='Schmales, stark gepfeiltes Delta (lang > breit), 2 Glutnähte am Heck.')

U(id='core:air_t1_bomber', de='Dohle', en='Jackdaw', roleDe='Bomber', roleEn='Bomber', tech=1, group='air',
  visual='v_bomber', ms='MS12', msNote='U11 in MS12 (Bomber-FSM)', ms9=False, faRef='UEA0103', faCross='URA0103',
  faRole='T1 Attack Bomber',
  cats=['AIR', 'MOBILE', 'BOMBER', 'TECH1'], buildableBy=AIR_T1,
  mass=90, energy=2000, bt=500, hp=230, speed=10, turn=80, accel=None, sizeClass=0, footprint=[1, 1], vision=32, radar=40,
  weapons=[W('core:wpn_slag_bomb_t1', 'Schlackenbomben (4er-Reihe)', 85, 5.0, 40, 'ballistisch (Abwurf)', salvo=4, splash=3, mv=0,
             extra='DPS = Salve/Nachladezeit (pro Anflug). Kein Napalm-DoT wie FA-UEF.')],
  death=dict(ref='core:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='Bombenreihe quer zur Anflugrichtung; Snipe-Gate MS12.', hotbuild=('Luftwerk', 'W'), icon='air_bomb_t1',
  parts=P('hull wing:team@breitfluegel boiler@bombenbauch'),
  kitbash='Gerader Breitflügel (breit ≥ lang) mit Bauch-Kessel, T-Form von oben; Kessellänge ≥ 1,4 × Flügeltiefe, ragt vorn und hinten sichtbar über.')

U(id='core:air_t2_gunship', de='Krähe', en='Crow', roleDe='Kampfschweber', roleEn='Gunship', tech=2, group='air',
  visual='v_gunship', ms='MS12', msNote='U11 in MS12 (Orbit)', ms9=False, faRef='UEA0203', faCross='URA0203', faRole='T2 Gunship',
  cats=['AIR', 'MOBILE', 'GUNSHIP', 'DIRECTFIRE', 'TECH2'], buildableBy=AIR_T2,
  mass=200, energy=3800, bt=1300, hp=760, speed=12, turn=90, accel=None, sizeClass=0, footprint=[1, 1], vision=32,
  weapons=[W('core:wpn_crow_gun_t2', 'Bauch-Glocke', 16, 0.3, 22, 'linear', mv=80)],
  death=dict(ref='core:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='Schwebt im Orbit um das Ziel. Kein Transport (U13 Post-MVP).', hotbuild=('Luftwerk', 'E'), icon='air_direct_t2',
  parts=P('ductfan:team*yaw hull bell*yaw barrel'),
  kitbash='Keine Flügel: Ringdüse als Scheibe, darunter Glocke mit Rohr.')

U(id='core:air_t2_fbomber', de='Elster', en='Magpie', roleDe='Jagdbomber', roleEn='Fighter-Bomber', tech=2, group='air',
  visual='v_fbomber', ms='MS12', msNote='U11 in MS12', ms9=False, faRef='DEA0202', faRole='T2 Fighter/Bomber (FAF)',
  cats=['AIR', 'MOBILE', 'BOMBER', 'ANTIAIR', 'TECH2'], buildableBy=AIR_T2,
  mass=340, energy=11000, bt=2600, hp=1150, speed=15, turn=110, accel=None, sizeClass=0, footprint=[1, 1], vision=32, radar=60,
  weapons=[W('core:wpn_magpie_gun_t2', 'Luftkanone', 70, 1.0, 30, 'linear (Vorhalt)', mv=90, layers=('air',)),
           W('core:wpn_magpie_bomb_t2', 'Schlackenbomben (2er)', 360, 5.0, 50, 'ballistisch (Abwurf)', salvo=2, splash=3, mv=0)],
  death=dict(ref='core:wpn_air_crash_l', damage=200, radius=1, note='Absturzschaden (K12)'),
  special='Beide Waffen addiert im DPS-Vergleich (wie FA-Referenz).', hotbuild=('Luftwerk', 'R'), icon='air_fbomb_t2',
  parts=P('hull wing:team@delta boiler@gondel_l boiler@gondel_r wing@leitwerk'),
  kitbash='Delta mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 % gegenüber Turmfalke; keine Ringdüse.')

# ---------------------------------------------------------------- Wirtschaft
U(id='core:str_t1_mex', de='Zapfstelle I', en='Tap I', roleDe='Massebohrung', roleEn='Mass Extractor', tech=1, group='eco',
  visual='v_mex', ms='MS4', msNote='E5 in MS4', ms9=True, faRef='UEB1103', faRole='T1 Mass Extractor',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=36, energy=360, bt=60, bp=10, hp=420, footprint=[2, 2], vision=None,
  eco=dict(massPerSec=2, upkeepEnergyPerSec=2), weapons=[],
  upgradesTo='core:str_t2_mex', adjacency='Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzendem Erzspeicher.',
  special='Nur auf Mass-Spots; produziert während des Upgrades weiter (B4).', hotbuild=('Bau', 'Q'), icon='struct_mass_t1',
  parts=P('hull@sockel ring:team@kranz stack:glow*tilt@pumpenkopf'),
  kitbash='Ring um den Spot, zentraler glühender Pumpenkopf (Pumpentakt-Animation), niedrig.')

U(id='core:str_t2_mex', de='Zapfstelle II', en='Tap II', roleDe='Massebohrung', roleEn='Mass Extractor', tech=2, group='eco',
  visual='v_mex', ms='MS8', msNote='B4 (T1→T2) in MS8', ms9=True, faRef='UEB1202', faRole='T2 Mass Extractor (Upgrade-Kosten)',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH2', 'SIZE4'], buildableBy=ENG_T2 + ' | UPGRADE',
  mass=900, energy=5400, bt=900, bp=15, hp=2100, footprint=[2, 2], vision=20,
  eco=dict(massPerSec=6, upkeepEnergyPerSec=9), weapons=[],
  upgradesTo='core:str_t3_mex', upgradeFrom='core:str_t1_mex',
  adjacency='Fabriken −10 % Mass-Verbrauch; +12,5 % je Erzspeicher.',
  special='Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Geselle/Meister baubar.', hotbuild=('Bau', 'Q (Upgrade: Command Card)'),
  icon='struct_mass_t2', parts=P('hull@sockel ring:team@kranz stack:glow*tilt@pumpenkopf hull@schuerze_l hull@schuerze_r'),
  kitbash='Zapfstelle auf 2×2 (Höhe ×1,2) mit Schürzenplatten, 2 Tech-Streifen.')

U(id='core:str_t3_mex', de='Zapfstelle III', en='Tap III', roleDe='Massebohrung', roleEn='Mass Extractor', tech=3, group='eco',
  visual='v_mex', ms='MS13', msNote='Rest B4 (T3-Mex) in MS13', ms9=False, faRef='UEB1302', faRole='T3 Mass Extractor (Upgrade-Kosten)',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSEXTRACTION', 'TECH3', 'SIZE4'], buildableBy=ENG_T3 + ' | UPGRADE',
  mass=4500, energy=31000, bt=2900, hp=7000, footprint=[2, 2], vision=20,
  eco=dict(massPerSec=18, upkeepEnergyPerSec=54), weapons=[], upgradeFrom='core:str_t2_mex',
  adjacency='Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Erzspeicher.',
  special='Upgrade-Kosten.', hotbuild=('Bau', 'Q (Upgrade: Command Card)'), icon='struct_mass_t3',
  parts=P('hull@sockel ring:team@kranz ring@zweiter_kranz stack:glow*tilt@pumpenkopf hull@schuerze_l hull@schuerze_r'),
  kitbash='Zapfstelle auf 2×2 (Höhe ×1,4), doppelter Kranz, 3 Tech-Streifen; kein Heckschlot (unterscheidet sich so von der Dampfquelle).')

U(id='core:str_t1_pgen', de='Glutkessel I', en='Ember Boiler I', roleDe='Kraftwerk', roleEn='Power Generator', tech=1, group='eco',
  visual='v_pgen', ms='MS4', msNote='E6 in MS4', ms9=True, faRef='UEB1101', faRole='T1 Power Generator',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=75, energy=750, bt=125, hp=620, footprint=[2, 2], vision=None, eco=dict(energyPerSec=20), weapons=[],
  death=dict(ref='core:wpn_boiler_burst_t1', damage=250, radius=2, note='K14, Kettenreaktion-Golden MS10'),
  adjacency='Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Glutspeicher (SIZE4).',
  special='Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA).', hotbuild=('Bau', 'W'), icon='struct_energy_t1',
  parts=P('hull@sockel boiler:team stack:glow@krone'),
  kitbash='Liegender Kessel mit einem Schlot (Zahl der Schlote = Tech, Schlothöhe ≥ 1,5 × Kessel-Ø), glühende Krone, Ruß-Gradient.')

U(id='core:str_t2_pgen', de='Glutkessel II', en='Ember Boiler II', roleDe='Kraftwerk', roleEn='Power Generator', tech=2, group='eco',
  visual='v_pgen', ms='MS8', msNote='E6-Tech-Leiter mit T2-Engineer (MS8); KI-Tech bis T2 in MS9', ms9=True,
  faRef='UEB1201', faRole='T2 Power Generator',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH2', 'SIZE12'], buildableBy=ENG_T2,
  mass=1200, energy=12000, bt=2200, hp=2600, footprint=[6, 6], vision=20, eco=dict(energyPerSec=500), weapons=[],
  death=dict(ref='core:wpn_boiler_burst_t2', damage=1500, radius=5, note='K14'),
  adjacency='Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Glutspeicher (SIZE12).', special='—', hotbuild=('Bau', 'W'), icon='struct_energy_t2',
  parts=P('hull@sockel boiler:team stack:glow@krone stack:glow@krone hull@schuerze'),
  kitbash='Kessel auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Schloten, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.')

U(id='core:str_t3_pgen', de='Glutkessel III', en='Ember Boiler III', roleDe='Kraftwerk', roleEn='Power Generator', tech=3, group='eco',
  visual='v_pgen', ms='MS13', msNote='T3-Pgen-Nachlieferung in MS13', ms9=False, faRef='UEB1301', faRole='T3 Power Generator',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'TECH3', 'SIZE16'], buildableBy=ENG_T3,
  mass=3200, energy=57000, bt=6800, hp=9000, footprint=[8, 8], vision=20, eco=dict(energyPerSec=2500), weapons=[],
  death=dict(ref='core:wpn_boiler_burst_t3', damage=5000, radius=10, note='K14; FA 5500'),
  adjacency='Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Glutspeicher (SIZE16).', special='—', hotbuild=('Bau', 'W'), icon='struct_energy_t3',
  parts=P('hull@sockel boiler:team stack:glow stack:glow stack:glow hull@schuerze_l hull@schuerze_r'),
  kitbash='Kessel auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Schloten, 3 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.')

U(id='core:str_t1_hydro', de='Dampfquelle', en='Vent Cap', roleDe='Dampfkraftwerk', roleEn='Geothermal Plant', tech=1, group='eco',
  visual='v_hydro', ms='MS10', msNote='E9 in MS10; als Daten-Vorgriff im MS9-Kern (nur Spot-Regel wie E5)', ms9=True,
  faRef='UEB1102', faRole='T1 Hydrocarbon Power Plant',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYPRODUCTION', 'HYDROCARBON', 'TECH1', 'SIZE12'], buildableBy=ENG_T1,
  mass=160, energy=800, bt=400, hp=1800, footprint=[6, 6], vision=None, eco=dict(energyPerSec=100), weapons=[],
  adjacency='Wie Glutkessel II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Glutspeicher (SIZE12).', special='Nur auf Hydro-Spots; keine Death-Weapon (wie FA).',
  hotbuild=('Bau', 'E'), icon='struct_hydro_t1',
  parts=P('hull@sockel ring:team stack:glow stack:glow stack:glow'),
  kitbash='Ring mit drei stehenden Schloten darin.')

U(id='core:str_t1_mstore', de='Erzspeicher', en='Ore Silo', roleDe='Massespeicher', roleEn='Mass Storage', tech=1, group='eco',
  visual='v_mstore', ms='MS10', msNote='E10 in MS10; Daten-Vorgriff im MS9-Kern (E4-Speicherlimit existiert ab MS4)', ms9=True,
  faRef='UEB1106', faRole='T1 Mass Storage',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSSTORAGE', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=200, energy=1500, bt=250, hp=850, footprint=[2, 2], vision=None, eco=dict(storageMass=500), weapons=[],
  adjacency='+12,5 % Produktion je angrenzender Zapfstelle (FA-Relation, max. 4 Seiten = +50 %).',
  special='Keine Death-Weapon.', hotbuild=('Bau', 'R'), icon='struct_mstore_t1',
  parts=P('hull@sockel hull:team@stapel hull@stapel'),
  kitbash='Niedriger eckiger Stapel (Mass = eckig), kein Schlot.')

U(id='core:str_t1_estore', de='Glutspeicher', en='Heat Bank', roleDe='Energiespeicher', roleEn='Energy Storage', tech=1, group='eco',
  visual='v_estore', ms='MS6', msNote='Abstich (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10', ms9=True,
  faRef='UEB1105', faRole='T1 Energy Storage',
  cats=['STRUCTURE', 'ECONOMIC', 'ENERGYSTORAGE', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=250, energy=1200, bt=200, hp=520, footprint=[2, 2], vision=None, eco=dict(storageEnergy=10000), weapons=[],
  death=dict(ref='core:wpn_heatbank_burst', damage=1000, radius=5, note='K14'),
  adjacency='Bufft alle angrenzenden Energieproduzenten (FA-Relation): Glutkessel I +25 % (SIZE4), Glutkessel II und Dampfquelle +8,3 % (SIZE12), Glutkessel III +6,25 % (SIZE16).',
  special='—', hotbuild=('Bau', 'T'), icon='struct_estore_t1',
  parts=P('hull@sockel boiler:team@trommel_stehend boiler@trommel_stehend'),
  kitbash='Zwei stehende, flache Trommeln (Ø 0,8 × Kante, Höhe ≤ 0,3 × Kante; Energy = rund), kein liegender Kessel, kein Schlot.')

# ---------------------------------------------------------------- Fabriken
FAC_ADJ = 'Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).'
U(id='core:str_t1_fac_land', de='Landwerk I', en='Land Works I', roleDe='Landfabrik', roleEn='Land Factory', tech=1, group='fac',
  visual='v_fac_land', ms='MS6', msNote='B3 in MS6', ms9=True, faRef='UEB0101', faRole='T1 Land Factory',
  cats=['STRUCTURE', 'FACTORY', 'LAND', 'TECH1', 'SIZE16'], buildableBy=ENG_T1,
  mass=240, energy=2100, bt=300, bp=20, hp=4200, footprint=[8, 8], vision=20, eco=dict(storageMass=80), weapons=[],
  upgradesTo='core:str_t2_fac_land', adjacency=FAC_ADJ,
  special='Queue/Repeat/Rally (B3). Upgrade-Verb „Freisprechen“.', hotbuild=('Bau', 'A'), icon='struct_fac_land_t1',
  parts=P('hull@sockel hull:team@wand_l hull:team@wand_r hull:team@dach hull@rampe hull:glow*tilt@werkhallentor'),
  kitbash='U-Portal mit Rampe (offene Seite = Ausgang), glühendes Werkhallentor.')

U(id='core:str_t2_fac_land', de='Landwerk II', en='Land Works II', roleDe='Landfabrik', roleEn='Land Factory', tech=2, group='fac',
  visual='v_fac_land', ms='MS8', msNote='U5 in MS8', ms9=True, faRef='UEB0201', faRole='T2 Land Factory HQ (Upgrade-Kosten)',
  cats=['STRUCTURE', 'FACTORY', 'LAND', 'TECH2', 'SIZE16'], buildableBy='UPGRADE',
  mass=1400, energy=11000, bt=2300, bp=40, hp=8200, footprint=[8, 8], vision=20, eco=dict(storageMass=160), weapons=[],
  upgradesTo='core:str_t3_fac_land', upgradeFrom='core:str_t1_fac_land', adjacency=FAC_ADJ,
  special='Nur per Upgrade (kein HQ/Support-System, B9 Post-MVP).', hotbuild=('Bau', 'Upgrade (Command Card)'),
  icon='struct_fac_land_t2',
  parts=P('hull@sockel hull:team@wand_l hull:team@wand_r hull:team@dach hull@rampe hull:glow*tilt@werkhallentor stack@schlot'),
  kitbash='Landwerk ×1,3 mit Schlot, 2 Tech-Streifen.')

U(id='core:str_t3_fac_land', de='Landwerk III', en='Land Works III', roleDe='Landfabrik', roleEn='Land Factory', tech=3, group='fac',
  visual='v_fac_land', ms='MS13', msNote='U5 T3 / U10 in MS13', ms9=False, faRef='UEB0301', faRole='T3 Land Factory HQ (Upgrade-Kosten)',
  cats=['STRUCTURE', 'FACTORY', 'LAND', 'TECH3', 'SIZE16'], buildableBy='UPGRADE',
  mass=5200, energy=47000, bt=12000, bp=90, hp=16000, footprint=[8, 8], vision=20, eco=dict(storageMass=320), weapons=[],
  upgradeFrom='core:str_t2_fac_land', adjacency=FAC_ADJ, special='Nur per Upgrade.',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_fac_land_t3',
  parts=P('hull@sockel hull:team@wand_l hull:team@wand_r hull:team@dach hull@rampe hull:glow*tilt@werkhallentor stack stack hull@schuerze'),
  kitbash='Landwerk ×1,7 mit zwei Schloten und Schürze, 3 Tech-Streifen (9 Parts = Struktur-Maximum).')

U(id='core:str_t1_fac_air', de='Luftwerk I', en='Air Works I', roleDe='Luftfabrik', roleEn='Air Factory', tech=1, group='fac',
  visual='v_fac_air', ms='MS12', msNote='Luftfabrik T1→T2 in MS12', ms9=False, faRef='UEB0102', faRole='T1 Air Factory',
  cats=['STRUCTURE', 'FACTORY', 'AIR', 'TECH1', 'SIZE16'], buildableBy=ENG_T1,
  mass=210, energy=2400, bt=300, bp=20, hp=4200, footprint=[8, 8], vision=20, eco=dict(storageMass=80), weapons=[],
  upgradesTo='core:str_t2_fac_air', adjacency=FAC_ADJ, special='Baut keine Engineers (wie FA).',
  hotbuild=('Bau', 'S'), icon='struct_fac_air_t1',
  parts=P('hull@sockel hull:team@wand_l hull:team@wand_r hull:team@dach ring@landescheibe hull:glow*tilt@werkhallentor'),
  kitbash='U-Portal mit Landescheibe statt Rampe.')

U(id='core:str_t2_fac_air', de='Luftwerk II', en='Air Works II', roleDe='Luftfabrik', roleEn='Air Factory', tech=2, group='fac',
  visual='v_fac_air', ms='MS12', msNote='MS12', ms9=False, faRef='UEB0202', faRole='T2 Air Factory HQ (Upgrade-Kosten)',
  cats=['STRUCTURE', 'FACTORY', 'AIR', 'TECH2', 'SIZE16'], buildableBy='UPGRADE',
  mass=920, energy=17500, bt=2300, bp=40, hp=8200, footprint=[8, 8], vision=20, eco=dict(storageMass=160), weapons=[],
  upgradeFrom='core:str_t1_fac_air', adjacency=FAC_ADJ, special='Nur per Upgrade; kein T3-Luftwerk (U12 Post-MVP).',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_fac_air_t2',
  parts=P('hull@sockel hull:team@wand_l hull:team@wand_r hull:team@dach ring@landescheibe hull:glow*tilt@werkhallentor stack@schlot'),
  kitbash='Luftwerk ×1,3 mit Schlot, 2 Tech-Streifen.')

# ---------------------------------------------------------------- Verteidigung
U(id='core:str_t1_pd', de='Riegel I', en='Bolt I', roleDe='Punktverteidigung', roleEn='Point Defense', tech=1, group='def',
  visual='v_pd', ms='MS8', msNote='B5 in MS8; Minimal-A8 der KI in MS9', ms9=True, faRef='UEB2101', faRole='T1 Point Defense',
  cats=['STRUCTURE', 'DEFENSE', 'DIRECTFIRE', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=240, energy=2000, bt=250, hp=1350, footprint=[1, 1], vision=24,
  weapons=[W('core:wpn_bolt_cannon_t1', 'Glockenkanone (Turm)', 50, 0.3, 26, 'linear', mv=35)],
  special='Dieselbe Glocke wie der Panzer, auf Sockel.', hotbuild=('Bau', 'Z'), icon='struct_direct_t1',
  parts=P('hull@sockel bell:team*yaw barrel*pitch'),
  kitbash='Gefaster Gusssockel, Glocke mit waagerechtem Rohr.')

U(id='core:str_t2_pd', de='Riegel II', en='Bolt II', roleDe='Punktverteidigung', roleEn='Point Defense', tech=2, group='def',
  visual='v_pd', ms='MS8', msNote='B5 (T2) in MS8', ms9=True, faRef='UEB2301', faRole='T2 Point Defense',
  cats=['STRUCTURE', 'DEFENSE', 'DIRECTFIRE', 'TECH2', 'SIZE4'], buildableBy=ENG_T2,
  mass=520, energy=3700, bt=700, hp=2400, footprint=[2, 2], vision=28,
  weapons=[W('core:wpn_bolt_cannon_t2', 'Doppel-Glockenkanone (Turm)', 100, 1.6, 48, 'linear', salvo=2, splash=1.5, mv=35)],
  special='Kein Upgrade von Riegel I (wie FA; B8 generisch ist Post-MVP).', hotbuild=('Bau', 'Z'), icon='struct_direct_t2',
  parts=P('hull@sockel bell:team*yaw barrel barrel hull@schuerze'),
  kitbash='Riegel ×1,3, breitere Glocke, zwei Rohre, 2 Tech-Streifen.')

U(id='core:str_t1_aa', de='Rost I', en='Grate I', roleDe='Flugabwehrturm', roleEn='AA Tower', tech=1, group='def',
  visual='v_aa_struct', ms='MS8', msNote='B5 in MS8, Wirkung MS12', ms9=True, faRef='UEB2104', faRole='T1 Anti-Air Turret',
  cats=['STRUCTURE', 'DEFENSE', 'ANTIAIR', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=150, energy=1500, bt=190, hp=820, footprint=[1, 1], vision=24,
  weapons=[W('core:wpn_grate_aa_t1', 'Zwillings-Flugabwehr', 20, 0.6, 42, 'linear (Vorhalt)', salvo=2, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Bau', 'X'), icon='struct_aa_t1',
  parts=P('hull@sockel grate:team*yaw barrel barrel'),
  kitbash='Sockel mit Rost-Platte und 2 senkrechten Rohren.')

U(id='core:str_t2_aa', de='Rost II', en='Grate II', roleDe='Flakturm', roleEn='Flak Tower', tech=2, group='def',
  visual='v_aa_struct', ms='MS8', msNote='B5 (T2) in MS8, Näherungszünder MS12', ms9=True, faRef='UEB2204',
  faRole='T2 Anti-Air Flak Artillery',
  cats=['STRUCTURE', 'DEFENSE', 'ANTIAIR', 'TECH2', 'SIZE4'], buildableBy=ENG_T2,
  mass=400, energy=4000, bt=550, hp=2600, footprint=[2, 2], vision=24,
  weapons=[W('core:wpn_grate_flak_t2', 'Splitterflak (Turm)', 90, 0.5, 48, 'linear + Näherungszünder (MS12)', splash=3.5, mv=35, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Bau', 'X'), icon='struct_aa_t2',
  parts=P('hull@sockel grate:team*yaw barrel barrel barrel hull@schuerze'),
  kitbash='Rost ×1,3 mit 3 Rohren, 2 Tech-Streifen.')

U(id='core:str_t3_sam', de='Hochrost', en='High Grate', roleDe='Raketenabwehr', roleEn='SAM Site', tech=3, group='def',
  visual='v_aa_struct', ms='MS8', msNote='MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Meister)',
  ms9=True, faRef='UEB2304', faRole='T3 Anti-Air SAM Launcher',
  cats=['STRUCTURE', 'DEFENSE', 'ANTIAIR', 'TECH3', 'SIZE4'], buildableBy=ENG_T3,
  mass=800, energy=8000, bt=1400, hp=5000, footprint=[2, 2], vision=28,
  weapons=[W('core:wpn_high_grate_sam_t3', 'Glutraketen-Flugabwehr', 200, 3.5, 58, 'homing + Näherungszünder', salvo=6, splash=1.5, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Bau', 'X'), icon='struct_sam_t3',
  parts=P('hull@sockel grate:team*yaw barrel barrel barrel barrel'),
  kitbash='Rost auf 2×2 mit doppelt so vielen, dickeren Rohren (4), 3 Tech-Streifen; kein Schlot (Glut-Monopol).')

U(id='core:str_t1_wall', de='Mauer', en='Wall', roleDe='Mauer', roleEn='Wall', tech=1, group='def',
  visual='v_wall', ms='MS8', msNote='B5/Minimal-Drag (DECISIONS 3) in MS8', ms9=True, faRef='UEB5101', faRole='Wall Section',
  cats=['STRUCTURE', 'DEFENSE', 'WALL', 'TECH1'], buildableBy=ENG_T1,
  mass=3, energy=20, bt=15, hp=550, footprint=[1, 1], vision=0, weapons=[],
  special='wall-Flag (Drag-Linie), blockiert Schüsse und Pathing.', hotbuild=('Bau', 'C'), icon='wall',
  parts=P('hull:team@oberkante'),
  kitbash='Niedriger Quader, nur die Oberkante teamfarben (≈ 10 %).')

# ---------------------------------------------------------------- Intel & Schilde
U(id='core:str_t1_radar', de='Horcher I', en='Listener I', roleDe='Radar', roleEn='Radar', tech=1, group='intel',
  visual='v_radar', ms='MS10', msNote='I3 in MS10', ms9=False, faRef='UEB3101', faRole='T1 Radar System',
  cats=['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH1', 'SIZE4'], buildableBy=ENG_T1,
  mass=80, energy=720, bt=80, bp=13, hp=11, footprint=[2, 2], vision=20, radar=116,
  eco=dict(upkeepEnergyPerSec=20), weapons=[], toggles=['radar (MS10, C17)'], upgradesTo='core:str_t2_radar',
  special='Stall schaltet ab (E3), Wiedereinschalten mit Hysterese. Sehr fragil (FA-Relation).',
  hotbuild=('Bau', 'D'), icon='struct_intel_t1',
  parts=P('hull@sockel mast wing:team*yaw@radarplatte'),
  kitbash='Hoher dünner Mast mit rechteckiger Radarplatte (wing-Prisma 1,6 × 0,8 × 0,1 WU, 35° gekippt), rotierend; kein Ring (Ring = Flow/Schild).')

U(id='core:str_t2_radar', de='Horcher II', en='Listener II', roleDe='Radar', roleEn='Radar', tech=2, group='intel',
  visual='v_radar', ms='MS10', msNote='I3 T1→T2 in MS10', ms9=False, faRef='UEB3201', faRole='T2 Radar System (Upgrade-Kosten)',
  cats=['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH2', 'SIZE4'], buildableBy='UPGRADE',
  mass=180, energy=3600, bt=780, bp=20, hp=55, footprint=[2, 2], vision=24, radar=200,
  eco=dict(upkeepEnergyPerSec=150), weapons=[], toggles=['radar (MS10, C17)'],
  upgradesTo='core:str_t3_radar', upgradeFrom='core:str_t1_radar', special='Nur per Upgrade.',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_intel_t2',
  parts=P('hull@sockel mast mast wing:team*yaw@radarplatte'),
  kitbash='Horcher auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.')

U(id='core:str_t3_radar', de='Horcher III', en='Listener III', roleDe='Radar', roleEn='Radar', tech=3, group='intel',
  visual='v_radar', ms='MS13', msNote='Rest I3 (T3-Radar) in MS13', ms9=False,
  faRef='UEB3104', faRole='T3 Omni Sensor Array (Upgrade-Kosten; hier ohne Omni)',
  cats=['STRUCTURE', 'INTELLIGENCE', 'RADAR', 'TECH3', 'SIZE4'], buildableBy='UPGRADE',
  mass=1200, energy=16000, bt=1500, hp=55, footprint=[2, 2], vision=30, radar=350,
  eco=dict(upkeepEnergyPerSec=400), weapons=[], toggles=['radar (MS10, C17)'], upgradeFrom='core:str_t2_radar',
  special='Kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation. Unterhalt 400 E/s (FA 2.000 mit Omni): r350 bringt auf 256–512-WU-Karten nur begrenzt mehr als Horcher II.',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_intel_t3',
  parts=P('hull@sockel mast mast wing:team*yaw@radarplatte wing@zweite_platte'),
  kitbash='Horcher auf 2×2 (Höhe ×1,4) mit zweiter Radarplatte, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')

U(id='core:str_t2_shield', de='Schirm II', en='Canopy II', roleDe='Schildgenerator', roleEn='Shield Generator', tech=2, group='intel',
  visual='v_shield', ms='MS13', msNote='K10 in MS13', ms9=False, faRef='UEB4202', faRole='T2 Shield Generator',
  cats=['STRUCTURE', 'SHIELD', 'DEFENSE', 'TECH2', 'SIZE12'], buildableBy=ENG_T2,
  mass=600, energy=6000, bt=1150, bp=20, hp=280, footprint=[6, 6], vision=20,
  shield=dict(hp=9000, radius=24, regenPerSec=110, regenStartS=3, rechargeS=25, upkeepEnergyPerSec=200),
  eco=dict(upkeepEnergyPerSec=200), weapons=[], toggles=['shield (MS13, C17)'], upgradesTo='core:str_t3_shield',
  special='Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab. Vergleich über HP+Schild.',
  hotbuild=('Bau', 'F'), icon='struct_shield_t2',
  parts=P('hull@sockel boiler mast ring:team*yaw@waagerecht'),
  kitbash='Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), Generator-Kessel am Fuß.')

U(id='core:str_t3_shield', de='Schirm III', en='Canopy III', roleDe='Schildgenerator', roleEn='Shield Generator', tech=3, group='intel',
  visual='v_shield', ms='MS13', msNote='K10 in MS13', ms9=False, faRef='UEB4301', faRole='T3 Heavy Shield Generator (Upgrade-Kosten)',
  cats=['STRUCTURE', 'SHIELD', 'DEFENSE', 'TECH3', 'SIZE12'], buildableBy='UPGRADE',
  mass=3200, energy=52000, bt=5000, hp=520, footprint=[6, 6], vision=20,
  shield=dict(hp=17000, radius=40, regenPerSec=130, regenStartS=1, rechargeS=25, upkeepEnergyPerSec=400),
  eco=dict(upkeepEnergyPerSec=400), weapons=[], toggles=['shield (MS13, C17)'], upgradeFrom='core:str_t2_shield',
  special='Nur per Upgrade.', hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_shield_t3',
  parts=P('hull@sockel boiler mast ring:team*yaw@waagerecht ring@zweiter_ring hull@schuerze'),
  kitbash='Schirm auf 6×6 (Höhe ×1,4/1,2) mit zweitem Ring und Schürze, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')

# ---------------------------------------------------------------- Artillerie-Stellungen
U(id='core:str_t2_arty', de='Tiegel', en='Crucible', roleDe='Artilleriestellung', roleEn='Artillery Emplacement', tech=2, group='arty',
  visual='v_arty_struct', ms='MS13', msNote='K13 in MS13', ms9=False, faRef='UEB2303', faRole='T2 Artillery Installation',
  cats=['STRUCTURE', 'DEFENSE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH2', 'SIZE4'], buildableBy=ENG_T2,
  mass=1800, energy=13000, bt=1600, hp=3600, footprint=[2, 2], vision=28,
  weapons=[W('core:wpn_crucible_shell_t2', 'Tiegelgranate', 2100, 21.0, 110, 'ballistisch', minr=50, splash=3, mv=26)],
  special='Artillerie-Adjacency (Kraftwerke erhöhen Feuerrate, FA-Relation) optional mit E11.', hotbuild=('Bau', 'V'),
  icon='struct_arty_t2', parts=P('hull@sockel boom*yaw ladle:team*pitch@tiegel hull@gegengewicht'),
  kitbash='Große Kelle (Tiegel) auf Schwenkarm über Sockel, Gegengewicht.')

U(id='core:str_t3_arty', de='Hochofen', en='Blast Furnace', roleDe='Schwere Artilleriestellung', roleEn='Heavy Artillery Emplacement',
  tech=3, group='arty', visual='v_arty_struct', ms='MS13', msNote='K13 + Reichweiten-Gate in MS13', ms9=False,
  faRef='UEB2302', faRole='T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert)',
  cats=['STRUCTURE', 'DEFENSE', 'INDIRECTFIRE', 'ARTILLERY', 'TECH3', 'SIZE16'], buildableBy=ENG_T3,
  mass=48000, energy=900000, bt=76700, hp=10000, footprint=[8, 8], vision=28,
  weapons=[W('core:wpn_furnace_shell_t3', 'Hochofengranate', 5500, 15.0, 200, 'ballistisch', minr=60, splash=6, mv=55)],
  special='FA-Referenz: Reichweite 825, 72.000 Mass, 5.500 Schaden alle 10 s. Hier Reichweite 200 (Gate ≤ 40 % der kleinsten Kartendiagonale ⇒ '
          'Kartenpool ≥ 354 WU), Kosten ≈ 67 %, gleicher Einzelschuss (Burst gegen Schilde: Schirm III fällt nach 5 Schüssen/60 s), Feuerrate ×2/3; '
          'DPS/Mass und HP/Mass bleiben in Relation.',
  hotbuild=('Bau', 'V'), icon='struct_arty_t3',
  parts=P('hull@sockel boom*yaw@lafette ladle:team*pitch@kelle barrel@steilrohr hull@gegengewicht'),
  kitbash='Tiegel-Silhouette auf 8×8: Lafette, Kelle Ø 3,0 WU (Team), Steilrohr 7 WU × Ø 0,6 aus der Kelle (an die Kelle geparentet), Gegengewicht; kein Schlot, 3 Tech-Streifen.')

# ---------------------------------------------------------------- Experimentals (T4, Post-MVP) – docs/design/experimentals.md
# tech=4 und group='exp'; `domain` bestimmt Bewegung/Layer. Nicht Teil des MVP (U16/U21/E17 sind Post-MVP bzw. „Später“):
# eigene Lints (Budget T4, Parts ≤ 16, animiert ≤ 8 = PartStream-Limit), eigene Visuals (kein Superset mit T1–T3).
EXP_BUILD = 'ENGINEER & TECH3'
XM = {
    'XM1': 'Mobile Großbaustelle: Meister gießen mobile T4 als Baustelle mit Footprint (blockiert Pathing wie ein Gebäude, B1/B6), die bei 100 % zur Einheit wird und ausläuft (FA: NEEDMOBILEBUILD). '
            'Platzierung nur, wenn der Footprint in der Clearance-Komponente (Land, sizeClass) der Hauptfläche liegt (kein T4 im Basis-Kessel); '
            'Baustellen < 100 % haben keine Todeswaffe, ihr Wrack trägt 90 % der verbauten Mass',
    'XM2': 'Massiv/Crush: kleinere Einheiten blockieren nicht (Steering-Priorität nach sizeClass, M7), werden beiseitegeschoben; Mauern und Wracks unter dem Footprint werden überrollt; '
            'Fußtritt-Schaden je Schritt (FA: Footfall-Damage) im festen Sim-Takt (12 Ticks, Fuß abwechselnd), im Tick vor der Kollisionsauflösung',
    'XM3': 'Große Größenklassen: sizeClass 6–7 mit eigenen Clearance-Komponenten (M5/M6); Pfad-Klasse nach der Breite, die Länge 9 der Kokille löst das Steering (Wenden auf der Stelle, Stuck → Repath); Abnahme mit Basisgassen 7–9 WU',
    'XM4': 'Verzögerte Death-Weapon (Umkippen/Absturz, 1,5–3 s Fluchtfenster) mit Kamera-Shake und Großereignis-Effekt (P14); Selbstzerstörung nutzt dieselbe Verzögerung; Kettenreaktionen (K14) je Glied ≥ 3 Ticks versetzt',
    'XM5': 'Mobile Fabrik: Bauliste (B3) in einer mobilen Einheit, Ausgang Heckrampe, Rally relativ zum Träger; baut nur im Stand',
    'XM6': 'Strategische Reichweite: Feuern auf Radar-/Ghost-Ziele außerhalb der Sicht (baut auf I3/K6 auf), Streuung σ = max(8 WU, 1,2 % der Distanz), Einschlagwarnung für den Beschossenen ab dem Abschuss (Ring Splash + 2σ, Ansage P8)',
    'XM7': 'Bedarfsdeckende Produktion: Ertrag = Grundlast + clamp(Bedarf − Einkommen, 0, Deckel) je Eco-Tick, deterministisch nach der Stall-Auflösung (E3)',
    'XM8': 'T4-Icon: Klammer statt Tech-Kerben, Faktor 1,5 (content/icons/grammar.ts), Zeichenreihenfolge über T1–T3, Mesh bleibt länger vor dem Icon sichtbar (C2)',
    'XM9': 'Großguss-Meldung: sieht ein Haus eine fremde T4-Baustelle (Sicht, nicht Radar), meldet die Ansage „Großguss gesichtet“ (P8); ab 75 % Baufortschritt zusätzlich Minimap-Ping (C16). '
            'Konverter-Baustellen melden sich ab 50 % allen Gegnern auch ohne Sicht (Ping mit 40 WU Unschärfe, „Großguss-Signatur“)',
}

U(id='core:exp_lnd_walker', de='Stampfe', en='Stamper', roleDe='Experimenteller Sturmläufer', roleEn='Experimental Assault Walker', tech=4,
  group='exp', domain='land', visual='v_exp_walker', ms='PM1', msNote='Post-MVP: U16 „Erstes Land-Experimental“', ms9=False,
  faRef='UAL0401', faCross='XSL0401', faRole='Experimental Assault Bot (Riesen-Laufroboter)',
  cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'BOT', 'EXPERIMENTAL'], buildableBy=EXP_BUILD,
  mass=27000, energy=340000, bt=51000, hp=96000, regen=10,
  weapons=[W('core:wpn_stamper_twin_bell', 'Doppelglocke (zwei Schulterkanonen, abwechselnd)', 500, 0.4, 40, 'linear', salvo=2, minr=2, splash=1.0, mv=45),
           W('core:wpn_stamper_footfall', 'Stampfen (Fußtritt beim Aufsetzen, Crush)', 3000, 1.2, 1.2, 'fußtritt', splash=1.2,
             extra='XM2; trifft nur Land-Einheiten unter dem Fuß (kein Friendly Fire, FA-Relation Footfall 3500 r1); nicht in DPS/Mass gewertet')],
  compareDpsIdx=[0], faDpsIdx=[0, 1, 2],
  speed=2.4, turn=40, accel=1.2, sizeClass=6, footprint=[6, 6], vision=50,
  death=dict(ref='core:wpn_stamper_break', damage=8000, radius=7, delayS=2.0,
             note='Gussbruch: kippt in Laufrichtung, Explosion nach 2,0 s (XM4), Friendly Fire (K8); FA-Relation 8000 r7'),
  special='Reiner Nahkampf-Koloss ohne Flugabwehr: Konter sind Luft (Krähe, Elster, Kolkrabe), Hochofen-/Pfannen-Beschuss auf Abstand und '
          'Reißnadel-Pulks. Regeneration 10 HP/s. Nicht amphibisch (Layer Land; Amphibious erst mit U17), Wasser nur über Brücken. '
          'Wrack 90 % Mass (24.300) – „Schlacke ist auch Erz“.',
  hotbuild=('Großguss', 'Q'), icon='land_bot_t4',
  parts=P('legs*legs@bein_l legs*legs@bein_r hull@becken hull:team*yaw@torso bell:team@schulter_l bell:team@schulter_r '
          'barrel*pitch@rohr_l barrel*pitch@rohr_r boiler@rueckenkessel hull@stampffuss_l hull@stampffuss_r hull:ceramic@klammer'),
  kitbash='Zweibeiniger Stampfkoloss, Höhe ≈ 6,3 WU (2,6× Vogt): breite Torso-Wanne (team) auf zwei Säulenbeinen mit runden Stampffüßen '
          '(Ø 1,6 WU), zwei Schulterglocken mit waagerechten Rohren (Direktfeuer-Monopol), liegender Rückenkessel als Gegengewicht. '
          'Keramik-Klammer (zwei Winkelleisten an den Deckkanten) statt Tech-Streifen. Kein Schlot, kein Lot-Kopf (Vogt-Monopol).',
  exp=dict(features=['U16', 'B2', 'B1', 'B6', 'M5', 'M6', 'M7', 'K4', 'K5', 'K8', 'P14', 'A16', 'C2'], newMechanics=['XM1', 'XM2', 'XM3', 'XM4', 'XM8', 'XM9'],
           crush=dict(walls=True, wrecks=True, pushSizeClassMax=3, footfallDamage=3000, footfallRadius=1.2, friendly=False),
           counters=['Luft (Krähe, Elster, Kolkrabe) – keine Flugabwehr', 'Artillerie auf Abstand (Pfanne 85 WU, Hochofen 200 WU) gegen Tempo 2,4',
                     'Reißnadel-Pulks auf 58 WU (gleiches Tempo 2,4: Abstand halten braucht Mikro)', 'Baustelle früh angreifen (XM9)'],
           compareNote='FA-DPS = Strahl 2.500 + Greifer 0,04 (ohne Todeswaffe); Stampfen nicht gewertet (FA-Footfall ebenfalls nicht in spooky-DPS)',
           t3Equivalent=dict(unit='core:lnd_t3_bot', faT4='UAL0401', faT3='UEL0303')))

U(id='core:exp_lnd_foundry', de='Kokille', en='Mould', roleDe='Mobile Gießhalle', roleEn='Mobile Foundry', tech=4,
  group='exp', domain='land', visual='v_exp_foundry', ms='PM2', msNote='Post-MVP: U21 (Teil Land) + mobile Fabrik', ms9=False,
  faRef='UEL0401', faCross='XRL0403', faRole='Experimental Mobile Factory (mobile Fabrik/Festung)',
  cats=['LAND', 'MOBILE', 'FACTORY', 'DIRECTFIRE', 'INDIRECTFIRE', 'ANTIAIR', 'SHIELD', 'EXPERIMENTAL'], buildableBy=EXP_BUILD,
  mass=28000, energy=350000, bt=47500, bp=135, hp=13000, regen=20,
  shield=dict(hp=20000, radius=24, regenPerSec=100, regenStartS=1, rechargeS=120, upkeepEnergyPerSec=600),
  eco=dict(upkeepEnergyPerSec=600, storageMass=200, storageEnergy=1000),
  weapons=[W('core:wpn_foundry_ladle', 'Deckskellen (drei Schlackenwerfer, gemeinsame Salve)', 250, 1.0, 100, 'ballistisch', salvo=3, splash=1.5, mv=25),
           W('core:wpn_foundry_bell', 'Flankenglocken (Schnellfeuer, zwei Türme)', 150, 0.6, 45, 'linear', salvo=2, mv=60),
           W('core:wpn_foundry_aa', 'Rostkamm (Flak)', 40, 0.7, 45, 'linear', mv=90, layers=('air',))],
  faDpsIdx=[0, 1, 2],
  speed=1.75, turn=30, accel=1.0, sizeClass=7, footprint=[7, 9], vision=32,
  toggles=['shield (C17)'],
  death=dict(ref='core:wpn_foundry_burst', damage=4000, radius=7, delayS=1.5, note='Kesselbruch (XM4), Friendly Fire (K8); FA-Relation 4000 r7'),
  special='Mobile Fabrik mit der Bauliste von Landwerk III (Build Power 135 wie FA), Personal-Kuppel 20.000 HP (Radius 24, deckt Begleiter). '
          'Baut nur im Stand, Ausgang über die Heckrampe (XM5), kein Assist auf fremde Baustellen. Kein Torpedo (Marine Post-MVP): FA-Vergleich ohne Anti-Navy-Waffe.',
  hotbuild=('Großguss', 'E'), icon='land_fac_land_t4',
  parts=P('tracks@kette_l tracks@kette_r hull@wanne hull:team@deck hull@portal stack:glow@schlot_l stack:glow@schlot_r '
          'ladle:team*yaw@kelle_l ladle:team*yaw@kelle_r bell:team*yaw@glocke_l bell:team*yaw@glocke_r grate:team*yaw@rostkamm '
          'mast@schildmast ring:team*spin@schildring hull:ceramic@klammer'),
  kitbash='Rollende Gießhalle auf vier Kettenblöcken (7 × 9 WU): U-Portal (Fabrik-Monopol) mit glühendem Werkhallentor und Heckrampe, '
          'zwei Schlote (FACTORY = Flow-Einheit), vorn zwei Deckskellen (Artillerie), seitlich zwei Glocken (Direktfeuer), am Heck ein '
          'Rostkamm (Flak), mittig Schildmast mit waagerechtem Ring als höchstem Punkt. Keramik-Klammer an den Deckkanten.',
  exp=dict(features=['U21', 'U5', 'B3', 'K10', 'K2', 'K4', 'K12', 'M5', 'M6', 'M7', 'C17', 'E3', 'P14', 'A16', 'C2'],
           newMechanics=['XM1', 'XM2', 'XM3', 'XM4', 'XM5', 'XM8', 'XM9'],
           crush=dict(walls=True, wrecks=True, pushSizeClassMax=3, footfallDamage=None, footfallRadius=None, friendly=False),
           counters=['Energy-Stall (600 E/s Unterhalt, E3) schaltet die Kuppel ab', 'Konzentrierter Direktbeschuss (Stampfe, Fallhammer-Pulk) unter die Kuppel',
                     'Bomber nach Kuppel-Kollaps (Flak nur 57 DPS)', 'Baut nur im Stand – dann treffen Hochofen und Konverter sicher (2 Konverter-Treffer brechen die Kuppel, der dritte zerstört die Kokille)'],
           compareNote='FA-DPS = Artillerie 750 + Riot 500 + Flak 57,14 (ohne Torpedo 75, Marine Post-MVP)',
           t3Equivalent=dict(unit='core:lnd_t3_bot', faT4='UEL0401', faT3='UEL0303')))

U(id='core:exp_air_gunship', de='Kolkrabe', en='Raven', roleDe='Experimenteller Kampfschweber', roleEn='Experimental Gunship', tech=4,
  group='exp', domain='air', visual='v_exp_gunship', ms='PM2', msNote='Post-MVP: U21 (Luft-Experimental); ohne T3-Luft (U12) baubar', ms9=False,
  faRef='URA0401', faCross='UAA0310', faRole='Experimental Gunship (Luft-Experimental)',
  cats=['AIR', 'MOBILE', 'GUNSHIP', 'DIRECTFIRE', 'ANTIAIR', 'EXPERIMENTAL'], buildableBy=EXP_BUILD,
  mass=29000, energy=800000, bt=48000, hp=74000, regen=70,
  eco=dict(upkeepEnergyPerSec=600),
  weapons=[W('core:wpn_raven_bells', 'Hängeglocken (zwei schwere Schnellfeuer-Kanonen)', 320, 0.7, 30, 'linear', salvo=2, splash=3, mv=30),
           W('core:wpn_raven_rockets', 'Rumpfraketen (Dreiersalve)', 200, 2.0, 30, 'linear', salvo=3, mv=35),
           W('core:wpn_raven_aa', 'Flakkamm (Luftabwehr-Raketen)', 150, 2.5, 60, 'lenkflugkörper', salvo=2, mv=30, layers=('air',))],
  speed=8, turn=20, accel=None, sizeClass=0, footprint=[7, 7], vision=46,
  death=dict(ref='core:wpn_raven_crash', damage=5000, radius=8, delayS=3.0, note='Absturz (K12, XM4): trudelt 3 s, Aufschlag wie FA 5000 r8'),
  special='Schwebt tief (Flughöhe ≈ 12 WU) und langsam (8 WU/s); nur Flugabwehr trifft (K3). Landet nicht, Footprint 7×7 nur für die Baustelle. Regeneration 70 HP/s. '
          'Unterhalt 600 E/s (FA-Relation), im Energy-Stall halbe Feuerrate. Konter: Hochrost, Trommelsieb, Turmfalken-Schwärme.',
  hotbuild=('Großguss', 'S'), icon='air_direct_t4',
  parts=P('hull:team@deckscheibe ductfan:team*spin@duese_vl ductfan:team*spin@duese_vr ductfan:team*spin@duese_hl ductfan:team*spin@duese_hr '
          'bell:team*yaw@glocke_l bell:team*yaw@glocke_r barrel@rohr_l barrel@rohr_r boiler@raketenkessel barrel@flakkamm hull:ceramic@klammer'),
  kitbash='Fliegende Gussplatte ≈ 9,5 × 9,5 WU ohne Flügel (Gunship-Monopol): vier Ringdüsen im Kreuz um eine gefaste Deckscheibe (team), '
          'darunter zwei hängende Glocken mit waagerechten Rohren, Raketenkessel im Bauch, vier senkrechte Flakrohre als Kamm am Heck. '
          'Keramik-Klammer an der Deckscheibe.',
  exp=dict(features=['U21', 'U11', 'K3', 'K11', 'K12', 'K4', 'E3', 'P14', 'A16', 'C2'], newMechanics=['XM1', 'XM4', 'XM8', 'XM9'],
           crush=None,
           counters=['Hochrost (SAM) und Trommelsieb', 'Turmfalken-Schwärme (Abfangjäger)', 'Energy-Stall halbiert die Feuerrate'],
           compareNote='FA-DPS = Raketen 285 + Flak 120 + Bolter 928,57 (alle Waffen außer Absturz); FA-Tempo 9 (Air.MaxAirspeed)',
           t3Equivalent=dict(unit='core:air_t2_gunship', faT4='URA0401', faT3='UEA0203')))

U(id='core:exp_str_arty', de='Konverter', en='Converter', roleDe='Strategische Artillerie', roleEn='Strategic Artillery', tech=4,
  group='exp', domain='struct', visual='v_exp_arty', ms='PM3', msNote='Post-MVP: U21 Game-Ender', ms9=False,
  faRef='UEB2401', faCross='URL0401', faRole='Experimental Artillery (strategische Artillerie, Game-Ender)',
  cats=['STRUCTURE', 'ARTILLERY', 'INDIRECTFIRE', 'STRATEGIC', 'EXPERIMENTAL', 'SIZE20'], buildableBy=EXP_BUILD,
  mass=220000, energy=5900000, bt=300000, hp=8000,
  weapons=[W('core:wpn_converter_shell', 'Konverterguss (Schwerstgranate)', 16000, 8.0, 1500, 'ballistisch', minr=150, splash=7, mv=160,
             extra='XM6: Streuung σ = max(8 WU, 1,2 % der Distanz) (≈ 12 WU auf 1.000 WU), Flugzeit ≈ 9 s auf 1.000 WU, Einschlagwarnung ab Abschuss; Friendly Fire (K8)')],
  footprint=[10, 10], vision=28,
  special='Reichweite 1.500 WU deckt jede MVP-Karte (Setons-Diagonale 1.448 WU); FA 4.000 (bis 81-km-Karten, M14). Einzelschuss und Takt wie FA: '
          'ein Schuss knackt Schirm II allein, Schirm III nach 2 Treffern, den Mantel nach 6. Streuung mit Untergrenze 8 WU (> Splash 7): auf kurzen Distanzen '
          'kein Einheiten-Scharfschütze, ein stehender Vogt (12.000 HP) wird mit ≈ 32 % je Schuss getroffen und hört die Einschlagwarnung. '
          'Baustelle ab 50 % für alle Gegner sichtbar (XM9). Keine Death-Weapon (wie FA), Wrack 90 % Mass.',
  hotbuild=('Großguss', 'W'), icon='struct_arty_t4',
  parts=P('hull@sockel hull:team@randband boom*yaw@drehbuehne boom@wange_l boom@wange_r ladle:team*pitch@konverterbirne '
          'barrel@steilrohr hull@gegengewicht_l hull@gegengewicht_r hull:ceramic@klammer'),
  kitbash='Kippender Konverter auf 10×10: Drehbühne mit zwei Wangen, darin die birnenförmige Konverter-Kelle (Ø ≈ 5 WU, team, Artillerie-Monopol) '
          'mit Steilrohr ≈ 8 WU aus der Mündung (60°), zwei Gegengewichte; Höhe ≈ 14 WU – höchstes Bauwerk des Rosters. Keramik-Klammer am Sockel, kein Schlot.',
  exp=dict(features=['U21', 'K13', 'K2', 'K4', 'K6', 'K8', 'K10', 'I2', 'I3', 'C15', 'P8', 'P14', 'A21', 'C2'], newMechanics=['XM6', 'XM8', 'XM9'],
           crush=None,
           counters=['Mantel über der Basis (6 Treffer = 40 s bis zum Bruch)', 'Früher Angriff auf die Baustelle (300.000 BT: Sicht-Meldung XM9)',
                     'Stampfe/Kolkrabe-Vorstoß: 8.000 HP, keine Eigenverteidigung', 'Einheiten weichen dem Warnring aus (Flugzeit ≈ 9 s auf 1.000 WU)',
                     'Radar-Jamming (I5, später) verhindert Zielauflösung'],
           compareNote='FA-DPS = 16.000 / 8 s; Pulk-DPS/Mass mit Splash 7 wie FA',
           t3Equivalent=dict(unit='core:str_t3_arty', faT4='UEB2401', faT3='UEB2302')))

U(id='core:exp_str_eco', de='Tiefenstich', en='Deep Tap', roleDe='Tiefenzapfwerk', roleEn='Resource Works', tech=4,
  group='exp', domain='struct', visual='v_exp_eco', ms='PM3', msNote='Post-MVP: E17 Endgame-Eco', ms9=False,
  faRef='XAB1401', faRole='Experimental Resource Generator (Endgame-Eco)',
  cats=['STRUCTURE', 'ECONOMIC', 'MASSPRODUCTION', 'ENERGYPRODUCTION', 'EXPERIMENTAL', 'SIZE24'], buildableBy=EXP_BUILD,
  mass=245000, energy=7300000, bt=325000, hp=5200,
  eco=dict(massPerSec=20, energyPerSec=1000, storageEnergy=100000, demandMassPerSecMax=750, demandEnergyPerSecMax=75000),
  weapons=[], footprint=[12, 12], vision=20,
  death=dict(ref='core:wpn_deep_tap_break', damage=35000, radius=25, delayS=2.0,
             note='Tiefenbruch: Glutsäule bricht ein, Explosion nach 2 s (XM4), Kettenreaktion (K14), Friendly Fire; FA-Relation 35000 r25'),
  special='Grundlast 20 M/s + 1.000 E/s, darüber deckt er den Bedarf des Hauses bis 750 M/s und 75.000 E/s (XM7). FA deckelt erst bei 10.000 M/s / '
          '1.000.000 E/s (praktisch unbegrenzt); der Deckel hält ein zweites Zapfwerk sinnvoll und die Eco-Kurve im Unit-Cap. Verhältnis E:M = 100:1 wie FA.',
  hotbuild=('Großguss', 'A'), icon='struct_mass_t4',
  parts=P('hull@sockel hull:team@randband ring:team*spin@kranz_1 ring*spin@kranz_2 ring@kranz_3 mast@bohrturm boiler:glow@pumpenkopf '
          'stack:glow@schlot_1 stack:glow@schlot_2 stack:glow@schlot_3 stack:glow@schlot_4 hull:ceramic@klammer'),
  kitbash='Bohrwerk auf 12×12: drei konzentrische Kränze (Zapfstellen-Grammatik, zwei drehen gegenläufig) um einen Bohrturm mit glühendem Pumpenkopf '
          '(Glutkern), vier Eckschlote (Energy). Liest sich als „Raute + Flamme“ in Riesengröße. Keramik-Klammer am Sockel.',
  exp=dict(features=['E17', 'E1', 'E2', 'E3', 'E4', 'K14', 'K8', 'P14', 'A16', 'C10', 'C2'], newMechanics=['XM4', 'XM7', 'XM8', 'XM9'],
           crush=None,
           counters=['Nur 5.200 HP: Konverter und schon ein Hochofen (5.500) töten ihn mit einem Treffer – Standort > 200 WU hinter der Front oder unter dem Mantel',
                     'Kolkrabe-Vorstoß, Bomber', 'Todesexplosion 35.000 r25 – nicht neben Werke stellen'],
           compareNote='keine Waffen; HP/Mass-Vergleich gegen `XAB1401`',
           t3Equivalent=dict(unit='core:str_t3_mex', faT4='XAB1401', faT3='UEB1302')))

U(id='core:exp_str_shield', de='Mantel', en='Mantle', roleDe='Großschild', roleEn='Bastion Shield', tech=4,
  group='exp', domain='struct', visual='v_exp_shield', ms='PM2', msNote='Post-MVP: Varkan-Ergänzung zu U21 (Game-Ender-Konter)', ms9=False,
  faRef='UEB4301', faCross='UEL0401', faRole='T3 Heavy Shield Generator ×≈5 (FA hat kein Schild-Experimental; Relation pro Mass)',
  cats=['STRUCTURE', 'SHIELD', 'DEFENSE', 'EXPERIMENTAL', 'SIZE16'], buildableBy=EXP_BUILD,
  mass=16000, energy=260000, bt=24000, hp=2500,
  shield=dict(hp=80000, radius=60, regenPerSec=250, regenStartS=1, rechargeS=90, rechargeFraction=0.25, upkeepEnergyPerSec=2000),
  eco=dict(upkeepEnergyPerSec=2000), weapons=[], footprint=[8, 8], vision=24, toggles=['shield (C17)'],
  special='Eigene Varkan-Rolle ohne FA-T4-Vorbild: Kuppel Radius 60 (2,25× Fläche von Schirm III) mit 80.000 HP und 250 HP/s Regeneration '
          '(5 Schirm III: 650 HP/s verteilt). Der Konverter bricht sie nach 6 Treffern (40 s), ein einzelner Hochofen nach ≈ 9,5 min, zwei im Wechsel nach ≈ 2,5 min. '
          'Nach dem Kollaps 90 s offline, dann mit 25 % (20.000) zurück: gestapelte Mäntel verzögern einen Konverter, sperren ihn aber nicht dauerhaft. '
          'Unterhalt 2.000 E/s: ein Energy-Stall (E3) lässt die Kuppel sofort fallen.',
  hotbuild=('Großguss', 'F'), icon='struct_shield_t4',
  parts=P('hull@sockel hull:team@randband boiler@generator mast@hauptmast ring:team*spin@ring_oben ring*spin@ring_mitte ring@ring_unten '
          'hull:team@schuerze hull:ceramic@klammer'),
  kitbash='Schildturm auf 8×8: dicker Mast mit drei gestaffelten waagerechten Ringen (oberster = größter, Ø ≈ 8 WU, team; Schild-Monopol), '
          'Generatorkessel am Fuß, gefaltete Schürze (der „Mantel“, team), vier Strebebögen tragen den unteren Ring. Höhe ≈ 12 WU '
          '(≈ 2,7× Schirm III). Keramik-Klammer am Sockel, kein Schlot.',
  exp=dict(features=['K10', 'E3', 'C17', 'C15', 'P14', 'U21', 'A16', 'C2'], newMechanics=['XM8', 'XM9'],
           crush=None,
           counters=['Energy-Stall (2.000 E/s)', 'Einheiten laufen unter die Kuppel (Stampfe, Kokille)', 'Konverter + 2 Hochöfen im Takt',
                     'Nach dem Kollaps kehrt die Kuppel nur mit 25 % zurück (2 Konverter-Treffer)',
                     'Kuppel schützt nicht gegen Todeswaffen innerhalb'],
           compareNote='HP+Schild pro Mass gegen T3-Schildgenerator (FA-Upgradekosten)',
           t3Equivalent=dict(unit='core:str_t3_shield', faT4='UEB4301', faT3='UEB4301')))


# ---------------------------------------------------------------- derived fields
H_TECH = {0: 1.0, 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.0}      # Höhenfaktor Strukturen (T4: in Spielgröße modelliert)
MOB_SCALE = {0: 1.0, 1: 1.0, 2: 1.3, 3: 1.7, 4: 1.0}   # uniformer Maßstab mobil (T4: in Spielgröße modelliert)
MOB_CAP_1x1 = 1.4                              # Deckel für 1×1-Footprint
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


def fa_metrics(bp, key, idx=None):
    r = FA[bp]
    hp = r['hp'] + (r['shield'] or 0)
    dps = r['dps'] if idx is None else round(sum(r['weapons'][i]['dps'] for i in idx), 2)
    if bp in ('UEL0001', 'URL0001'):
        dps = 100.0  # nur Hauptwaffe, ohne Overcharge/Enhancements
    return dict(bp=bp, mass=r['mass'], energy=r['energy'], buildTime=r['bt'], hp=r['hp'], shieldHp=r['shield'],
                dps=round(dps, 2), dpsPerMass=round(dps / r['mass'], 4) if dps else None,
                hpPerMass=round(hp / r['mass'], 4), speed=r['speed'],
                range=max([w['range'] or 0 for w in r['weapons'] if w['cat'] not in ('Death', None) and (w['dmg'] or 0) > 0] or [0]) or None)


def pulk_targets(splash):
    # Rechenannahme Review: 1 Ziel pro 4 WU² (2 WU Abstand), Zielradius 0,5 WU
    return math.pi * (splash + 0.5) ** 2 / 4


T4_TRIS = [1600, 800, 320]   # Budget LOD0/1/2 für Experimentals (@faf/modelkit EXPERIMENTAL_BUDGET)


def is_air(u):
    return u['group'] == 'air' or u.get('domain') == 'air'


def is_mobile(u):
    return u['group'] in ('cmd', 'land', 'air') or (u['group'] == 'exp' and u.get('domain') != 'struct')


# Visual-Basis (niedrigste Tech-Stufe je Visual) für den Strukturmaßstab
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
    hp_eff = u['hp'] + (u.get('shield', {}) or {}).get('hp', 0)
    fa = fa_metrics(u['faRef'], u['id'], u.get('faDpsIdx'))
    dpm = round(dps / u['mass'], 4) if dps else None
    hpm = round(hp_eff / u['mass'], 4)
    # Abweichungen aus ungerundeten Werten (Rundung auf 4 Stellen verfälscht sonst kleine Werte wie beim Hochofen)
    fr = FA[u['faRef']]; fa_dpm = fa['dps'] / fr['mass'] if fa['dps'] else None
    t4 = u['tech'] == 4
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
        theirs = fw['damage'] * fw['salvo'] * pulk_targets(fw['splash']) / fw['reloadS'] / fa['mass']
        pulk = dict(splash=w['splash'], faSplash=fw['splash'], pulkDpsPerMass=round(ours, 4),
                    faPulkDpsPerMass=round(theirs, 4), devPct=round((ours / theirs - 1) * 100, 1))
    parts = u['parts']
    tris = sum(TRIS[p['part']] for p in parts)
    anim = sum(1 for p in parts if p.get('anim'))
    mobile = is_mobile(u)
    # Maßstab (faction.md §3.4)
    if mobile:
        s = MOB_SCALE[u['tech']]
        if u['footprint'] == [1, 1] and s > MOB_CAP_1x1:
            s = MOB_CAP_1x1
        scale = dict(xz=s, y=s)
    else:
        b = VIS_BASE[u['visual']]
        xz = u['footprint'][0] / b['footprint'][0]
        scale = dict(xz=round(xz, 2), y=round(xz * H_TECH[u['tech']] / H_TECH[b['tech']], 2))
    stripes = 0 if (u['tech'] in (0, 4) or 'WALL' in u['cats']) else u['tech']  # T4: Keramik-Klammer statt Streifen
    stripe_mat = 'graphite' if ('ENGINEER' in u['cats'] and 'COMMAND' not in u['cats']) else 'ceramic'
    e = dict(
        id=u['id'], name=dict(de=u['de'], en=u['en']), role=dict(de=u['roleDe'], en=u['roleEn']),
        tech=u['tech'], group=u['group'], visual=u['visual'], ms9Core=u['ms9'], msFirst=u['ms'], msNote=u['msNote'],
        faReference=dict(devOnly=True, role=u['faRole'], bp=u['faRef'], crossCheckBp=u.get('faCross')),
        categories=u['cats'], buildableBy=u['buildableBy'],
        economy={k: v for k, v in dict(mass=u['mass'], energy=u['energy'], buildTime=u['bt'], buildPower=u.get('bp'),
                                       **(u.get('eco') or {})).items() if v is not None},
        health=dict(max=u['hp'], **({'regenPerSec': u['regen']} if u.get('regen') else {})),
        shield=u.get('shield'), weapons=ws,
        motion=(dict(layer='air' if is_air(u) else 'land', speed=u['speed'], turnRateDeg=u['turn'],
                     accel=u.get('accel'), sizeClass=u['sizeClass'], footprint=u['footprint']) if mobile
                else dict(layer='land', speed=0, footprint=u['footprint'], structure=True)),
        intel={k: v for k, v in dict(vision=u.get('vision'), radar=u.get('radar')).items() if v is not None},
        special=dict(toggles=u.get('toggles', []), upgradesTo=u.get('upgradesTo'), upgradeFrom=u.get('upgradeFrom'),
                     adjacency=u.get('adjacency'), deathWeapon=u.get('death'), notes=u['special']),
        hotbuild=(dict(menu=u['hotbuild'][0], slot=u['hotbuild'][1]) if u['hotbuild'] else None),
        icon=u['icon'],
        kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris, techStripes=stripes,
                     techStripeMat=stripe_mat if stripes else None, scale=scale, description=u['kitbash'],
                     **({'ceramicBracket': True, 'trisBudget': T4_TRIS} if t4 else {})),
        balance=dict(dps=round(dps, 2) if dps else None, dpsPerMass=dpm, hpPerMass=hpm,
                     hpBasis='HP+Schild' if (u.get('shield') or FA[u['faRef']]['shield']) else 'HP',
                     fa=fa, devDpsPerMassPct=dev_d, devHpPerMassPct=dev_h, devProductPct=dev_p,
                     pulk=pulk, withinBand25=inband, withinTarget15=in15),
    )
    if t4:
        x = u['exp']
        e['tier'] = 'T4'
        e['postMvp'] = True
        e['experimental'] = dict(domain=u['domain'], milestone=u['ms'], features=x['features'],
                                 newMechanics=x['newMechanics'], crush=x['crush'], counters=x['counters'],
                                 wreck=dict(massFraction=0.9, mass=round(u['mass'] * 0.9)), faCompare=x['compareNote'],
                                 t3Equivalent=x['t3Equivalent'])
    if is_air(u):
        e['motion']['accel'] = None
        e['motion']['note'] = 'kinematisches Flugmodell: speed = Reisetempo, turnRateDeg = Entwurfswert (FA: Air.TurnSpeed)'
    out.append(e)
E = {e['id']: e for e in out}

# ---------------------------------------------------------------- Treffer-bis-Tod-Matrix (exakt FA)
HTK_PAIRS = [('core:cmd_commander', 0, 0, t) for t in
             ('core:lnd_t1_bot', 'core:lnd_t1_tank', 'core:lnd_t1_arty', 'core:lnd_t1_aa', 'core:lnd_t1_engineer', 'core:lnd_t1_scout')] + [
    ('core:str_t1_pd', 0, None, 'core:lnd_t1_tank'), ('core:str_t1_pd', 0, None, 'core:lnd_t1_bot'),
    ('core:lnd_t1_arty', 0, None, 'core:lnd_t1_bot'), ('core:lnd_t1_arty', 0, None, 'core:lnd_t1_engineer'),
    ('core:lnd_t1_arty', 0, None, 'core:lnd_t1_tank'),
    ('core:lnd_t2_tank', 0, None, 'core:lnd_t1_bot'), ('core:lnd_t2_tank', 0, None, 'core:lnd_t1_tank'),
    ('core:lnd_t2_mml', 0, None, 'core:str_t2_pd'),
    ('core:str_t2_arty', 0, None, 'core:str_t2_mex'), ('core:str_t2_arty', 0, None, 'core:str_t1_pd'),
    ('core:str_t2_arty', 0, None, 'core:str_t2_pgen'),
    ('core:str_t1_aa', 0, None, 'core:air_t1_scout'),
    ('core:str_t3_sam', 0, None, 'core:air_t2_gunship'), ('core:str_t3_sam', 0, None, 'core:air_t2_fbomber'),
]
htk = []
for a, wi, fwi, t in HTK_PAIRS:
    w = E[a]['weapons'][wi]; fw = fa_weapon(BY_ID[a]['faRef'], fwi)
    thp = E[t]['health']['max']; fthp = FA[BY_ID[t]['faRef']]['hp']
    ours = math.ceil(thp / (w['damage'] * w['salvo'])); theirs = math.ceil(fthp / (fw['damage'] * fw['salvo']))
    htk.append(dict(attacker=a, weapon=w['ref'], target=t, salvoDamage=w['damage'] * w['salvo'], targetHp=thp,
                    hits=ours, ttkS=round((ours - 1) * w['reloadS'], 1),
                    fa=dict(attacker=BY_ID[a]['faRef'], target=BY_ID[t]['faRef'], salvoDamage=fw['damage'] * fw['salvo'],
                            targetHp=fthp, hits=theirs, ttkS=round((theirs - 1) * fw['reloadS'], 1)),
                    match=ours == theirs))

# ---------------------------------------------------------------- Schildbrechen (Info, mit Regenerations-Verzögerung)
def shots_to_break(w, sh):
    net_regen = sh['regenPerSec'] * max(0.0, w['reloadS'] - sh['regenStartS'])
    dmg = w['damage'] * w['salvo']
    if dmg <= net_regen: return None
    n = 1
    while n * dmg - (n - 1) * net_regen < sh['hp']: n += 1
    return n
shield_break = []
for a, t in (('core:str_t2_arty', 'core:str_t2_shield'), ('core:str_t3_arty', 'core:str_t2_shield'),
             ('core:str_t3_arty', 'core:str_t3_shield'), ('core:lnd_t3_arty', 'core:str_t2_shield')):
    w = E[a]['weapons'][0]; sh = E[t]['shield']; n = shots_to_break(w, sh)
    fw = fa_weapon(BY_ID[a]['faRef']); fsh = dict(sh, hp=FA[BY_ID[t]['faRef']]['shield']); fn = shots_to_break(fw, fsh)
    shield_break.append(dict(attacker=a, target=t, shots=n, timeS=round((n - 1) * w['reloadS'], 1) if n else None,
                             faShots=fn, faTimeS=round((fn - 1) * fw['reloadS'], 1) if fn else None,
                             note='Einzelner Schütze; FA-Waffe gegen FA-Schild-HP mit gleicher Regeneration/Verzögerung'))

# ---------------------------------------------------------------- Visuals (Superset-Mesh pro Rolle)
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
    v['mobile'] = E[v['members'][0]]['motion'].get('structure') is not True
    v['t4'] = E[v['members'][0]]['tech'] == 4

# ---------------------------------------------------------------- Checks / Lints
ids = [e['id'] for e in out]
assert len(ids) == len(set(ids))
for e in out:
    k = e['kitbash']; b = e['balance']
    if e['tech'] == 4:
        assert k['animatedParts'] <= 8, e['id']  # PartStream-Limit
        assert k['partCount'] <= 16, (e['id'], k['partCount'])
        assert k['trisEstimate'] <= T4_TRIS[0], e['id']
        assert e['postMvp'] and not e['ms9Core'] and e['msFirst'].startswith('PM'), e['id']
        assert all(f in FEATURE_IDS for f in e['experimental']['features']), e['id']
        assert all(m in XM for m in e['experimental']['newMechanics']), e['id']
    else:
        assert k['animatedParts'] <= 2, e['id']
        lim = 7 if e['group'] in ('cmd', 'land', 'air') else 9
        assert k['partCount'] <= lim, (e['id'], k['partCount'])
        assert k['trisEstimate'] <= 350, e['id']
    assert b['withinBand25'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'])
    assert b['withinTarget15'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'], b['devProductPct'])
    if b['pulk']: assert abs(b['pulk']['devPct']) <= 15, (e['id'], b['pulk'])
    for kk in ('upgradesTo', 'upgradeFrom'):
        if e['special'][kk]: assert e['special'][kk] in ids, (e['id'], kk)
    # Glut-Monopol: stack und glow nur bei Flow-Einheiten
    flow = bool(set(e['categories']) & FLOW_CATS)
    for p in k['parts']:
        if p['part'] == 'stack' or p.get('mat') == 'glow':
            assert flow, ('Glut-Monopol', e['id'], p)
    # Teamfarbe: mind. 1 Team-Part
    assert any(p.get('mat') == 'team' for p in k['parts']), ('Teamfarbe', e['id'])
    # upgradebare Gebäude brauchen buildPower
    if e['special']['upgradesTo'] and 'STRUCTURE' in e['categories']:
        assert e['economy'].get('buildPower'), ('buildPower', e['id'])
    if e['shield']: assert 'regenStartS' in e['shield'], e['id']
for h in htk:
    assert h['match'], ('Treffer-bis-Tod', h)
for vid, v in visuals.items():
    if v['t4']:
        assert len(v['members']) == 1, vid
        continue
    assert v['supersetParts'] <= (8 if v['mobile'] else 9), (vid, v['supersetParts'])
    assert v['trisEstimate'] <= 350, (vid, v['trisEstimate'])


# ---------------------------------------------------------------- Experimentals: T3-Äquivalent, Bauzeit, Schilde, Todeswaffen
T4U = [e for e in out if e['tech'] == 4]
MEISTER_BP = BY_ID['core:lnd_t3_engineer']['bp']
FA_T3_ENG_BP = FA['UEL0309']['br']


def fa_full(bp):
    r = FA[bp]
    return r['mass'], r['hp'] + (r['shield'] or 0)


t4_equiv = []
for e in T4U:
    q = e['experimental']['t3Equivalent']; t3 = E[q['unit']]
    ours_n = e['economy']['mass'] / t3['economy']['mass']
    fa_m4, fa_h4 = fa_full(q['faT4']); fa_m3, fa_h3 = fa_full(q['faT3'])
    fa_d4 = e['balance']['fa']['dps']; fa_d3 = fa_metrics(q['faT3'], None)['dps']
    h4 = e['health']['max'] + ((e['shield'] or {}).get('hp', 0)); h3 = t3['health']['max'] + ((t3['shield'] or {}).get('hp', 0))
    d4 = e['balance']['dps']; d3 = t3['balance']['dps']
    r_h = (h4 / e['economy']['mass']) / (h3 / t3['economy']['mass']); fr_h = (fa_h4 / fa_m4) / (fa_h3 / fa_m3)
    r_d = (d4 / e['economy']['mass']) / (d3 / t3['economy']['mass']) if d4 and d3 else None
    fr_d = (fa_d4 / fa_m4) / (fa_d3 / fa_m3) if fa_d4 and fa_d3 else None
    row = dict(t4=e['id'], t3=q['unit'], t3Count=round(ours_n, 1), faT3Count=round(fa_m4 / fa_m3, 1),
               t3PoolDps=round(ours_n * d3, 1) if d3 else None, t3PoolHp=round(ours_n * h3),
               dpsRatio=round(r_d, 3) if r_d else None, faDpsRatio=round(fr_d, 3) if fr_d else None,
               hpRatio=round(r_h, 3), faHpRatio=round(fr_h, 3),
               devDpsRatioPct=round((r_d / fr_d - 1) * 100, 1) if r_d and fr_d else None,
               devHpRatioPct=round((r_h / fr_h - 1) * 100, 1))
    if 'ECONOMIC' in e['categories']:
        ec = e['economy']; m3 = t3['economy']
        row['eco'] = dict(maxMassPerSec=ec['demandMassPerSecMax'], baseMassPerSec=ec['massPerSec'],
                          paybackAtMaxS=round(ec['mass'] / ec['demandMassPerSecMax']),
                          t3MexForMax=round(ec['demandMassPerSecMax'] / m3['massPerSec'], 1),
                          t3MexCostForMax=round(ec['demandMassPerSecMax'] / m3['massPerSec'] * (m3['mass'] + 900 + 36)),
                          faPaybackAt750S=round(FA['XAB1401']['mass'] / 750))
    t4_equiv.append(row)

t4_build = []
for e in T4U:
    bt = e['economy']['buildTime']; fr = FA[BY_ID[e['id']]['faRef']]
    rows = []
    for n_ in (1, 10, 20, 40):
        t = bt / (n_ * MEISTER_BP)
        rows.append(dict(engineers=n_, seconds=round(t), massPerSec=round(e['economy']['mass'] / t, 1),
                         energyPerSec=round(e['economy']['energy'] / t),
                         faSeconds=round(fr['bt'] / (n_ * FA_T3_ENG_BP)) if 'EXPERIMENTAL' in fr['cats'] else None))
    t4_build.append(dict(unit=e['id'], buildTime=bt, builderBp=MEISTER_BP, faBuilderBp=FA_T3_ENG_BP, rows=rows))

t4_shield = []
for a, t in (('core:exp_str_arty', 'core:str_t2_shield'), ('core:exp_str_arty', 'core:str_t3_shield'), ('core:exp_str_arty', 'core:exp_str_shield'),
             ('core:str_t3_arty', 'core:exp_str_shield'), ('core:exp_lnd_walker', 'core:exp_str_shield'), ('core:exp_air_gunship', 'core:exp_str_shield'),
             ('core:exp_str_arty', 'core:exp_lnd_foundry')):
    w = E[a]['weapons'][0]; sh = E[t]['shield']; n_ = shots_to_break(w, sh)
    t4_shield.append(dict(attacker=a, target=t, shots=n_, timeS=round((n_ - 1) * w['reloadS'], 1) if n_ else None,
                          note='ein Schütze, Hauptwaffe; Regeneration mit regenStartS'))

t4_death = []
for e in T4U:
    dw = e['special']['deathWeapon']
    if not dw: continue
    fa_d = [w for w in FA[BY_ID[e['id']]['faRef']]['weapons'] if w['cat'] == 'Death']
    fa_dmg = fa_d[0]['dmg'] if fa_d and fa_d[0]['dmg'] else (35000 if e['id'] == 'core:exp_str_eco' else None)
    fa_rad = fa_d[0]['splash'] if fa_d and fa_d[0]['splash'] else (25 if e['id'] == 'core:exp_str_eco' else None)
    t4_death.append(dict(unit=e['id'], damage=dw['damage'], radius=dw['radius'], delayS=dw.get('delayS'),
                         faDamage=fa_dmg, faRadius=fa_rad,
                         killsT3Bot=dw['damage'] >= E['core:lnd_t3_bot']['health']['max'],
                         killsT3Pgen=dw['damage'] >= E['core:str_t3_pgen']['health']['max']))

for r in t4_equiv:
    for k in ('devDpsRatioPct', 'devHpRatioPct'):
        if r[k] is not None: assert abs(r[k]) <= 25, ('T3-Äquivalent', r)

# Icon-Glyphen
import re
glyphs = sorted({re.sub(r'^(land|air|eng|struct)_', '', re.sub(r'_t\d$', '', e['icon'])) for e in out
                 if e['icon'] not in ('cmd_commander', 'wall')})

n9 = sum(e['ms9Core'] for e in out)
MVP = [e for e in out if e['tech'] != 4]
mob = sum(1 for e in MVP if e['group'] in ('cmd', 'land', 'air'))
t4mob = sum(1 for e in T4U if e['motion'].get('structure') is not True)
doc = dict(
    schema='faf-roster/1', faction='core (Varkan-Kompakt)', generated='2026-09-29', language='de',
    sourceOfTruth='roster.json ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts; faction.md und roster.md verweisen darauf.',
    counts=dict(total=len(out), mvp=len(MVP), mobile=mob, structures=len(MVP) - mob, ms9Core=n9,
                visuals=len(visuals) - len(T4U), iconGlyphs=len(glyphs),
                experimental=dict(total=len(T4U), mobile=t4mob, structures=len(T4U) - t4mob, visuals=len(T4U))),
    conventions=dict(
        units='1 WU = 1 FA-Ogrid (20-km-Karte = 1024 WU, DECISIONS „Setons“); Reichweiten/Tempo 1:1 in WU bzw. WU/s',
        buildTime='Sekunden = buildTime / Build Power des Erbauers (FA-Semantik); Upgrade-Dauer = buildTime der Zielstufe / buildPower der Vorstufe',
        upgradeCost='Kosten von Upgrade-Stufen (upgradeFrom gesetzt) sind Upgrade-Kosten, nicht Gesamtkosten (FA-Semantik)',
        reload='reloadS ist ein Vielfaches von 0,1 s (10-Hz-Tick); dps = damage × salvo / reloadS',
        dpsBomber='Bomber-DPS = Salvenschaden / Nachladezeit (theoretisch, pro Anflug)',
        balanceGate='Hart: |devDpsPerMassPct| und |devHpPerMassPct| ≤ 25 (PLAN U3). Ziel (vom Generator erzwungen): Einzelachsen, Produkt '
                    '(DPS/Mass × HP/Mass) und Pulk-DPS/Mass der Artillerie je ≤ ±15 %; Treffer-bis-Tod-Matrix exakt wie FA.',
        productGate='devProductPct = (dpsPerMass/FA) × (hpPerMass/FA) − 1; bestimmt die Stärke im direkten Gefecht',
        pulkModel='Pulk-DPS/Mass = Schaden × Salve × Ziele / Nachladezeit / Mass, Ziele = π (Splash + 0,5)² / 4 '
                  '(1 Ziel pro 4 WU², Zielradius 0,5); gilt für Kategorie ARTILLERY',
        hitsToKill='Treffer (Salven) bis zum Tod = ceil(Ziel-HP / Salvenschaden); Pflichtpaare in checks.hitsToKill müssen exakt der FA-Referenz entsprechen',
        hpBasis='Bei Schild-Einheiten (eigene oder FA-Referenz) wird HP+Schild-HP verglichen',
        shieldRegen='regenStartS = Verzögerung nach dem letzten Treffer, bis die Regeneration einsetzt (FA: 3/3/1 s)',
        commander='Vogt: Mass 2000 nominell (nicht baubar), DPS nur Hauptwaffe',
        faReference='dev-only: faReference wird beim Blueprint-Build per Lint entfernt und darf nie in view.json oder i18n landen (faction.md §2.4)',
        scale='Mobil uniform T1 1,0 / T2 1,3 / T3 1,7, bei 1×1-Footprint max. 1,4. Strukturen: xz = Footprint-Kante / Footprint-Kante der '
              'niedrigsten Stufe des Visuals (Sockel füllt 100 % des Footprints), y = xz × Höhenfaktor (T1 1,0 / T2 1,2 / T3 1,4) relativ zur Basis.',
        techStripes='Breite 0,10 WU × Maßstab, Abstand 0,10 WU, im hinteren Drittel des Decks; keramikweiß, bei Engineers graphit (#1E1C1B) auf Keramik; '
                    'Vogt und Mauer ohne Streifen',
        visual='Ein Visual = ein Superset-Mesh pro Rolle (Vereinigung der Parts aller Tech-Stufen nach Part+Material). Jeder Vertex trägt eine '
               'Tech-Bitmaske; der Vertex-Shader kollabiert Parts, die für die Instanz-Tech nicht gelten (Skalierung 0). Ein Draw pro (Visual, LOD).',
        faSource='FAForever/spooky-db app/data/index.json (Version 3810), DPS-Formel app/js/dps.js; Stichprobe gegen FAForever/fa develop',
        experimentals='Tier T4 (tech 4, group exp, postMvp true, msFirst PM1–PM3), Details docs/design/experimentals.md. Zählen nicht zu counts.mvp/mobile/structures/visuals. '
                      'Gleiche Gates wie MVP (±25 % hart, ±15 % Ziel inkl. Produkt/Pulk) gegen die FA-T4-Referenz; zusätzlich checks.experimentals: '
                      'T3-Äquivalent (T4/T3-Verhältnis von DPS/Mass und HP/Mass gegen dasselbe FA-Verhältnis, ±25 %), Bauzeit mit N Meistern, Schild- und Todeswaffen-Tabellen. '
                      'Modelle in Spielgröße (scale 1), Keramik-Klammer statt Tech-Streifen, Budget ≤ 1.600/800/320 Tris, Parts ≤ 16, animiert ≤ 8 (PartStream).',
    ),
    experimentalMechanics=XM,
    hotbuildGrid={
        'Landwerk': {'Q': 'Panzer (Punze/Meißel)', 'W': 'Artillerie (Kelle/Rinne/Pfanne)',
                     'E': 'Engineer (Lehrling/Geselle/Meister)', 'R': 'Flugabwehr (Sieb/Rüttelsieb/Trommelsieb)',
                     'A': 'Späher (Funke)', 'S': 'Bots (Stichel/Zange/Fallhammer)', 'D': 'Support (Schürze)',
                     'F': 'Präzision (Reißnadel)'},
        'Luftwerk': {'Q': 'Abfangjäger (Turmfalke)', 'W': 'Bomber (Dohle)', 'E': 'Gunship (Krähe)',
                     'R': 'Jagdbomber (Elster)', 'A': 'Aufklärer (Lerche)'},
        'Bau': {'Q': 'Zapfstelle', 'W': 'Glutkessel', 'E': 'Dampfquelle', 'R': 'Erzspeicher', 'T': 'Glutspeicher',
                'A': 'Landwerk', 'S': 'Luftwerk', 'D': 'Horcher', 'F': 'Schirm',
                'Z': 'Riegel', 'X': 'Rost/Hochrost', 'C': 'Mauer', 'V': 'Tiegel/Hochofen', 'G': 'Großguss (T4-Untermenü, Post-MVP)'},
        'Großguss': {'Q': 'Sturmläufer (Stampfe)', 'W': 'Strategische Artillerie (Konverter)', 'E': 'Mobile Gießhalle (Kokille)',
                     'A': 'Tiefenzapfwerk (Tiefenstich)', 'S': 'Luft-Experimental (Kolkrabe)', 'F': 'Großschild (Mantel)'},
        'rule': 'Gleiche Taste = gleiche Rolle über alle Tech-Stufen; mehrfaches Drücken wechselt nur die Tech-Stufe (höchste baubare zuerst). '
                'Upgrade-Stufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die 5. Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen. Post-MVP: G im Bau-Menü öffnet das Untermenü Großguss (T4); dessen Tasten folgen den Rollen der übrigen Menüs (Q Direktfeuer, W Artillerie, E Bauen, S Luft, F Schild, A Wirtschaft).'},
    silhouettePairs=dict(
        ms9=[['core:lnd_t1_tank', 'core:lnd_t1_aa'], ['core:lnd_t1_arty', 'core:lnd_t1_aa'], ['core:lnd_t2_mml', 'core:lnd_t2_aa'],
             ['core:lnd_t2_tank', 'core:lnd_t2_mml'], ['core:lnd_t1_engineer', 'core:lnd_t1_scout'], ['core:str_t1_pd', 'core:str_t1_aa'],
             ['core:str_t1_mex', 'core:str_t1_pgen'], ['core:str_t1_pgen', 'core:str_t1_estore'], ['core:str_t1_mstore', 'core:str_t1_estore']],
        ms14=[['core:air_t1_bomber', 'core:air_t1_fighter'], ['core:air_t1_fighter', 'core:air_t2_fbomber'], ['core:air_t1_scout', 'core:air_t1_bomber'],
              ['core:str_t1_radar', 'core:str_t2_shield'], ['core:lnd_t1_scout', 'core:lnd_t2_shield'], ['core:str_t3_arty', 'core:str_t3_pgen'],
              ['core:str_t3_mex', 'core:str_t1_hydro']],
        t4=[['core:exp_lnd_walker', 'core:cmd_commander'], ['core:exp_air_gunship', 'core:air_t2_gunship'],
            ['core:exp_str_arty', 'core:str_t3_arty'], ['core:exp_str_shield', 'core:str_t3_shield'],
            ['core:exp_lnd_foundry', 'core:lnd_t2_shield'], ['core:exp_str_eco', 'core:str_t3_mex']],
    ),
    iconGlyphs=glyphs,
    visuals={k: dict(members=v['members'], supersetParts=v['supersetParts'], trisEstimate=v['trisEstimate'], parts=v['counts'])
             for k, v in visuals.items()},
    checks=dict(hitsToKill=htk, shieldBreak=shield_break,
                experimentals=dict(t3Equivalent=t4_equiv, buildTime=t4_build, shieldBreak=t4_shield, deathWeapons=t4_death)),
    units=out,
)
for pr in doc['silhouettePairs']['ms9']:
    assert all(E[i]['ms9Core'] for i in pr), pr
json.dump(doc, open(REPO / 'docs' / 'design' / 'roster.json', 'w'), ensure_ascii=False, indent=2)
print('total', len(out), 'mvp', len(MVP), 't4', len(T4U), 'mobile', mob, 'ms9', n9, 'visuals', len(visuals), 'glyphs', len(glyphs), glyphs)
for e in out:
    b = e['balance']
    print(f"{e['id']:26s} {'●' if e['ms9Core'] else '○'} {e['msFirst']:5s} dps/m {b['dpsPerMass']} ({b['devDpsPerMassPct']}) hp/m {b['hpPerMass']} ({b['devHpPerMassPct']}) prod {b['devProductPct']} pulk {b['pulk'] and b['pulk']['devPct']} scale {e['kitbash']['scale']}")
for h in htk: print('HTK', h['attacker'], '->', h['target'], h['hits'], h['fa']['hits'], h['ttkS'], h['fa']['ttkS'])
for s in shield_break: print('SHIELD', s)
for k, v in visuals.items(): print('VIS', k, v['supersetParts'], v['trisEstimate'])
for r in t4_equiv: print('T4EQ', r)
for r in t4_build: print('T4BT', r['unit'], [(x['engineers'], x['seconds'], x['massPerSec'], x['faSeconds']) for x in r['rows']])
for r in t4_shield: print('T4SH', r)
for r in t4_death: print('T4DW', r)
