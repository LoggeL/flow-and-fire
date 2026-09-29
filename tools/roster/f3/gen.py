# Generator für docs/design/factions/f3/roster.json (Flow & Fire, Fraktion f3 „Orden von Sael“).
# Schema identisch zu docs/design/roster.json (faf-roster/1); neu sind nur optionale Felder
# (motion.gait, special.postMvp, checks.crossHitsToKill, conventions.faOverrides; seit Review 2026-09-29 auch
# weapons[].firingRandomness und checks.rush).
# FA-Referenzen: tools/roster/f3/fa_ref.json (spooky-db 3810, Vorbild-Fraktion) plus FA_OVERRIDES
# (gegen FAForever/fa develop geprüft, siehe unten). Varkan-Seite der Kreuz-Checks:
# docs/design/roster.json + tools/roster/fa_ref.json.
# Aufruf: python3 tools/roster/f3/gen.py   (aus beliebigem Ordner)
import json, math, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / 'docs/design/factions/f3/roster.json'
FA = json.load(open(HERE / 'fa_ref.json'))
VK = json.load(open(ROOT / 'docs/design/roster.json'))           # Varkan-Roster (Kreuz-Checks, Rollen-Metadaten)
FA_VK = json.load(open(ROOT / 'tools/roster/fa_ref.json'))       # Varkan-FA-Referenzen (UEF u. a.)
VK_U = {u['id'].split(':')[1]: u for u in VK['units']}

# ---------------------------------------------------------------- FA-Korrekturen (gegen FAF develop geprüft)
# spooky-db nimmt je Einheit nur die stärkste Einzelwaffe. Zwei Referenzen brauchen deshalb die Summe
# (wie tools/roster/fa_ref.json für Varkan); Luft-Tempi stehen in spooky als Physics.MaxSpeed (0,5) statt Air.MaxAirspeed.
FA_OVERRIDES = {
    'UAA0102': dict(dps=48.0, weaponDps={'Anti Air': 48.0},
                    note='develop: zwei identische Waffen à 3 × 8 Schaden / 1,0 s (MuzzleSalvoSize 3) = 48 DPS; spooky 3810 zählt nur eine (24).'),
    'DEA0202': dict(dps=310.0, weaponDps={'Anti Air': 150.0},
                    note='Zwei Luftkanonen à 75 (develop: LeftBeam/RightBeam, spooky WeaponNumber 2) + Brandbomben 160 addiert (wie Varkan-fa_ref); '
                         'bis zum fraktionsübergreifenden Abgleich nur eine Luftkanone gezählt (235).'),
    'DEL0204': dict(dps=69.09,
                    note='Gegenprobe T2-Läufer: Gatling 38,79 + Granatwerfer 30,3 addiert (wie Varkan-fa_ref); spooky 3810 nennt nur die Gatling.'),
}
AIR_SPEED = {'UAA0101': 19, 'UAA0102': 15, 'UAA0103': 10, 'UAA0203': 12, 'DEA0202': 15}  # develop Air.MaxAirspeed
for b, o in FA_OVERRIDES.items():
    FA[b]['dps'] = o['dps']
    for w in FA[b]['weapons']:
        if w['cat'] in o.get('weaponDps', {}):
            w['dps'] = o['weaponDps'][w['cat']]
for b, s in AIR_SPEED.items():
    FA[b]['speed'] = s

# Ergebnis des develop-Abgleichs (dev-only, nur Relationen), landet in conventions.faDevelopCheck
FA_DEVELOP_CHECK = [
    dict(bp='UAL0103', role='lnd_t1_arty', spooky='200 Schaden / 2,0 s, Splash 0,5 = 100 DPS', develop='identisch (RateOfFire 10/20, FiringRandomness 0,35)',
         verdict='bestätigt: Präzisions-Mörser gegen Stellungen; die Wirkung gegen bewegte Einheiten begrenzen Flugzeit (mv 14), Splash 0,5 und Streuung (K1).'),
    dict(bp='UAA0102', role='air_t1_fighter', spooky='24 DPS', develop='2 Waffen × 3 × 8 / 1,0 s = 48 DPS',
         verdict='spooky-Fehler (nur eine von zwei Waffen gezählt) → Referenz 48 DPS (FA_OVERRIDES).'),
    dict(bp='UAA0103', role='air_t1_bomber', spooky='200 / 5,0 s, Splash 4 = 40 DPS', develop='identisch',
         verdict='bestätigt: eine große Bombe mit großem Splash statt Brandteppich (Referenz der Gegenseite 70 DPS inkl. DoT).'),
    dict(bp='UAL0201', role='lnd_t1_tank', spooky='40 / 1,6 s', develop='40 / 1,7 s (RateOfFire 10/17)',
         verdict='leichte Änderung nach 3810; Roster bleibt auf 3810 wie Varkan (Nachziehen vor MS9).'),
    dict(bp='UAB2301', role='str_t2_pd', spooky='600 / 4,0 s', develop='560 / 4,0 s',
         verdict='leichte Änderung nach 3810; Breakpoints unverändert (Brecher 4 Salven, Kauri 1 Schuss).'),
    dict(bp='UAB2302', role='str_t3_arty', spooky='73.200 Mass', develop='79.000 Mass',
         verdict='nach 3810 verteuert; Sintflut ist ohnehin auf MVP-Kartengröße skaliert.'),
    dict(bp='DEL0204', role='lnd_t2_bot (Gegenprobe)', spooky='38,79 DPS (nur Gatling)', develop='zwei Waffen: 38,79 + 30,3',
         verdict='summiert 69,09 wie Varkan-fa_ref; betrifft nur die Gegenprobe (faction.md §9.2 A7 nannte deshalb +43 % statt −20 %).'),
    dict(bp='XAL0305', role='lnd_t3_sniper', spooky='950 / 6,6 s, RW 60', develop='950 / 6,7 s (RateOfFire 10/67), RW 65',
         verdict='Review 2026-09-29: leichte Änderung nach 3810; Breakpoint Konus → Triton (3 Treffer) bleibt, Nachziehen vor MS9.'),
    dict(bp='UAL0103/UAL0304/UAB2303/UAB2302', role='Artillerie-Streuung', spooky='nicht enthalten',
         develop='FiringRandomness 0,35 / 1,0 / 2,0 / 0,35',
         verdict='Review 2026-09-29: als weapons[].firingRandomness übernommen (FA-Semantik, K1 legt die Umrechnung fest).'),
    dict(bp='UAA0101/0102/0103/0203', role='air', spooky='Physics.MaxSpeed 0,5', develop='Air.MaxAirspeed 19 / 15 / 10 / 12',
         verdict='Luft-Tempi aus develop (AIR_SPEED), wie Varkan.'),
]

# ---------------------------------------------------------------- Kitbash-Katalog (faction.md §3.3)
TRIS = dict(shell=60, hoverpad=32, legs=60, orb=80, lance=12, horn=32, spine=10, sickle=48, ring=72, arch=36,
            mast=24, fan=16, lantern=64, wing=16)


def P(spec):
    """'orb:team*yaw@kopf' -> part mit Material, Animation, Rollen-Notiz."""
    out = []
    for s in spec.split():
        anim = mat = note = None
        if '@' in s: s, note = s.split('@')
        if '*' in s: s, anim = s.split('*')
        if ':' in s: s, mat = s.split(':')
        assert s in TRIS, s
        out.append({k: v for k, v in dict(part=s, mat=mat, anim=anim, note=note).items() if v})
    return out


def W(ref, typ, dmg, reload, rng, proj, salvo=1, minr=None, splash=0, mv=None, layers=('land',), extra=None, spread=None):
    dps = dmg * salvo / reload
    w = dict(ref=ref, type=typ, damage=dmg, salvo=salvo, reloadS=reload, dps=round(dps, 2),
             rangeMin=minr, range=rng, projectile=proj, muzzleVelocity=mv, splash=splash, layers=list(layers),
             firingRandomness=spread)
    if extra: w['notes'] = extra
    return {k: v for k, v in w.items() if v is not None}


# Varkan-Namen -> Sael-Namen (für geerbte msNote/Adjacency-Texte), längste zuerst
RENAME = [('Trommelsieb', 'Diadem'), ('Rüttelsieb', 'Seestern'), ('Hochrost', 'Hochlilie'), ('Zapfstellen', 'Brunnen'),
          ('Zapfstelle', 'Brunnen'), ('Glutkessel', 'Laterne'), ('Glutspeicher', 'Schrein'), ('Erzspeicher', 'Zisterne'),
          ('Dampfquelle', 'Quellbogen'), ('Landwerk', 'Landkapitel'), ('Luftwerk', 'Luftkapitel'), ('Fallhammer', 'Einsiedler'),
          ('Reißnadel', 'Konus'), ('Hochofen', 'Sintflut'), ('Lotbruch', 'Perlsprung'), ('Abstich', 'Glanzstoß'),
          ('Meister', 'Kustos'), ('Geselle', 'Akolyth'), ('Lehrling', 'Novize'), ('Stichel', 'Knallkrebs'), ('Punze', 'Kauri'),
          ('Kelle', 'Dünung'), ('Meißel', 'Triton'), ('Rinne', 'Brecher'), ('Schürze', 'Muschel'), ('Zange', 'Languste'),
          ('Pfanne', 'Woge'), ('Lerche', 'Seeschwalbe'), ('Turmfalke', 'Sturmvogel'), ('Dohle', 'Tölpel'), ('Krähe', 'Albatros'),
          ('Elster', 'Raubmöwe'), ('Riegel', 'Riff'), ('Rost', 'Seelilie'), ('Mauer', 'Deich'), ('Horcher', 'Warte'),
          ('Schirm', 'Perlmutt'), ('Tiegel', 'Brandung'), ('Funke', 'Glimmer'), ('Sieb', 'Seeigel'), ('Vogt', 'Prior')]


def rn(s):
    if not s: return s
    for a, b in RENAME:
        s = re.sub(r'\b' + a + r'(?![a-zäöüß])', b, s)
    return s.replace('angrenzendem Zisterne', 'angrenzender Zisterne').replace('angrenzender Brunnen', 'angrenzendem Brunnen')


MENU = {'Landwerk': 'Landkapitel', 'Luftwerk': 'Luftkapitel', 'Bau': 'Bau'}

HOVER_M13 = dict(feature='M13', what='Schweben über Wasser (Bewegungslayer Hover, Enum im PLAN vorgesehen)',
                 fallback='Layer land; Schweben ist nur Optik (Schwebehöhe, Schattensaum, Schwebelicht), tiefes Wasser bleibt unpassierbar')

R = []


def U(role, **k):
    """Legt einen Sael-Blueprint an. Rolle, ●/○, MS, Icon, Hotbuild-Slot, Footprint u. a. werden von Varkan geerbt."""
    v = VK_U[role]
    b = dict(id='f3:' + role, tech=v['tech'], group=v['group'], visual=v['visual'], ms=v['msFirst'], msNote=rn(v['msNote']),
             ms9=v['ms9Core'], faRole=v['faReference']['role'], cats=list(v['categories']), buildableBy=v['buildableBy'],
             turn=v['motion'].get('turnRateDeg'), accel=v['motion'].get('accel'), sizeClass=v['motion'].get('sizeClass'),
             footprint=v['motion']['footprint'], vision=v['intel'].get('vision'), radar=v['intel'].get('radar'),
             toggles=[t.replace('auto_tapshot', 'auto_lustre') for t in v['special']['toggles']],
             upgradesTo=v['special']['upgradesTo'] and v['special']['upgradesTo'].replace('core:', 'f3:'),
             upgradeFrom=v['special']['upgradeFrom'] and v['special']['upgradeFrom'].replace('core:', 'f3:'),
             adjacency=rn(v['special']['adjacency']), icon=v['icon'],
             hotbuild=(MENU[v['hotbuild']['menu']], v['hotbuild']['slot']) if v['hotbuild'] else None,
             gait=None, postMvp=[])
    b['speed'] = v['motion'].get('speed')
    b.update(k)
    if b['gait'] == 'hover':
        if 'HOVER' not in b['cats']:
            b['cats'].insert(2, 'HOVER')
        b['postMvp'] = [HOVER_M13] + b['postMvp']
    b['faCross'] = FA['_meta']['roleMap'][role]['crossCheckBp']
    b['faRef'] = k.get('faRef', FA['_meta']['roleMap'][role]['bp'])
    R.append(b)


# ---------------------------------------------------------------- Prior & Engineers
U('cmd_commander', de='Prior', en='Prior', roleDe='Kommandant', roleEn='Commander', gait='hover',
  msNote='MS4 Bauen ohne Waffe; MS5 Lanze + Perlsprung; MS6 Glanzstoß (U8)',
  cats=['LAND', 'MOBILE', 'HOVER', 'COMMAND', 'ENGINEER', 'DIRECTFIRE', 'RECLAIM', 'REPAIR', 'UNIQUE'],
  mass=2000, energy=5000000, bt=6000000, bp=10, hp=11000, regen=10,
  eco=dict(massPerSec=1, energyPerSec=20, storageMass=650, storageEnergy=3900),
  weapons=[W('f3:wpn_prior_lance', 'Prior-Lanze (Direktfeuer)', 100, 1.0, 22, 'linear', minr=1, mv=35),
           W('f3:wpn_prior_lustre', 'Glanzstoß (Sonderschuss, manuell/auto)', 15000, 3.3, 22, 'linear', splash=2.5, mv=25,
             extra='Dieselben Konstanten wie Varkans Abstich (FAF-Formel OverchargeProjectile/OverchargeShared, FA-Relation fraktionsgleich): '
                   'Schaden = clamp(max. HP der mobilen Nicht-Kommandanten im Umkreis 2,7 WU [ohne Ziel: 1250], 1250, min(15000, 0,9 x Vorrat / 6)); '
                   'Drain = 6 x Schaden; gegen Strukturen fix 800, gegen Kommandanten fix 400; Feuern ab 7500 E Vorrat (braucht Schrein). Nicht in DPS/Mass gewertet.')],
  compareDpsIdx=[0], speed=1.7,
  death=dict(ref='f3:wpn_pearl_crack', inner=dict(damage=2000, radius=30), outer=dict(damage=500, radius=40),
             note='Perlsprung, Kamera-Shake X4, FA-Relation 1:1 (fraktionsgleich)'),
  postMvp=[dict(feature='M13', what='Amphibischer/schwebender Prior (Vorbild-ACU ist amphibisch)', fallback='Layer land'),
           dict(feature='U14', what='Enhancements: Teleport, Personal-Schild; Zeitdämpfer zusätzlich mit K18', fallback='entfällt')],
  special='Einzigartig, Tod = Niederlage (U1/A4, „Perle gesprungen. Obhut erloschen.“). Baut alle T1-Strukturen. Regeneration 10 HP/s. '
          'HP 11.000 nach Vorbild-Relation (8 % unter dem Vogt); DPS, Glanzstoß und Perlsprung fraktionsgleich.',
  parts=P('shell:team@kegelrock shell@brustschale orb:team*yaw@kopfperle lance*pitch@brustlanze sickle:glow@halo_sichel hoverpad'),
  kitbash='Schwebender Kegelrock (Höhe ≥ 2,4 WU, Rockbreite ≥ 2,0 WU) mit drei teamfarbenen Bahnen, Brustschale, größte Perle als Kopf; '
          'goldene Halo-Sichel hinter dem Kopf (stärkster Goldkern der Armee), Lanze mittig waagerecht vor der Brust; kein Waffen-/Bauarm-Schema, keine Beine.')

ENG_NOTE = 'Baut, assistiert, reclaimt, repariert. Vorbild-Engineers schweben über Wasser; hier nur Land (M13/U17).'
ENG_WATER = dict(feature='M13, U17', what='Bauen auf Wasser (schwebende Engineers)', fallback='kein Bau auf Wasser')
U('lnd_t1_engineer', de='Novize', en='Novice', roleDe='Ingenieur', roleEn='Engineer', gait='hover',
  mass=52, energy=260, bt=260, bp=5, hp=125, speed=1.9, weapons=[], postMvp=[ENG_WATER],
  special=ENG_NOTE + ' Baut T1-Strukturen. Zerbrechlicher als der Lehrling (A6).',
  parts=P('shell:team@schale_mit_randband wing:gold@deckplatte hoverpad sickle:gold*yaw@sichel orb:glow*pitch@emitter'),
  kitbash='Kurze breite Schale auf Schwebeteller, Rand-Band teamfarben, goldene Deckplatte; goldene Sichel vom linken Heck über das Deck nach vorn rechts, '
          'Goldkern-Emitter an der Sichelspitze (umschlossen). 1 Tech-Streifen Tiefjade.')
U('lnd_t2_engineer', de='Akolyth', en='Acolyte', roleDe='Ingenieur', roleEn='Engineer', gait='hover',
  mass=130, energy=650, bt=650, bp=13, hp=350, speed=1.9, weapons=[], postMvp=[ENG_WATER],
  special=ENG_NOTE + ' Baut T1+T2-Strukturen (u. a. Brunnen II direkt, Laterne II, Riff II, Seelilie II, Perlmutt II).',
  parts=P('shell:team@schale_mit_randband wing:gold@deckplatte hoverpad sickle:gold*yaw@sichel sickle:gold*yaw@kleine_sichel orb:glow@emitter'),
  kitbash='Wie Novize, Maßstab 1,3, zwei Sicheln verschiedener Größe, 2 Tech-Streifen Tiefjade.')
U('lnd_t3_engineer', de='Kustos', en='Custodian', roleDe='Ingenieur', roleEn='Engineer', gait='hover',
  mass=310, energy=1550, bt=1550, bp=32, hp=700, speed=1.9, weapons=[], postMvp=[ENG_WATER],
  special=ENG_NOTE + ' Baut T1–T3-Strukturen (Hochlilie, Sintflut, Laterne III, Brunnen III).',
  parts=P('shell:team@schale_mit_randband wing:gold@deckplatte hoverpad sickle:gold*yaw@sichel sickle:gold*yaw@kleine_sichel sickle:gold@dritte_sichel orb:glow@emitter'),
  kitbash='Maßstab 1,4 (Deckel für 1×1-Footprint), drei Sicheln (Anzahl = Tech), 3 Tech-Streifen Tiefjade; dritte Sichel statisch (Anim-Limit 2).')

# ---------------------------------------------------------------- Land T1
U('lnd_t1_scout', de='Glimmer', en='Glimmer', roleDe='Späher', roleEn='Scout', gait='hover',
  mass=8, energy=60, bt=60, hp=22, speed=4.6, vision=26, radar=48,
  weapons=[W('f3:wpn_glimmer_ray_t1', 'Lichtnadel (starr im Bug, 90°)', 2, 2.0, 33, 'linear', mv=25)],
  special='Billig und weitsichtig (A8): Mass −33 % zum Funken, Waffen-RW 33 statt 22, Radar 48. Kein Turm; Waffe starr im Rumpf, arcDeg 90.',
  parts=P('shell:team hoverpad mast@nadel'),
  kitbash='Kleinste Schale (Einlage teamfarben) auf Schwebeteller, hohe dünne Nadel ≥ 1,0 × Rumpflänge ohne Kopfteil, Lichtnaht an der Spitze.')

U('lnd_t1_bot', de='Knallkrebs', en='Pistol Shrimp', roleDe='Leichter Sturmläufer', roleEn='Light Assault Walker', gait='walker',
  mass=42, energy=165, bt=160, hp=116, speed=3.8,
  weapons=[W('f3:wpn_shrimp_lance_t1', 'Pulslanze (3er-Stoß)', 9, 1.0, 14, 'linear', salvo=3, mv=25)],
  special='Robuster Überfall-Läufer (A2): Mass +31 %, HP/Mass +26 %, DPS/Mass −12 % zum Stichel. Konter gegen Schweber-Artillerie. '
          'HP 116 hält die Kreuz-Breakpoints (Kauri-Zahl der Stichel-/Punze-Treffer wie FA).',
  parts=P('legs shell:team@rueckenschild orb:team*yaw lance*pitch'),
  kitbash='Breiter Krebs-Rückenschild (breiter als lang) auf spitzen Beinen, Perle mit kurzer waagerechter Lanze; kein Schwebeteller.')

U('lnd_t1_tank', de='Kauri', en='Cowrie', roleDe='Leichter Schwebepanzer', roleEn='Light Hover Tank', gait='hover',
  mass=54, energy=270, bt=290, hp=170, speed=3.0,
  weapons=[W('f3:wpn_lance_t1', 'Lanze', 40, 1.6, 26, 'linear', mv=25)],
  special='Reichweite statt Panzerung (A1): RW 26 gegen 18 der Punze, HP/Mass −41 %. HP 170 hält die Kreuz-Breakpoints: 7 Punze-, 2 Vogt-, 4 Riegel-I-Treffer; '
          '8 eigene Treffer töten eine Punze.',
  parts=P('shell:team hoverpad orb:team*yaw lance*pitch lance:gold@schaft'),
  kitbash='Tropfenförmige Schale 1,0 × 0,35 × 1,4 WU auf Schwebeteller (Schattensaum 10 %), teamfarbene Perle Ø 0,45 WU, waagerechte Lanze 0,95 WU (≈ 68 % der Rumpflänge) über die Tropfenspitze, goldener Schaft.')

U('lnd_t1_arty', de='Dünung', en='Swell', roleDe='Mobile Artillerie', roleEn='Mobile Artillery', gait='hover',
  mass=36, energy=180, bt=200, hp=160, speed=2.7,
  weapons=[W('f3:wpn_horn_t1', 'Horn-Mörser (Präzision)', 200, 2.0, 30, 'ballistisch', minr=5, splash=0.5, mv=14, spread=0.35,
             extra='Vorbild-Relation (develop bestätigt): Stellungsbrecher. Streuung firingRandomness 0,35 wie Vorbild ist Pflicht (K1), '
                   'sonst ist die Wirkung gegen bewegte Einheiten zu hoch. Abnahme MS7 (K1/K2): 4 Dünungen gegen 4 Punzen im Zickzack '
                   '(Richtungswechsel alle 2 s) auf 25–30 WU, Trefferquote ≤ 30 % (Richtwert); gegen stehende Ziele ≥ 80 %. '
                   'Liegt sie darüber: Nachladezeit 2,0 → 3,0 s (roster.md §20). Horn leuchtet 0,5 s vor dem Schuss (nur View).')],
  special='Einzelschuss-Präzision (A4): 1 Treffer tötet Knallkrebs, Novize und Kauri, 2 eine Punze, 7 einen Riegel I. Splash 0,5 ⇒ schwach gegen Pulks.',
  parts=P('shell:team hoverpad mast*yaw@drehkranz horn*pitch shell@gegenschale'),
  kitbash='Schale auf Schwebeteller, Horn (weite Mündung, 50°) mittig auf kurzem Drehkranz, Heck-Gegenschale; keine Perle, keine waagerechte Lanze.')

U('lnd_t1_aa', de='Seeigel', en='Urchin', roleDe='Mobile Flugabwehr', roleEn='Mobile AA', gait='hover',
  mass=55, energy=275, bt=220, hp=280, speed=2.8,
  weapons=[W('f3:wpn_spine_t1', 'Stachelsalve (3er-Stoß)', 8, 1.0, 35, 'linear (Vorhalt)', salvo=3, mv=45, layers=('air',))],
  special='Nur Luftziele. RW 35 statt 30.',
  parts=P('shell:team hoverpad spine*yaw@mittelstachel spine spine'),
  kitbash='Schale auf Schwebeteller, Stachelkranz aus 3 dünnen senkrechten Stacheln (≥ 75°, Ø ≥ 0,17 WU) als Bogen quer zur Fahrtrichtung.')

# ---------------------------------------------------------------- Land T2
U('lnd_t2_tank', de='Triton', en='Triton', roleDe='Schwerer Schildpanzer', roleEn='Heavy Shield Tank', gait='hover',
  mass=360, energy=1800, bt=1600, hp=2750, speed=2.7,
  weapons=[W('f3:wpn_lance_t2', 'Doppellanze (Einzelstoß)', 360, 3.0, 20, 'linear', mv=30)],
  postMvp=[dict(feature='K10', what='Personal-Schild: Rumpf 1.300 HP + Schild 1.450 HP, Regen 2/s ab 3 s nach dem letzten Treffer, Neuaufbau 75 s, 10 E/s',
                fallback='vor K10 (MS8–MS12): health.max = HP + Schild = 2.750, kein Unterhalt; (HP+Schild)/Mass bleibt gleich')],
  special='Wenige teure Schwere (A3): Mass +80 % zum Meißel, 1 Schuss tötet Punze/Kauri/Knallkrebs, 5 einen Meißel. Balance-Basis HP + Schild.',
  parts=P('shell:team hoverpad orb:team*yaw lance lance lance:gold@schaft shell@schalenfluegel'),
  kitbash='Kauri ×1,3, lange Schale, große Perle mit zwei parallelen Lanzen (an der Perle geparentet), seitliche Schalenflügel, 2 Tech-Streifen; ab K10 Schildhülle (Shader).')

U('lnd_t2_mml', de='Brecher', en='Breaker', roleDe='Raketenwerfer', roleEn='Missile Launcher', gait='hover',
  mass=180, energy=1350, bt=800, hp=780, speed=2.8,
  weapons=[W('f3:wpn_horn_missile_t2', 'Hornrakete (Einzelschuss)', 600, 10.0, 65, 'homing (Wenderate, K11)', minr=15, splash=1.0, mv=3)],
  special='Einzelschuss-Präzision (A4): 600 statt 2×300; 4 Salven gegen Riff II und Riegel II wie FA. Lenkflugkörper mit begrenzter Wenderate (K11).',
  parts=P('shell:team hoverpad mast*yaw@drehkranz horn*pitch@horn_links horn@horn_rechts'),
  kitbash='Horn-Paar nebeneinander (50°, an einem Drehkranz), Mündungen ≥ 2 × Stachel-Ø; keine Perle, keine Stacheln.')

U('lnd_t2_aa', de='Seestern', en='Starfish', roleDe='Flak', roleEn='Flak', gait='hover',
  mass=160, energy=800, bt=800, hp=1050, speed=2.7,
  weapons=[W('f3:wpn_spine_flak_t2', 'Sprengstachel', 72, 0.5, 40, 'linear + Näherungszünder (MS12)', splash=4, mv=20, layers=('air',))],
  special='Nur Luftziele, Splash trifft Pulks.',
  parts=P('shell:team hoverpad spine*yaw spine spine spine shell@schalenfluegel'),
  kitbash='Seeigel ×1,3 mit 4 Stacheln im Kranz und Schalenflügeln, 2 Tech-Streifen.')

U('lnd_t2_shield', de='Muschel', en='Clam', roleDe='Mobiler Schild', roleEn='Mobile Shield', gait='hover',
  mass=220, energy=1080, bt=790, hp=110, speed=4.0,
  shield=dict(hp=3600, radius=15, regenPerSec=58, regenStartS=3, rechargeS=26, upkeepEnergyPerSec=55),
  weapons=[],
  special='Starke, kleine Schilde (A5): Schild/Mass +13 % zur Schürze, Radius 15 statt 16, Tempo 4,0 (folgt der Schweberlinie). Kuppelschild; Energy-Stall schaltet ab (E3).',
  parts=P('shell:team hoverpad mast ring:team*yaw@waagerecht shell@aufgeklappte_haelften'),
  kitbash='Mast mit waagerechtem Ring (Ø ≥ 1,2 × Rumpfbreite) als höchstem Punkt, darunter zwei aufgeklappte Schalenhälften; keine Lanze, keine Perle.')

U('lnd_t2_bot', de='Languste', en='Langouste', roleDe='Sturmläufer', roleEn='Assault Walker', gait='walker',
  faRole='T2 Assault Hover Tank (Vorbild hat keinen T2-Bot; Relation der schnellen T2-Sturmeinheit)',
  mass=180, energy=1080, bt=900, hp=1050, speed=4.0,
  weapons=[W('f3:wpn_langouste_lance_t2', 'Schnellfeuer-Lanzen', 15, 0.3, 24, 'linear', mv=45)],
  special='Schnelle T2-Sturmeinheit (A7): schnell und zäh, kurze Reichweite (24 < Riff I 26) – Überfälle auf Engineers und Mex, nicht auf Stellungen. '
          'Tempo 4,0 (develop) statt 4,3 (3810).',
  parts=P('legs shell:team@rueckenschild orb:team*yaw lance*pitch lance@zweite_lanze shell@schalenfluegel'),
  kitbash='Knallkrebs ×1,3 mit zweiter paralleler Lanze und seitlichen Schalenflügeln, 2 Tech-Streifen.')

# ---------------------------------------------------------------- Land T3
U('lnd_t3_bot', de='Einsiedler', en='Hermit', roleDe='Belagerungsläufer', roleEn='Siege Walker', gait='walker',
  mass=840, energy=9600, bt=3600, hp=4700, speed=2.9,
  weapons=[W('f3:wpn_hermit_lance_t3', 'Schwere Lanze', 160, 0.5, 27, 'linear', mv=40)],
  postMvp=[dict(feature='K10', what='Personal-Schild: Rumpf 3.700 HP + Schild 1.000 HP, Regen 30/s ab 2 s, Neuaufbau 30 s, 30 E/s (gewundene Schale als Emitter)',
                fallback='vor K10: health.max = HP + Schild = 4.700')],
  special='Wenige teure Schwere (A3): Mass +68 % zum Fallhammer, DPS/Mass +27 %. Balance-Basis HP + Schild.',
  parts=P('legs shell:team@rueckenschild orb:team*yaw lance*pitch lance@zweite_lanze shell@gewundene_schale'),
  kitbash='Überbreiter Rückenschild auf Beinen, Perle mit zwei Lanzen, obenauf eine gewundene Schale (Schild-Emitter ab K10), 3 Tech-Streifen; keine zweite Perle (Budget).')

U('lnd_t3_arty', de='Woge', en='Billow', roleDe='Schwere Artillerie', roleEn='Heavy Artillery', gait='hover',
  mass=800, energy=8000, bt=4300, hp=950, speed=2.2,
  weapons=[W('f3:wpn_horn_t3', 'Schweres Horn', 1425, 20.0, 90, 'ballistisch', minr=25, splash=3, mv=24, spread=1.0,
             extra='Vorbild verteilt den Schaden als DoT (15 Pulse à 95 über 4,2 s); hier ein Einschlag mit derselben Summe (kein DoT-System im MVP).')],
  special='Seltener, schwerer Einschlag statt Takt: 1.425 alle 20 s (Pfanne 700 / 10 s). Kein Deploy.',
  parts=P('shell:team@ueberlange_schale hoverpad mast*yaw@drehkranz horn*pitch shell@gegenschale'),
  kitbash='Dünung ×1,7 mit überlanger Schale, 3 Tech-Streifen.')

U('lnd_t3_sniper', de='Konus', en='Conus', roleDe='Präzisionsschweber', roleEn='Sniper Hover', gait='hover',
  faRole='T3 Sniper Bot (Vorbild-Fraktion)', cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'SNIPER', 'TECH3'],
  mass=700, energy=25000, bt=4950, hp=520, speed=2.4,
  weapons=[W('f3:wpn_conus_lance_t3', 'Langlanze (Präzision)', 950, 6.6, 60, 'linear (schnell)', mv=90)],
  special='Schwebt (Vorbild: Läufer); Icon bleibt land_sniper_t3. 3 Treffer töten einen Triton.',
  parts=P('shell:team@lange_schale hoverpad orb:team*yaw lance*pitch@langlanze'),
  kitbash='Schmale, lange Schale, Perle mit extrem langer Lanze (≥ 1,4 × Rumpflänge), keine zweite Lanze; Maßstab 1,4 (1×1-Deckel).')

U('lnd_t3_aa', de='Diadem', en='Diadem', roleDe='Schwere Flugabwehr', roleEn='Heavy AA', gait='hover',
  faRole='T3 Mobile Missile AA (FAF)',
  mass=600, energy=7500, bt=3000, hp=1800, speed=3.3,
  weapons=[W('f3:wpn_spine_missile_t3', 'Stachelrakete', 1200, 5.9, 64, 'homing (K11)', splash=1.5, mv=34, layers=('air',))],
  special='Nur Luftziele. Einzelschuss 1.200: 1 Treffer tötet Albatros und Raubmöwe.',
  parts=P('shell:team hoverpad spine*yaw spine spine spine spine'),
  kitbash='Seeigel ×1,4 (1×1-Deckel) mit 5 Stacheln im Kranz, 3 Tech-Streifen.')

# ---------------------------------------------------------------- Luft
U('air_t1_scout', de='Seeschwalbe', en='Tern', roleDe='Aufklärer', roleEn='Air Scout', gait='air',
  mass=40, energy=580, bt=200, hp=28, speed=18, vision=42, radar=64, weapons=[],
  death=dict(ref='f3:wpn_air_crash_s', damage=10, radius=1, note='Absturzschaden (K12)'),
  special='Unbewaffnet, Mindesttempo 16.',
  parts=P('shell@rumpf wing:team@schwinge wing@gabelheck'),
  kitbash='Kleinster Flieger, schmale Schwinge, gegabeltes Heck.')

U('air_t1_fighter', de='Sturmvogel', en='Petrel', roleDe='Abfangjäger', roleEn='Interceptor', gait='air',
  mass=50, energy=2250, bt=500, hp=285, speed=15,
  weapons=[W('f3:wpn_petrel_spines_t1', 'Stachelsalven (2 × 3er-Stoß)', 8, 1.0, 25, 'linear (Vorhalt)', salvo=6, mv=90, layers=('air',))],
  death=dict(ref='f3:wpn_air_crash_s', damage=25, radius=1, note='Absturzschaden (K12)'),
  special='Nur Luftziele. Referenz-DPS 48 (develop, beide Waffen; spooky 3810 zählt eine).',
  parts=P('shell@rumpfspindel wing:team@pfeilsichel wing@leitwerk'),
  kitbash='Schmale Pfeilsichel: lange Rumpfspindel, Schwingenspitzen nach hinten gebogen (lang > breit), 2 Lichtnähte hinten.')

U('air_t1_bomber', de='Tölpel', en='Gannet', roleDe='Bomber', roleEn='Bomber', gait='air',
  mass=90, energy=2050, bt=500, hp=215, speed=10,
  weapons=[W('f3:wpn_gannet_pearl_t1', 'Perlbombe', 200, 5.0, 40, 'ballistisch (Abwurf)', splash=4, mv=0, spread=0,
             extra='DPS = Salve/Nachladezeit (pro Anflug). Eine große Bombe mit Splash 4 statt Bombenreihe.')],
  death=dict(ref='f3:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  postMvp=[dict(feature='K18', what='Lähmwirkung der Perlbombe (Vorbild-Bomber)', fallback='reiner Splash-Schaden ohne Lähmung')],
  special='Einzeltreffer 200 (2 Bomben pro Punze). Snipe-Gate MS12.',
  parts=P('wing:team@ovalschwinge shell@bauchgondel wing@leitwerk'),
  kitbash='Breite Ovalschwinge (breit ≥ lang, Pfeilung ≤ 30°) mit Bauch-Gondel ≥ 1,4 × Schwingentiefe, ragt vorn und hinten sichtbar über.')

U('air_t2_gunship', de='Albatros', en='Albatross', roleDe='Kampfschweber', roleEn='Gunship', gait='air',
  mass=270, energy=5400, bt=1800, hp=880, speed=12,
  weapons=[W('f3:wpn_albatross_lance_t2', 'Hängelanze (4er-Stoß)', 78, 4.8, 20, 'linear', salvo=4, splash=2, mv=25)],
  death=dict(ref='f3:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='Schwebt im Orbit um das Ziel; Stoß mit Splash 2 statt Dauerfeuer. Kein Transport (U13 Post-MVP).',
  parts=P('shell:team@kuppel orb*yaw@haengende_perle lance*pitch'),
  kitbash='Keine Schwingen: hochgewölbte Kuppel, darunter hängende Perle mit Lanze, deren Spitze von oben sichtbar vor die Kuppel ragt.')

U('air_t2_fbomber', de='Raubmöwe', en='Skua', roleDe='Jagdbomber', roleEn='Fighter-Bomber', gait='air',
  faRole='T2 Fighter/Bomber (FAF; Vorbild hat keinen, Gegenprobe T2-Luftkampf der Vorbild-Fraktion)',
  mass=360, energy=12600, bt=2800, hp=1200, speed=15,
  weapons=[W('f3:wpn_skua_spines_t2', 'Stachelkanonen (2 Läufe)', 75, 1.0, 30, 'linear (Vorhalt)', salvo=2, mv=90, layers=('air',)),
           W('f3:wpn_skua_pearl_t2', 'Schwere Perlbombe', 800, 5.0, 60, 'ballistisch (Abwurf)', splash=3, mv=0)],
  death=dict(ref='f3:wpn_air_crash_l', damage=200, radius=1, note='Absturzschaden (K12)'),
  special='Beide Waffen addiert im DPS-Vergleich (wie FA-Referenz 310: 2 × 75 Luft + 160 Bomben). HP 1.200 hält den Breakpoint: 1 Hochlilie-/Hochrost-Salve.',
  parts=P('shell@rumpf wing:team@pfeilsichel shell@gondel_l shell@gondel_r'),
  kitbash='Pfeilsichel mit zwei Gondeln an den Schwingenspitzen, Spannweite +30 % gegenüber Sturmvogel; keine Kuppel, keine Bauch-Gondel.')

# ---------------------------------------------------------------- Wirtschaft
U('str_t1_mex', de='Brunnen I', en='Fountain I', roleDe='Massebohrung', roleEn='Mass Extractor',
  mass=36, energy=360, bt=60, bp=10, hp=380, eco=dict(massPerSec=2, upkeepEnergyPerSec=2), weapons=[],
  special='Nur auf Mass-Spots; produziert während des Upgrades weiter (B4). HP/Mass −8 % zu Varkan (A6).',
  parts=P('shell:team@kissen ring@kranz mast@stiel shell:glow*tilt@kelch'),
  kitbash='Ring um den Spot, schwebender Kelch (kleine Schale auf Stiel) mit Goldkern und Tropfen-Takt, niedrig.')
U('str_t2_mex', de='Brunnen II', en='Fountain II', roleDe='Massebohrung', roleEn='Mass Extractor',
  mass=900, energy=5400, bt=900, bp=15, hp=1950, eco=dict(massPerSec=6, upkeepEnergyPerSec=9), weapons=[],
  special='Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Akolyth/Kustos baubar. 1 Brandung-/Tiegel-Treffer.',
  parts=P('shell:team@kissen ring@kranz mast@stiel shell:glow*tilt@kelch shell@seitenschale'),
  kitbash='Brunnen auf 2×2 (Höhe ×1,2) mit Seitenschale, 2 Tech-Streifen.')
U('str_t3_mex', de='Brunnen III', en='Fountain III', roleDe='Massebohrung', roleEn='Mass Extractor',
  mass=4500, energy=31000, bt=2900, hp=6600, eco=dict(massPerSec=18, upkeepEnergyPerSec=54), weapons=[],
  special='Upgrade-Kosten.',
  parts=P('shell:team@kissen ring@kranz ring@zweiter_kranz mast@stiel shell:glow*tilt@kelch shell@seitenschale'),
  kitbash='Brunnen auf 2×2 (Höhe ×1,4), doppelter Ring, 3 Tech-Streifen; keine Bögen (unterscheidet sich so vom Quellbogen).')

U('str_t1_pgen', de='Laterne I', en='Lantern I', roleDe='Kraftwerk', roleEn='Power Generator',
  mass=75, energy=750, bt=125, hp=540, eco=dict(energyPerSec=20), weapons=[],
  death=dict(ref='f3:wpn_lantern_burst_t1', damage=250, radius=2, note='K14, Kettenreaktion-Golden MS10'),
  special='Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA). HP/Mass −13 % zu Varkan (A6).',
  parts=P('shell:team@kissen shell@flache_schale lantern:glow@laterne'),
  kitbash='Eine stehende Laterne (Linse, Zahl = Tech, Höhe ≥ 1,5 × Schalen-Ø) über einer flachen Schale, Goldkern in der Linse.')
U('str_t2_pgen', de='Laterne II', en='Lantern II', roleDe='Kraftwerk', roleEn='Power Generator',
  mass=1200, energy=12000, bt=2200, hp=2350, eco=dict(energyPerSec=500), weapons=[],
  death=dict(ref='f3:wpn_lantern_burst_t2', damage=1500, radius=5, note='K14'),
  special='1 Brandung-Treffer, 2 Tiegel-Treffer (wie FA).',
  parts=P('shell:team@kissen shell@flache_schale lantern:glow@laterne lantern:glow@laterne'),
  kitbash='Laterne auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Laternen, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.')
U('str_t3_pgen', de='Laterne III', en='Lantern III', roleDe='Kraftwerk', roleEn='Power Generator',
  mass=3200, energy=57000, bt=6800, hp=6300, eco=dict(energyPerSec=2500), weapons=[],
  death=dict(ref='f3:wpn_lantern_burst_t3', damage=5500, radius=10, note='K14, FA-Relation'),
  special='HP/Mass −30 % zu Varkan (A6, Vorbild-Relation).',
  parts=P('shell:team@kissen shell@flache_schale lantern:glow lantern:glow lantern:glow'),
  kitbash='Laterne auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Laternen, 3 Tech-Streifen.')

U('str_t1_hydro', de='Quellbogen', en='Spring Arch', roleDe='Dampfkraftwerk', roleEn='Geothermal Plant',
  mass=160, energy=800, bt=400, hp=1650, eco=dict(energyPerSec=100), weapons=[],
  special='Nur auf Hydro-Spots; keine Death-Weapon (wie FA). ID `hydro` bleibt intern.',
  parts=P('shell:team@kissen ring@kranz arch arch arch orb:glow@scheitel'),
  kitbash='Ring mit drei Bögen, die sich über dem Spot treffen; Goldkern (umschlossene Perle) im Scheitel.')

U('str_t1_mstore', de='Zisterne', en='Cistern', roleDe='Massespeicher', roleEn='Mass Storage',
  mass=200, energy=1500, bt=250, hp=680, eco=dict(storageMass=500), weapons=[],
  special='Keine Death-Weapon. HP/Mass −19 % zu Varkan (A6).',
  parts=P('shell:team@kissen shell@becken_umgedreht wing:gold@goldrand'),
  kitbash='Flaches, offenes Oval-Becken (umgedrehte Schale), Goldrand; keine Laterne, kein Ring.')
U('str_t1_estore', de='Schrein', en='Shrine', roleDe='Energiespeicher', roleEn='Energy Storage',
  mass=250, energy=1200, bt=200, hp=520, eco=dict(storageEnergy=10000), weapons=[],
  msNote='Glanzstoß (U8, MS6) feuert erst ab 7500 E Vorrat (> Grundspeicher 3900 E) ⇒ Daten-Vorgriff ab MS6; E10-Abnahme MS10',
  death=dict(ref='f3:wpn_shrine_burst', damage=1000, radius=5, note='K14'),
  special='—',
  parts=P('shell:team@kissen shell@flache_schale lantern:glow@liegend lantern:glow@liegend'),
  kitbash='Zwei liegende Laternen in flacher Schale (Höhe ≤ 0,3 × Kante); keine stehende Laterne, kein Ring.')

# ---------------------------------------------------------------- Fabriken (Kapitel)
U('str_t1_fac_land', de='Landkapitel I', en='Land Chapter I', roleDe='Landfabrik', roleEn='Land Factory',
  mass=240, energy=2100, bt=300, bp=20, hp=3300, eco=dict(storageMass=80), weapons=[],
  special='Queue/Repeat/Rally (B3). Upgrade-Verb „Weihen“ / „Consecrate“. HP/Mass −21 % zu Varkan (A6).',
  parts=P('shell:team@kissen shell:team@halbschale arch:glow*tilt@torbogen shell@rampe'),
  kitbash='Halbschale (Kuppelhalle), zur Ausgangsseite offen, goldener Torbogen mit Goldkern, Rampe.')
U('str_t2_fac_land', de='Landkapitel II', en='Land Chapter II', roleDe='Landfabrik', roleEn='Land Factory',
  mass=1400, energy=11000, bt=2300, bp=40, hp=6500, eco=dict(storageMass=160), weapons=[],
  special='Nur per Upgrade („Weihen“; kein HQ/Support-System, B9 Post-MVP).',
  parts=P('shell:team@kissen shell:team@halbschale arch:glow*tilt@torbogen shell@rampe mast:gold@turmnadel'),
  kitbash='Landkapitel ×1,3 mit goldener Turmnadel, 2 Tech-Streifen.')
U('str_t3_fac_land', de='Landkapitel III', en='Land Chapter III', roleDe='Landfabrik', roleEn='Land Factory',
  mass=5200, energy=47000, bt=12000, bp=90, hp=13000, eco=dict(storageMass=320), weapons=[],
  special='Nur per Upgrade.',
  parts=P('shell:team@kissen shell:team@halbschale arch:glow*tilt@torbogen shell@rampe mast:gold@turmnadel mast:gold@zweite_nadel shell@seitenschale'),
  kitbash='Landkapitel ×1,7 mit zwei Turmnadeln und Seitenschale, 3 Tech-Streifen.')
U('str_t1_fac_air', de='Luftkapitel I', en='Air Chapter I', roleDe='Luftfabrik', roleEn='Air Factory',
  mass=210, energy=2400, bt=300, bp=20, hp=3300, eco=dict(storageMass=80), weapons=[],
  special='Baut keine Engineers (wie FA).',
  parts=P('shell:team@kissen shell:team@halbschale arch:glow*tilt@torbogen ring@landescheibe'),
  kitbash='Halbschale mit Landescheibe (Ring) statt Rampe.')
U('str_t2_fac_air', de='Luftkapitel II', en='Air Chapter II', roleDe='Luftfabrik', roleEn='Air Factory',
  mass=920, energy=17500, bt=2300, bp=40, hp=6500, eco=dict(storageMass=160), weapons=[],
  special='Nur per Upgrade; kein T3-Luftkapitel (U12 Post-MVP).',
  parts=P('shell:team@kissen shell:team@halbschale arch:glow*tilt@torbogen ring@landescheibe mast:gold@turmnadel'),
  kitbash='Luftkapitel ×1,3 mit Turmnadel, 2 Tech-Streifen.')

# ---------------------------------------------------------------- Verteidigung
U('str_t1_pd', de='Riff I', en='Reef I', roleDe='Punktverteidigung', roleEn='Point Defense',
  mass=250, energy=2000, bt=250, hp=1300, weapons=[W('f3:wpn_reef_lance_t1', 'Lanze (Turm)', 50, 0.3, 26, 'linear', mv=35)],
  special='Dieselbe Perle mit Lanze wie der Kauri, auf dem Sockel schwebend. 6 Treffer Punze, 4 Kauri, 3 Knallkrebs; 7 Dünung-Treffer.',
  parts=P('shell:team@kissen orb:team*yaw lance*pitch'),
  kitbash='Kissen-Sockel, darüber schwebend Perle mit waagerechter Lanze.')
U('str_t2_pd', de='Riff II', en='Reef II', roleDe='Punktverteidigung', roleEn='Point Defense',
  mass=540, energy=3800, bt=680, hp=2100,
  weapons=[W('f3:wpn_reef_lance_t2', 'Schwere Lanze (Einzelstoß)', 600, 4.0, 50, 'linear', splash=2, mv=45)],
  special='Einzelschuss-Präzision (A4): 600 / 4 s mit Splash 2 statt Schnellfeuer; tötet Punze und Kauri mit 1, Meißel mit 3 Schüssen. Kein Upgrade von Riff I.',
  parts=P('shell:team@kissen orb:team*yaw lance lance@zweite_lanze shell@schuerze'),
  kitbash='Riff ×1,3 mit zwei parallelen Lanzen (an der Perle geparentet) und Schürzenschale, 2 Tech-Streifen.')
U('str_t1_aa', de='Seelilie I', en='Sea Lily I', roleDe='Flugabwehrturm', roleEn='AA Tower',
  mass=150, energy=1500, bt=190, hp=820,
  weapons=[W('f3:wpn_lily_spines_t1', 'Stachelsalve (3er-Stoß)', 14, 0.6, 44, 'linear (Vorhalt)', salvo=3, mv=45, layers=('air',))],
  special='Nur Luftziele. 1 Salve tötet eine Seeschwalbe.',
  parts=P('shell:team@kissen spine*yaw spine spine'),
  kitbash='Stachelkranz (3 Stacheln) auf teamfarbenem Kissen-Sockel.')
U('str_t2_aa', de='Seelilie II', en='Sea Lily II', roleDe='Flakturm', roleEn='Flak Tower',
  mass=400, energy=4000, bt=540, hp=2550,
  weapons=[W('f3:wpn_lily_flak_t2', 'Sprengstachel (Turm)', 150, 1.0, 50, 'linear + Näherungszünder (MS12)', splash=3, mv=35, layers=('air',))],
  special='Nur Luftziele.',
  parts=P('shell:team@kissen spine*yaw spine spine spine shell@schuerze'),
  kitbash='Seelilie ×1,3 mit 4 Stacheln und Schürzenschale, 2 Tech-Streifen.')
U('str_t3_sam', de='Hochlilie', en='High Lily', roleDe='Raketenabwehr', roleEn='SAM Site',
  msNote='MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Kustos)',
  mass=800, energy=8000, bt=1400, hp=5000,
  weapons=[W('f3:wpn_high_lily_sam_t3', 'Stachelraketen (2er)', 600, 3.5, 60, 'homing + Näherungszünder', salvo=2, splash=1.5, mv=45, layers=('air',))],
  special='Nur Luftziele. 1 Salve tötet Albatros, Raubmöwe, Krähe und Elster.',
  parts=P('shell:team@kissen spine*yaw spine spine spine spine spine'),
  kitbash='Kissen-Sockel auf 2×2 mit doppelt so vielen, dickeren Stacheln (6), 3 Tech-Streifen.')
U('str_t1_wall', de='Deich', en='Dike', roleDe='Mauer', roleEn='Wall',
  mass=3, energy=20, bt=15, hp=520, weapons=[],
  special='wall-Flag (Drag-Linie), blockiert Schüsse und Pathing.',
  parts=P('shell:team@wulst'),
  kitbash='Niedrige, gerundete Wulstkette; nur der Kamm teamfarben (≈ 10 %, Maske).')

# ---------------------------------------------------------------- Intel & Schilde
U('str_t1_radar', de='Warte I', en='Lookout I', roleDe='Radar', roleEn='Radar',
  mass=80, energy=720, bt=80, bp=13, hp=11, eco=dict(upkeepEnergyPerSec=20), weapons=[],
  special='Stall schaltet ab (E3), Wiedereinschalten mit Hysterese. Sehr fragil (FA-Relation).',
  parts=P('shell:team@kissen mast fan*yaw@faecher'),
  kitbash='Hoher dünner Mast mit Fächer (Halbkreisplatte 1,6 × 0,8 WU, 35° gekippt), rotierend; kein Ring.')
U('str_t2_radar', de='Warte II', en='Lookout II', roleDe='Radar', roleEn='Radar',
  mass=180, energy=3600, bt=780, bp=20, hp=55, eco=dict(upkeepEnergyPerSec=150), weapons=[],
  special='Nur per Upgrade.',
  parts=P('shell:team@kissen mast mast fan*yaw@faecher'),
  kitbash='Warte auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.')
U('str_t3_radar', de='Warte III', en='Lookout III', roleDe='Radar', roleEn='Radar',
  faRole='T3 Omni Sensor Array (Upgrade-Kosten; hier ohne Omni)',
  mass=1200, energy=16000, bt=1500, hp=55, eco=dict(upkeepEnergyPerSec=400), weapons=[],
  special='Wie Varkan: kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation.',
  parts=P('shell:team@kissen mast mast fan*yaw@faecher fan@zweiter_faecher'),
  kitbash='Warte auf 2×2 (Höhe ×1,4) mit zweitem Fächer, 3 Tech-Streifen.')

U('str_t2_shield', de='Perlmutt II', en='Nacre II', roleDe='Schildgenerator', roleEn='Shield Generator',
  mass=480, energy=5800, bt=950, bp=20, hp=160,
  shield=dict(hp=11200, radius=20, regenPerSec=138, regenStartS=3, rechargeS=24, upkeepEnergyPerSec=150),
  eco=dict(upkeepEnergyPerSec=150), weapons=[],
  special='Starke, kleine Schilde (A5): Schild/Mass +51 % zu Schirm II, Radius 20 statt 24. Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab.',
  parts=P('shell:team@kissen shell@fussschale mast ring:team*yaw@waagerecht'),
  kitbash='Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), flache Fußschale.')
U('str_t3_shield', de='Perlmutt III', en='Nacre III', roleDe='Schildgenerator', roleEn='Shield Generator',
  mass=2400, energy=44000, bt=4100, hp=320,
  shield=dict(hp=18000, radius=35, regenPerSec=150, regenStartS=1, rechargeS=24, upkeepEnergyPerSec=300),
  eco=dict(upkeepEnergyPerSec=300), weapons=[],
  special='Upgrade wie Varkan (gleicher Hotbuild-Weg); das Vorbild baut den T3-Schild neu, die Kosten hier sind dessen Neubaukosten als Upgrade-Kosten '
          '(Gesamtkosten 2.880 statt 2.400). regenStartS 1 wie Varkans T3-Schild.',
  parts=P('shell:team@kissen shell@fussschale mast ring:team*yaw@waagerecht ring@zweiter_ring shell@schuerze'),
  kitbash='Perlmutt auf 6×6 (Höhe ×1,4) mit zweitem Ring und Schürzenschale, 3 Tech-Streifen.')

# ---------------------------------------------------------------- Artilleriestellungen
U('str_t2_arty', de='Brandung', en='Surf', roleDe='Artilleriestellung', roleEn='Artillery Emplacement',
  mass=2080, energy=14900, bt=1600, hp=2300,
  weapons=[W('f3:wpn_surf_horn_t2', 'Brandungsgranate', 2875, 20.0, 115, 'ballistisch', minr=50, splash=2.25, mv=26, spread=2.0,
             extra='Vorbild: 5 DoT-Pulse à 575; hier ein Einschlag mit derselben Summe. Streuung wie Vorbild (FiringRandomness 2,0, K1).')],
  special='Einzelschuss-Präzision (A4): DPS/Mass +31 % zum Tiegel bei kleinerem Splash; 1 Treffer tötet Brunnen II, Riff I, Laterne II und Glutkessel II.',
  parts=P('shell:team@kissen mast*yaw@lafette horn*pitch shell@gegenschale'),
  kitbash='Großes Horn auf Lafette über Kissen-Sockel, Gegenschale.')
U('str_t3_arty', de='Sintflut', en='Deluge', roleDe='Schwere Artilleriestellung', roleEn='Heavy Artillery Emplacement',
  faRole='T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert)',
  mass=48800, energy=915000, bt=80000, hp=8000,
  weapons=[W('f3:wpn_deluge_horn_t3', 'Sintflutgranate (Doppelschlag)', 6000, 30.0, 200, 'ballistisch', salvo=2, minr=60, splash=5, mv=55, spread=0.35,
             extra='Vorbild: 2 Pulse à 6.000 alle 20 s, RW 825. Skaliert wie Varkans Hochofen: RW 200 (Gate ≤ 40 % der kleinsten Kartendiagonale), '
                   'Kosten ≈ 67 %, gleicher Doppelschlag (12.000) für den Schild-Burst, Feuerrate ×⅔; DPS/Mass und HP/Mass ±0.')],
  special='Maßstabs-Sonderfall wie Hochofen; Kartenpool ≥ 354 WU (roster.md §20).',
  parts=P('shell:team@kissen mast*yaw@lafette horn*pitch shell@gegenschale shell@lafettenschale'),
  kitbash='Brandungs-Silhouette auf 8×8: Lafette, Horn Ø 3,0 WU × 7 WU, Gegenschale; 3 Tech-Streifen.')

# ---------------------------------------------------------------- abgeleitete Felder (wie tools/roster/gen.py)
H_TECH = {0: 1.0, 1: 1.0, 2: 1.2, 3: 1.4}
MOB_SCALE = {0: 1.0, 1: 1.0, 2: 1.3, 3: 1.7}
MOB_CAP_1x1 = 1.4
FLOW_CATS = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
BY_ID = {u['id']: u for u in R}


def fa_reload(rof):
    return math.floor(10 / rof + 1e-6) / 10


def fa_weapon(fa, bp, idx=None):
    ws = fa[bp]['weapons']
    if idx is not None:
        w = ws[idx]
    else:
        ok = [w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
        w = max(ok, key=lambda w: w['dps'])
    rel = fa_reload(w['rof'])
    salvo = round(w['dps'] * rel / w['dmg'])
    return dict(damage=w['dmg'], salvo=salvo, reloadS=rel, splash=w['splash'] or 0)


def fa_target_hp(fa, bp):
    """Ziel-HP für Treffer-bis-Tod: bei Personal-Schild (nicht Kuppel) zählt der Schild mit."""
    r = fa[bp]
    personal = 'Personal Shield' in (r.get('abilities') or []) or bp in ('UEL0303',)
    return r['hp'] + ((r['shield'] or 0) if personal else 0)


def fa_metrics(bp):
    r = FA[bp]
    hp = r['hp'] + (r['shield'] or 0)
    dps = r['dps']
    return dict(bp=bp, mass=r['mass'], energy=r['energy'], buildTime=r['bt'], hp=r['hp'], shieldHp=r['shield'],
                dps=round(dps, 2), dpsPerMass=round(dps / r['mass'], 4) if dps else None,
                hpPerMass=round(hp / r['mass'], 4), speed=r['speed'],
                range=max([w['range'] or 0 for w in r['weapons'] if w['cat'] not in ('Death', None) and (w['dmg'] or 0) > 0] or [0]) or None)


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
    fa = fa_metrics(u['faRef'])
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
        w = ws[0]; fw = fa_weapon(FA, u['faRef'])
        ours = w['damage'] * w['salvo'] * pulk_targets(w['splash']) / w['reloadS'] / u['mass']
        theirs = fw['damage'] * fw['salvo'] * pulk_targets(fw['splash']) / fw['reloadS'] / fa['mass']
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
    stripes = 0 if (u['tech'] == 0 or 'WALL' in u['cats']) else u['tech']
    hover_h = {1: 0.25, 2: 0.30, 3: 0.35, 0: 0.25}[u['tech']] if u['gait'] == 'hover' else None
    personal = next((p for p in u['postMvp'] if p['feature'] == 'K10'), None)
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
                     accel=u.get('accel'), sizeClass=u['sizeClass'], footprint=u['footprint'], gait=u['gait'],
                     **({'hoverHeightView': hover_h} if hover_h else {})) if mobile
                else dict(layer='land', speed=0, footprint=u['footprint'], structure=True)),
        intel={k: v for k, v in dict(vision=u.get('vision'), radar=u.get('radar')).items() if v is not None},
        special=dict(toggles=u.get('toggles', []), upgradesTo=u.get('upgradesTo'), upgradeFrom=u.get('upgradeFrom'),
                     adjacency=u.get('adjacency'), deathWeapon=u.get('death'), notes=u['special'], postMvp=u['postMvp']),
        hotbuild=(dict(menu=u['hotbuild'][0], slot=u['hotbuild'][1]) if u['hotbuild'] else None),
        icon=u['icon'],
        kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris, techStripes=stripes,
                     techStripeMat='jade' if stripes else None, scale=scale, description=u['kitbash']),
        balance=dict(dps=round(dps, 2) if dps else None, dpsPerMass=round(dps / u['mass'], 4) if dps else None,
                     hpPerMass=round(hp_eff / u['mass'], 4),
                     hpBasis='HP+Schild' if (u.get('shield') or personal or FA[u['faRef']]['shield']) else 'HP',
                     fa=fa, devDpsPerMassPct=dev_d, devHpPerMassPct=dev_h, devProductPct=dev_p,
                     pulk=pulk, withinBand25=inband, withinTarget15=in15),
    )
    if u['group'] == 'air':
        e['motion']['accel'] = None
        e['motion']['note'] = 'kinematisches Flugmodell: speed = Reisetempo, turnRateDeg = Entwurfswert (FA: Air.TurnSpeed)'
    out.append(e)
E = {e['id']: e for e in out}
VK_E = {u['id']: u for u in VK['units']}


def hit_row(att, wi, fwi, tgt, fa_att, fa_tgt, a_bp, t_bp, required=True):
    w = att['weapons'][wi]; fw = fa_weapon(fa_att, a_bp, fwi)
    thp = tgt['health']['max']
    fthp = fa_target_hp(fa_tgt, t_bp)
    ours = math.ceil(thp / (w['damage'] * w['salvo'])); theirs = math.ceil(fthp / (fw['damage'] * fw['salvo']))
    return dict(attacker=att['id'], weapon=w['ref'], target=tgt['id'], salvoDamage=w['damage'] * w['salvo'], targetHp=thp,
                hits=ours, ttkS=round((ours - 1) * w['reloadS'], 1),
                fa=dict(attacker=a_bp, target=t_bp, salvoDamage=fw['damage'] * fw['salvo'],
                        targetHp=fthp, hits=theirs, ttkS=round((theirs - 1) * fw['reloadS'], 1)),
                match=ours == theirs, required=required)


# ---------------------------------------------------------------- Treffer-bis-Tod innerhalb Sael (exakt Vorbild)
S = lambda r: 'f3:' + r
HTK_PAIRS = [(S('cmd_commander'), 0, 0, S(t)) for t in
             ('lnd_t1_bot', 'lnd_t1_tank', 'lnd_t1_arty', 'lnd_t1_aa', 'lnd_t1_engineer', 'lnd_t1_scout')] + [
    (S('str_t1_pd'), 0, None, S('lnd_t1_tank')), (S('str_t1_pd'), 0, None, S('lnd_t1_bot')),
    (S('lnd_t1_arty'), 0, None, S('lnd_t1_bot')), (S('lnd_t1_arty'), 0, None, S('lnd_t1_engineer')),
    (S('lnd_t1_arty'), 0, None, S('lnd_t1_tank')), (S('lnd_t1_arty'), 0, None, S('str_t1_pd')),
    (S('lnd_t2_tank'), 0, None, S('lnd_t1_bot')), (S('lnd_t2_tank'), 0, None, S('lnd_t1_tank')),
    (S('lnd_t2_mml'), 0, None, S('str_t2_pd')),
    (S('str_t2_pd'), 0, None, S('lnd_t1_tank')), (S('str_t2_pd'), 0, None, S('lnd_t2_tank')),
    (S('lnd_t3_sniper'), 0, None, S('lnd_t2_tank')),
    (S('str_t2_arty'), 0, None, S('str_t2_mex')), (S('str_t2_arty'), 0, None, S('str_t1_pd')),
    (S('str_t2_arty'), 0, None, S('str_t2_pgen')),
    (S('str_t1_aa'), 0, None, S('air_t1_scout')),
    (S('str_t3_sam'), 0, None, S('air_t2_gunship')), (S('str_t3_sam'), 0, None, S('air_t2_fbomber')),
]
htk = [hit_row(E[a], wi, fwi, E[t], FA, FA, BY_ID[a]['faRef'], BY_ID[t]['faRef']) for a, wi, fwi, t in HTK_PAIRS]

# ---------------------------------------------------------------- Kreuz-Breakpoints gegen Varkan (faction.md §9.4)
# Regel: Salven Varkan-Waffe -> Sael-Ziel = Salven der FA-Referenz der Varkan-Rolle gegen die FA-Vorbild-Einheit, und umgekehrt.
V = lambda r: 'core:' + r


def side(i):
    if i.startswith('f3:'):
        return E[i], FA, BY_ID[i]['faRef']
    u = VK_E[i]
    return u, FA_VK, u['faReference']['bp']


def cross(a, t, wi=0, fwi=None, required=True):
    A_, fa_a, a_bp = side(a); T_, fa_t, t_bp = side(t)
    if a.endswith('cmd_commander') and fwi is None: fwi = 0
    return hit_row(A_, wi, fwi, T_, fa_a, fa_t, a_bp, t_bp, required)


CROSS_REQ = [  # §9.4 Pflichtpaare + Ergänzungen
    (V('lnd_t1_tank'), S('lnd_t1_tank')), (S('lnd_t1_tank'), V('lnd_t1_tank')), (V('cmd_commander'), S('lnd_t1_tank')),
    (S('cmd_commander'), V('lnd_t1_tank')), (S('lnd_t2_tank'), V('lnd_t1_tank')), (S('lnd_t2_tank'), V('lnd_t2_tank')),
    (V('str_t1_pd'), S('lnd_t1_tank')), (S('str_t1_pd'), V('lnd_t1_tank')),
    (V('lnd_t2_tank'), S('lnd_t2_tank')), (V('cmd_commander'), S('lnd_t2_tank')), (V('str_t2_pd'), S('lnd_t2_tank')),
    (V('lnd_t1_tank'), S('lnd_t1_bot')), (V('lnd_t1_bot'), S('lnd_t1_bot')), (S('lnd_t1_bot'), V('lnd_t1_tank')),
    (V('lnd_t1_arty'), S('lnd_t1_tank')), (V('lnd_t1_arty'), S('lnd_t1_engineer')), (V('lnd_t1_arty'), S('str_t1_pd')),
    (S('lnd_t1_arty'), V('lnd_t1_tank')), (S('lnd_t1_arty'), V('lnd_t1_bot')), (S('lnd_t1_arty'), V('lnd_t1_engineer')),
    (S('lnd_t1_arty'), V('str_t1_pd')),
    (S('lnd_t2_mml'), V('str_t2_pd')), (V('lnd_t2_mml'), S('str_t2_pd')),
    (S('str_t2_pd'), V('lnd_t2_tank')),
    (S('str_t2_arty'), V('str_t2_mex')), (S('str_t2_arty'), V('str_t2_pgen')), (S('str_t2_arty'), V('str_t1_pd')),
    (V('str_t2_arty'), S('str_t2_mex')), (V('str_t2_arty'), S('str_t2_pgen')), (V('str_t2_arty'), S('str_t1_pd')),
    (V('str_t3_sam'), S('air_t2_gunship')), (V('str_t3_sam'), S('air_t2_fbomber')),
    (S('str_t3_sam'), V('air_t2_gunship')), (S('str_t3_sam'), V('air_t2_fbomber')),
    (V('air_t1_fighter'), S('air_t1_fighter')), (V('str_t1_aa'), S('air_t1_scout')), (S('str_t1_aa'), V('air_t1_scout')),
    (S('air_t1_bomber'), V('lnd_t1_tank')), (S('air_t1_bomber'), V('lnd_t1_engineer')),
]
# Info-Paare: Spiegel der internen Varkan-Matrix; Abweichungen entstehen, wo Varkan selbst von FA abweicht (z. B. Punze 28 statt 24)
CROSS_INFO = [(V('lnd_t1_bot'), S('lnd_t1_tank')), (S('air_t1_fighter'), V('air_t1_fighter')), (V('lnd_t1_tank'), S('lnd_t1_arty')),
              (V('lnd_t1_bot'), S('lnd_t1_engineer')), (S('lnd_t1_bot'), V('lnd_t1_bot')), (S('lnd_t1_tank'), V('lnd_t1_bot')),
              (V('lnd_t2_tank'), S('lnd_t1_bot')), (V('lnd_t2_tank'), S('lnd_t1_tank')), (S('lnd_t3_sniper'), V('lnd_t2_tank')),
              (V('lnd_t3_sniper'), S('lnd_t2_tank')), (V('str_t1_pd'), S('lnd_t1_bot')), (S('str_t1_pd'), V('lnd_t1_bot'))]
cross_htk = [cross(a, t) for a, t in CROSS_REQ] + [cross(a, t, required=False) for a, t in CROSS_INFO]

# ---------------------------------------------------------------- T1-Rush gegen den Kommandanten (Review 2026-09-29, tools/roster/f3/rush.py)
# Pflicht: Panzer-Rush eigener und fremder T1-Panzer gegen Prior bzw. Vogt braucht dieselbe Stückzahl wie die FA-Paarung
# (ohne und mit Sonderschuss). Info: Varkan intern und leichte Sturmeinheiten.
import sys
sys.path.insert(0, str(HERE))
import rush as RUSH
RUSH_PAIRS = [(S('lnd_t1_tank'), S('cmd_commander'), True), (V('lnd_t1_tank'), S('cmd_commander'), True),
              (S('lnd_t1_tank'), V('cmd_commander'), True), (V('lnd_t1_tank'), V('cmd_commander'), False),
              (S('lnd_t1_bot'), S('cmd_commander'), False), (V('lnd_t1_bot'), S('cmd_commander'), False),
              (S('lnd_t1_bot'), V('cmd_commander'), False)]
rush = []
for a, c, req in RUSH_PAIRS:
    A_, fa_a, a_bp = side(a); C_, fa_c, c_bp = side(c)
    rush.append(RUSH.row(A_, C_, fa_a, a_bp, fa_c, c_bp, req))


# ---------------------------------------------------------------- Schildbrechen (Info)
def shots_to_break(w, sh):
    net_regen = sh['regenPerSec'] * max(0.0, w['reloadS'] - sh['regenStartS'])
    dmg = w['damage'] * w['salvo']
    if dmg <= net_regen: return None
    n = 1
    while n * dmg - (n - 1) * net_regen < sh['hp']: n += 1
    return n


shield_break = []
for a, t in ((S('str_t2_arty'), S('str_t2_shield')), (S('str_t3_arty'), S('str_t2_shield')), (S('str_t3_arty'), S('str_t3_shield')),
             (S('lnd_t3_arty'), S('str_t2_shield')), (V('str_t2_arty'), S('str_t2_shield')), (V('str_t3_arty'), S('str_t3_shield')),
             (S('str_t2_arty'), V('str_t2_shield')), (S('str_t3_arty'), V('str_t3_shield'))):
    A_, fa_a, a_bp = side(a); T_, fa_t, t_bp = side(t)
    w = A_['weapons'][0]; sh = T_['shield']; n = shots_to_break(w, sh)
    fw = fa_weapon(fa_a, a_bp); fsh = dict(sh, hp=fa_t[t_bp]['shield']); fn = shots_to_break(fw, fsh)
    shield_break.append(dict(attacker=a, target=t, shots=n, timeS=round((n - 1) * w['reloadS'], 1) if n else None,
                             faShots=fn, faTimeS=round((fn - 1) * fw['reloadS'], 1) if fn else None,
                             note='Einzelner Schütze; FA-Waffe gegen FA-Schild-HP mit gleicher Regeneration/Verzögerung'))

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

# ---------------------------------------------------------------- Checks / Lints (faction.md §3.3, §5.3)
ids = [e['id'] for e in out]
assert len(ids) == len(set(ids))
assert len(out) == 50
vk_roles = {i.split(':')[1] for i in VK_E}
assert {i.split(':')[1] for i in ids} == vk_roles, 'Rollenabdeckung weicht von Varkan ab'
for e in out:
    k = e['kitbash']; b = e['balance']; cats = set(e['categories']); v = VK_U[e['id'].split(':')[1]]
    assert e['icon'] == v['icon'] and e['ms9Core'] == v['ms9Core'] and e['msFirst'] == v['msFirst'], e['id']
    assert (e['hotbuild'] or {}).get('slot') == (v['hotbuild'] or {}).get('slot'), e['id']
    assert k['animatedParts'] <= 2, e['id']
    lim = 7 if e['group'] in ('cmd', 'land', 'air') else 9
    assert k['partCount'] <= lim, (e['id'], k['partCount'])
    assert k['trisEstimate'] <= 350, (e['id'], k['trisEstimate'])
    assert b['withinBand25'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'])
    assert b['withinTarget15'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'], b['devProductPct'])
    if b['pulk']: assert abs(b['pulk']['devPct']) <= 15, (e['id'], b['pulk'])
    for kk in ('upgradesTo', 'upgradeFrom'):
        if e['special'][kk]: assert e['special'][kk] in ids, (e['id'], kk)
    flow = bool(cats & FLOW_CATS)
    pn = [p['part'] for p in k['parts']]
    for p in k['parts']:
        if p['part'] in ('lantern', 'sickle') or p.get('mat') == 'glow':
            assert flow, ('Licht-Monopol', e['id'], p)
        if p['part'] == 'spine':
            assert 'ANTIAIR' in cats and 'AIR' not in cats, ('Stachel-Monopol', e['id'])
        if p['part'] == 'horn':
            assert 'ARTILLERY' in cats, ('Horn-Monopol', e['id'])
    if 'lance' in pn: assert 'orb' in pn, ('Lanze ohne Perle', e['id'])
    if 'orb' in pn and 'lance' not in pn: assert flow, ('Perle ohne Lanze außerhalb Flow', e['id'])
    assert pn.count('orb') <= 1, ('max. 1 Perle', e['id'])
    if 'hoverpad' in pn: assert e['motion'].get('gait') == 'hover', ('Schwebeteller nur bei Schwebern', e['id'])
    if e['motion'].get('gait') == 'hover': assert 'hoverpad' in pn, ('Schweber ohne Schwebeteller', e['id'])
    if e['motion'].get('gait') == 'walker': assert 'legs' in pn, e['id']
    assert any(p.get('mat') == 'team' for p in k['parts']), ('Teamfarbe', e['id'])
    if e['special']['upgradesTo'] and 'STRUCTURE' in cats:
        assert e['economy'].get('buildPower'), ('buildPower', e['id'])
    if e['shield']: assert 'regenStartS' in e['shield'], e['id']
    for w in e['weapons']:
        assert abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, w['ref']
        assert w['ref'].startswith('f3:wpn_'), w['ref']
for h in htk:
    assert h['match'], ('Treffer-bis-Tod', h)
for h in cross_htk:
    if h['required']: assert h['match'], ('Kreuz-Treffer-bis-Tod', h)
for r_ in rush:
    if r_['required']: assert r_['match'], ('Rush', r_)
for vid, v in visuals.items():
    assert v['supersetParts'] <= (8 if v['mobile'] else 9), (vid, v['supersetParts'])
    assert v['trisEstimate'] <= 350, (vid, v['trisEstimate'])
assert set(visuals) == set(VK['visuals']), 'Visual-IDs weichen von Varkan ab'

glyphs = sorted({re.sub(r'^(land|air|eng|struct)_', '', re.sub(r'_t\d$', '', e['icon'])) for e in out
                 if e['icon'] not in ('cmd_commander', 'wall')})
assert glyphs == VK['iconGlyphs']

# Experimentals (T4, Post-MVP): Daten und Gates in exp.py, Design in experimentals.md; nicht in units/counts.total
import sys as _sys  # noqa: E402
_sys.path.insert(0, str(HERE))
import exp as EXP  # noqa: E402
EXPERIMENTALS, exp_err = EXP.build(icon_glyphs=glyphs, own_units=E)
assert not exp_err, ('T4-Gates', exp_err)

n9 = sum(e['ms9Core'] for e in out)
mob = sum(1 for e in out if e['group'] in ('cmd', 'land', 'air'))
hb = json.loads(rn(json.dumps(VK['hotbuildGrid'], ensure_ascii=False)))
hb = {MENU.get(k, k): v for k, v in hb.items()}
hb['Landkapitel']['Q'] = hb['Landkapitel']['Q'].replace('Panzer', 'Schwebepanzer')
hb['Landkapitel']['S'] = hb['Landkapitel']['S'].replace('Bots', 'Läufer')
_rule = hb.pop('rule')
hb['Bau (T4-Tab, Post-MVP)'] = {e['hotbuild']['slot']: e['name']['de'] for e in sorted(EXPERIMENTALS, key=lambda e: 'QWERT'.index(e['hotbuild']['slot']))}
hb['rule'] = _rule + ' T4 im eigenen Tab des Bau-Menüs (Q Land-Sturm, W Game-Ender, E Land-Festung, R Luft, T Eco), Tastenbelegung fraktionsübergreifend.'
conv = dict(VK['conventions'])
conv.update(
    commander='Prior: Mass 2000 nominell (nicht baubar), DPS nur Hauptwaffe (Lanze)',
    techStripes='Breite 0,10 WU × Maßstab, Abstand 0,10 WU, im hinteren Drittel der Schale; Tiefjade #1E4A40 (auch bei Engineers); Prior und Deich ohne Streifen',
    faSource='FA-Referenz der Vorbild-Fraktion: FAForever/spooky-db app/data/index.json (Version 3810) über tools/roster/f3/fa_ref.json, '
             'DPS-Formel app/js/dps.js; Korrekturen in faOverrides, geprüft gegen FAForever/fa develop (faDevelopCheck)',
    faOverrides={b: o['note'] for b, o in FA_OVERRIDES.items()} | {'air speed': 'UAA0101/0102/0103/0203, DEA0202: Air.MaxAirspeed aus develop'},
    faDevelopCheck=FA_DEVELOP_CHECK,
    hitsToKill='Treffer (Salven) bis zum Tod = ceil(Ziel-HP / Salvenschaden); Pflichtpaare in checks.hitsToKill müssen exakt der FA-Referenz '
               'der Vorbild-Fraktion entsprechen. Bei FA-Zielen mit Personal-Schild zählt der Schild zur Ziel-HP.',
    crossHitsToKill='Kreuz-Breakpoints gegen Varkan (faction.md §9.4): Salven einer Waffe der einen Fraktion gegen ein Ziel der anderen = '
                    'Salven der jeweiligen FA-Referenzen gegeneinander. required=true muss exakt passen, required=false ist Info '
                    '(Abweichung, weil Varkan dort selbst von FA abweicht).',
    gait='motion.gait: hover | walker | air. hoverHeightView = Schwebehöhe nur im View (faction.md §3.2). Im MVP laufen Schweber im Layer land (M13 markiert).',
    postMvp='special.postMvp: Asymmetrien mit Post-MVP-Mechanik, je {feature, what, fallback}; die Kern-Balance gilt mit dem fallback.',
    firingRandomness='weapons[].firingRandomness (optional, Review 2026-09-29): Streuung in FA-Semantik (FiringRandomness aus FAF develop); '
                     'Pflicht bei ballistischen ARTILLERY-Waffen. K1 legt die Umrechnung in Sim-Einheiten fest.',
    rush='checks.rush: Mindestzahl T1-Einheiten, die einen Kommandanten im offenen Schlagabtausch töten (ohne/mit Sonderschuss), '
         'Modell in tools/roster/f3/rush.py; required=true muss der FA-Paarung entsprechen.',
    hpBasis='Bei Schild-Einheiten (eigene, Personal-Schild-Fallback oder FA-Referenz) wird HP+Schild-HP verglichen',
    experimentals='experimentals[] = T4-Rollen (Post-MVP, tier T4, nicht in counts.total/units). Gates gegen die T4-Referenz der Vorbild-Fraktion '
                  '(tools/roster/f3/fa_ref_t4.json, spooky 3810 + FA_T4_OVERRIDES in exp.py): ±25 % hart; Boden-DPS/Mass, Luft-DPS/Mass, '
                  'HP(+Schild)/Mass, Produkt und Pulk je ±15 %. Sael-Identität: Hauptwaffen-RW ≥ Vorbild, Schild-Anteil mobiler T4 ≥ 25 %, '
                  'T4-Strukturen HP/Mass < Vorbild (A6). Setons-Brücke: Außenmaß ≤ 12 WU (≥ 6 nebeneinander auf 72 WU). T4-Kitbash-Budget: '
                  'Tris L0/L1/L2 1500/800/320 wie @faf/modelkit T4_BUDGET (T4-Tris-Tabelle in exp.py), ≤ 10 Part-Einträge, ≤ 3 animiert; Monopol-Lints wie §5.3 Nr. 6. '
                  'sizeClass = ceil(Außenmaß / 2) (Clearance-Radius, wie f4). '
                  'reservedPostMvp[] spiegelt die T4-Namen für den Namensabgleich in cross.py. Design: experimentals.md.',
    faT4DevelopCheck=EXP.FA_T4_DEVELOP,
)
doc = dict(
    schema='faf-roster/1', faction='f3 (Orden von Sael)', generated='2026-09-29', language='de',
    sourceOfTruth='roster.json ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts der Fraktion f3; '
                  'docs/design/factions/f3/faction.md und roster.md verweisen darauf.',
    counts=dict(total=len(out), mobile=mob, structures=len(out) - mob, ms9Core=n9, visuals=len(visuals), iconGlyphs=len(glyphs),
                reservedPostMvp=len(EXPERIMENTALS), experimentals=len(EXPERIMENTALS)),
    conventions=conv,
    hotbuildGrid=hb,
    silhouettePairs=dict(
        ms9=[[S('lnd_t1_tank'), S('lnd_t1_aa')], [S('lnd_t1_arty'), S('lnd_t1_aa')], [S('lnd_t2_mml'), S('lnd_t2_aa')],
             [S('lnd_t2_tank'), S('lnd_t2_mml')], [S('lnd_t1_bot'), S('lnd_t1_tank')], [S('lnd_t1_engineer'), S('lnd_t1_scout')],
             [S('str_t1_pd'), S('str_t1_aa')], [S('str_t1_mex'), S('str_t1_pgen')], [S('str_t1_pgen'), S('str_t1_estore')],
             [S('str_t1_mstore'), S('str_t1_estore')]],
        ms14=[[S('air_t1_bomber'), S('air_t1_fighter')], [S('air_t1_fighter'), S('air_t2_fbomber')], [S('air_t1_scout'), S('air_t1_bomber')],
              [S('str_t1_radar'), S('str_t2_shield')], [S('lnd_t1_scout'), S('lnd_t2_shield')], [S('lnd_t3_sniper'), S('lnd_t2_tank')],
              [S('str_t3_arty'), S('str_t3_pgen')], [S('str_t3_mex'), S('str_t1_hydro')]],
        t4=[['f3:exp_lnd_assault', S('lnd_t3_bot')], ['f3:exp_lnd_fortress', S('lnd_t3_sniper')], ['f3:exp_lnd_assault', 'f3:exp_lnd_fortress'],
            ['f3:exp_air_carrier', S('air_t1_bomber')], ['f3:exp_str_arty', S('str_t3_arty')], ['f3:exp_str_eco', S('str_t3_mex')]],
        crossFaction=[[S('lnd_t1_tank'), V('lnd_t1_tank')], [S('lnd_t1_aa'), V('lnd_t1_aa')], [S('lnd_t1_arty'), V('lnd_t1_arty')],
                      [S('lnd_t1_engineer'), V('lnd_t1_engineer')], [S('str_t1_pd'), V('str_t1_pd')]],
    ),
    iconGlyphs=glyphs,
    visuals={k: dict(members=v['members'], supersetParts=v['supersetParts'], trisEstimate=v['trisEstimate'], parts=v['counts'])
             for k, v in visuals.items()},
    reservedPostMvp=EXP.reserved(EXPERIMENTALS),
    experimentals=EXPERIMENTALS,
    checks=dict(hitsToKill=htk, crossHitsToKill=cross_htk, shieldBreak=shield_break, rush=rush),
    units=out,
)
for pr in doc['silhouettePairs']['ms9']:
    assert all(E[i]['ms9Core'] for i in pr), pr
OUT.parent.mkdir(parents=True, exist_ok=True)
json.dump(doc, open(OUT, 'w'), ensure_ascii=False, indent=2)
print('total', len(out), 'mobile', mob, 'ms9', n9, 'visuals', len(visuals), 'glyphs', len(glyphs))
for e in out:
    b = e['balance']
    print(f"{e['id']:22s} {'●' if e['ms9Core'] else '○'} {e['msFirst']:5s} d/m {b['devDpsPerMassPct']} h/m {b['devHpPerMassPct']} prod {b['devProductPct']} "
          f"pulk {b['pulk'] and b['pulk']['devPct']} parts {e['kitbash']['partCount']} tris {e['kitbash']['trisEstimate']}")
for h in htk: print('HTK', h['attacker'], '->', h['target'], h['hits'], h['fa']['hits'])
for h in cross_htk: print('XHTK', 'req' if h['required'] else 'info', h['attacker'], '->', h['target'], h['hits'], h['fa']['hits'], '✓' if h['match'] else '✗')
for r_ in rush: print('RUSH', 'req' if r_['required'] else 'info', r_['attacker'], '->', r_['commander'], r_['n'], r_['nOc'], 'FA', r_['fa']['n'], r_['fa']['nOc'], '✓' if r_['match'] else '✗')
for s in shield_break: print('SHIELD', s['attacker'], s['target'], s['shots'], s['timeS'], s['faShots'], s['faTimeS'])
for k, v in visuals.items(): print('VIS', k, v['supersetParts'], v['trisEstimate'])
