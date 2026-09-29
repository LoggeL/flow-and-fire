# Generator for docs/design/roster.json + roster.md (Flow & Fire, Varkan faction).
# FA reference numbers come from fa_ref.json (FAForever/spooky-db app/data/index.json, v3810,
# DPS via spooky-db app/js/dps.js "NotNukeDpsCalculator").
import json, math

FA = json.load(open('fa_ref.json'))

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

# ---------------------------------------------------------------- derived fields
H_TECH = {0: 1.0, 1: 1.0, 2: 1.2, 3: 1.4}      # Höhenfaktor Strukturen
MOB_SCALE = {0: 1.0, 1: 1.0, 2: 1.3, 3: 1.7}   # uniformer Maßstab mobil
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


def fa_metrics(bp, key):
    r = FA[bp]
    hp = r['hp'] + (r['shield'] or 0)
    dps = r['dps']
    if bp in ('UEL0001', 'URL0001'):
        dps = 100.0  # nur Hauptwaffe, ohne Overcharge/Enhancements
    return dict(bp=bp, mass=r['mass'], energy=r['energy'], buildTime=r['bt'], hp=r['hp'], shieldHp=r['shield'],
                dps=round(dps, 2), dpsPerMass=round(dps / r['mass'], 4) if dps else None,
                hpPerMass=round(hp / r['mass'], 4), speed=r['speed'],
                range=max([w['range'] or 0 for w in r['weapons'] if w['cat'] not in ('Death', None) and (w['dmg'] or 0) > 0] or [0]) or None)


def pulk_targets(splash):
    # Rechenannahme Review: 1 Ziel pro 4 WU² (2 WU Abstand), Zielradius 0,5 WU
    return math.pi * (splash + 0.5) ** 2 / 4


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
    fa = fa_metrics(u['faRef'], u['id'])
    dpm = round(dps / u['mass'], 4) if dps else None
    hpm = round(hp_eff / u['mass'], 4)
    # Abweichungen aus ungerundeten Werten (Rundung auf 4 Stellen verfälscht sonst kleine Werte wie beim Hochofen)
    fr = FA[u['faRef']]; fa_dpm = fa['dps'] / fr['mass'] if fa['dps'] else None
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
    mobile = u['group'] in ('cmd', 'land', 'air')
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
    stripes = 0 if (u['tech'] == 0 or 'WALL' in u['cats']) else u['tech']
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
        motion=(dict(layer='air' if u['group'] == 'air' else 'land', speed=u['speed'], turnRateDeg=u['turn'],
                     accel=u.get('accel'), sizeClass=u['sizeClass'], footprint=u['footprint']) if mobile
                else dict(layer='land', speed=0, footprint=u['footprint'], structure=True)),
        intel={k: v for k, v in dict(vision=u.get('vision'), radar=u.get('radar')).items() if v is not None},
        special=dict(toggles=u.get('toggles', []), upgradesTo=u.get('upgradesTo'), upgradeFrom=u.get('upgradeFrom'),
                     adjacency=u.get('adjacency'), deathWeapon=u.get('death'), notes=u['special']),
        hotbuild=(dict(menu=u['hotbuild'][0], slot=u['hotbuild'][1]) if u['hotbuild'] else None),
        icon=u['icon'],
        kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris, techStripes=stripes,
                     techStripeMat=stripe_mat if stripes else None, scale=scale, description=u['kitbash']),
        balance=dict(dps=round(dps, 2) if dps else None, dpsPerMass=dpm, hpPerMass=hpm,
                     hpBasis='HP+Schild' if (u.get('shield') or FA[u['faRef']]['shield']) else 'HP',
                     fa=fa, devDpsPerMassPct=dev_d, devHpPerMassPct=dev_h, devProductPct=dev_p,
                     pulk=pulk, withinBand25=inband, withinTarget15=in15),
    )
    if u['group'] == 'air':
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
    v['mobile'] = E[v['members'][0]]['group'] in ('cmd', 'land', 'air')

# ---------------------------------------------------------------- Checks / Lints
ids = [e['id'] for e in out]
assert len(ids) == len(set(ids))
for e in out:
    k = e['kitbash']; b = e['balance']
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
    assert v['supersetParts'] <= (8 if v['mobile'] else 9), (vid, v['supersetParts'])
    assert v['trisEstimate'] <= 350, (vid, v['trisEstimate'])

# Icon-Glyphen
import re
glyphs = sorted({re.sub(r'^(land|air|eng|struct)_', '', re.sub(r'_t\d$', '', e['icon'])) for e in out
                 if e['icon'] not in ('cmd_commander', 'wall')})

n9 = sum(e['ms9Core'] for e in out)
mob = sum(1 for e in out if e['group'] in ('cmd', 'land', 'air'))
doc = dict(
    schema='faf-roster/1', faction='core (Varkan-Kompakt)', generated='2026-09-29', language='de',
    sourceOfTruth='roster.json ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts; faction.md und roster.md verweisen darauf.',
    counts=dict(total=len(out), mobile=mob, structures=len(out) - mob, ms9Core=n9,
                visuals=len(visuals), iconGlyphs=len(glyphs)),
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
    ),
    hotbuildGrid={
        'Landwerk': {'Q': 'Panzer (Punze/Meißel)', 'W': 'Artillerie (Kelle/Rinne/Pfanne)',
                     'E': 'Engineer (Lehrling/Geselle/Meister)', 'R': 'Flugabwehr (Sieb/Rüttelsieb/Trommelsieb)',
                     'A': 'Späher (Funke)', 'S': 'Bots (Stichel/Zange/Fallhammer)', 'D': 'Support (Schürze)',
                     'F': 'Präzision (Reißnadel)'},
        'Luftwerk': {'Q': 'Abfangjäger (Turmfalke)', 'W': 'Bomber (Dohle)', 'E': 'Gunship (Krähe)',
                     'R': 'Jagdbomber (Elster)', 'A': 'Aufklärer (Lerche)'},
        'Bau': {'Q': 'Zapfstelle', 'W': 'Glutkessel', 'E': 'Dampfquelle', 'R': 'Erzspeicher', 'T': 'Glutspeicher',
                'A': 'Landwerk', 'S': 'Luftwerk', 'D': 'Horcher', 'F': 'Schirm',
                'Z': 'Riegel', 'X': 'Rost/Hochrost', 'C': 'Mauer', 'V': 'Tiegel/Hochofen'},
        'rule': 'Gleiche Taste = gleiche Rolle über alle Tech-Stufen; mehrfaches Drücken wechselt nur die Tech-Stufe (höchste baubare zuerst). '
                'Upgrade-Stufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die 5. Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen.'},
    silhouettePairs=dict(
        ms9=[['core:lnd_t1_tank', 'core:lnd_t1_aa'], ['core:lnd_t1_arty', 'core:lnd_t1_aa'], ['core:lnd_t2_mml', 'core:lnd_t2_aa'],
             ['core:lnd_t2_tank', 'core:lnd_t2_mml'], ['core:lnd_t1_engineer', 'core:lnd_t1_scout'], ['core:str_t1_pd', 'core:str_t1_aa'],
             ['core:str_t1_mex', 'core:str_t1_pgen'], ['core:str_t1_pgen', 'core:str_t1_estore'], ['core:str_t1_mstore', 'core:str_t1_estore']],
        ms14=[['core:air_t1_bomber', 'core:air_t1_fighter'], ['core:air_t1_fighter', 'core:air_t2_fbomber'], ['core:air_t1_scout', 'core:air_t1_bomber'],
              ['core:str_t1_radar', 'core:str_t2_shield'], ['core:lnd_t1_scout', 'core:lnd_t2_shield'], ['core:str_t3_arty', 'core:str_t3_pgen'],
              ['core:str_t3_mex', 'core:str_t1_hydro']],
    ),
    iconGlyphs=glyphs,
    visuals={k: dict(members=v['members'], supersetParts=v['supersetParts'], trisEstimate=v['trisEstimate'], parts=v['counts'])
             for k, v in visuals.items()},
    checks=dict(hitsToKill=htk, shieldBreak=shield_break),
    units=out,
)
for pr in doc['silhouettePairs']['ms9']:
    assert all(E[i]['ms9Core'] for i in pr), pr
json.dump(doc, open('roster.json', 'w'), ensure_ascii=False, indent=2)
print('total', len(out), 'mobile', mob, 'ms9', n9, 'visuals', len(visuals), 'glyphs', len(glyphs), glyphs)
for e in out:
    b = e['balance']
    print(f"{e['id']:26s} {'●' if e['ms9Core'] else '○'} {e['msFirst']:5s} dps/m {b['dpsPerMass']} ({b['devDpsPerMassPct']}) hp/m {b['hpPerMass']} ({b['devHpPerMassPct']}) prod {b['devProductPct']} pulk {b['pulk'] and b['pulk']['devPct']} scale {e['kitbash']['scale']}")
for h in htk: print('HTK', h['attacker'], '->', h['target'], h['hits'], h['fa']['hits'], h['ttkS'], h['fa']['ttkS'])
for s in shield_break: print('SHIELD', s)
for k, v in visuals.items(): print('VIS', k, v['supersetParts'], v['trisEstimate'])
