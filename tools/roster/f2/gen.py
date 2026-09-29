# Generator für docs/design/factions/f2/roster.json (Flow & Fire, Fraktion f2 „Skarn“).
# Vorlage: tools/roster/gen.py (Varkan). Schema faf-roster/1, gleiche Methodik:
#   DPS/Mass und HP/Mass ±25 % hart, Einzelachsen + Produkt + Pulk ±15 % (erzwungen),
#   Treffer-bis-Tod-Pflichtpaare exakt wie die FA-Referenz der Vorbild-Fraktion,
#   dazu Kreuz-Check gegen Varkan (docs/design/roster.json) nach faction.md §9.2.
# FA-Referenzwerte: fa_ref.json (erzeugt von fa_extract.py aus spooky-db 3810). Nur Relationen, dev-only.
# Aufruf: python3 gen.py   (im Ordner tools/roster/f2/)
import json, math, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.join(ROOT, 'docs', 'design', 'factions', 'f2', 'roster.json')
FA = json.load(open(os.path.join(HERE, 'fa_ref.json')))
FA_CORE = json.load(open(os.path.join(HERE, '..', 'fa_ref.json')))      # Varkan-Referenzen (UEF u. a.)
CORE = json.load(open(os.path.join(ROOT, 'docs', 'design', 'roster.json')))
CORE_BY = {u['id'].split(':')[1]: u for u in CORE['units']}

# Tris LOD0 laut faction.md §3.3; legs = 0, weil der Render-Pfad die Beine erzeugt (Budget ohne Beine)
TRIS = dict(carapace=24, legs=0, lens=8, neck=12, tail=36, pod=20, spike=8, spool=60, needle=16, antenna=16,
            druse=54, webring=24, crust=32, gate=24, wing=12, abdomen=36, buzzdisc=14)
MATS = {'team', 'sinew', 'glow', 'quartz'}


def P(spec):
    """'legs#6' -> Beinzahl; 'lens:sinew*pitch@kopflinse' -> Material, Animation, Rollen-Notiz."""
    out = []
    for s in spec.split():
        anim = mat = note = count = None
        if '@' in s: s, note = s.split('@')
        if '*' in s: s, anim = s.split('*')
        if '#' in s: s, count = s.split('#'); count = int(count)
        if ':' in s: s, mat = s.split(':')
        assert s in TRIS, s
        assert mat is None or mat in MATS, mat
        out.append({k: v for k, v in dict(part=s, mat=mat, anim=anim, count=count, note=note).items() if v is not None})
    return out


def W(ref, typ, dmg, reload, rng, proj, salvo=1, minr=None, splash=0, mv=None, layers=('land',), extra=None):
    dps = dmg * salvo / reload
    w = dict(ref=ref, type=typ, damage=dmg, salvo=salvo, reloadS=reload, dps=round(dps, 2),
             rangeMin=minr, range=rng, projectile=proj, muzzleVelocity=mv, splash=splash, layers=list(layers))
    if extra: w['notes'] = extra
    return {k: v for k, v in w.items() if v is not None}


def PM(*pairs):
    return [dict(feature=f, effect=e) for f, e in pairs]


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

AMPH = ('M13', 'Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation: nur Kommandant und Engineers). Im MVP reine Landeinheit (faction.md §9.5 Nr. 3).')

# ---------------------------------------------------------------- Rädelsführer & Engineers
U(id='f2:cmd_commander', de='Rädelsführer', en='Ringleader', roleDe='Kommandant', roleEn='Commander', tech=0, group='cmd',
  visual='v_cmd', faRef='URL0001', faWpn=1, faRole='Armored Command Unit (ACU)',
  buildableBy=None, mass=2000, energy=5000000, bt=6000000, bp=10, hp=10000, regen=18,
  eco=dict(massPerSec=1, energyPerSec=20, storageMass=650, storageEnergy=3900),
  weapons=[W('f2:wpn_ringleader_lens', 'Granatlinse (Direktfeuer)', 100, 1.0, 22, 'linear', minr=1, mv=35),
           W('f2:wpn_ringleader_flashover', 'Überschlag (Overcharge, manuell/auto)', 15000, 3.3, 22, 'linear', splash=2.5, mv=25,
             extra='Gleiche Formel wie Varkans Abstich (core:wpn_reeve_tapshot): Schaden = clamp(max. HP der mobilen Nicht-Kommandanten '
                   'im Umkreis 2,7 WU [ohne Ziel: 1250], 1250, min(15000, 0,9 × Vorrat / 6)); Drain = 6 × tatsächlicher Schaden; '
                   'feuert erst ab 7500 E Vorrat (braucht Glimmzelle). Gegen Strukturen fix 800, gegen Kommandanten fix 400. '
                   'Nicht in DPS/Mass gewertet.')],
  compareDpsIdx=[0],
  speed=1.7, turn=90, accel=2.0, sizeClass=2, footprint=[2, 2], vision=26,
  toggles=['auto_flashover (MS10, C17)'],
  death=dict(ref='f2:wpn_tangle_snap', inner=dict(damage=2000, radius=30), outer=dict(damage=500, radius=40),
             note='Geflechtriss: Schaden und Radius wie Varkans Lotbruch (FA-Relation 1:1, beide Referenzen gleich), Kamera-Shake X4. Lähmung erst mit K18.'),
  special='Einzigartig, Tod = Niederlage (U1/A4, „Geflecht gerissen. Biss verloren.“). Baut alle T1-Strukturen. Regeneration 18 HP/s '
          '(Varkan 10), dafür 10.000 statt 12.000 HP (Vorbild-Relation). Durchbruch-Spawn nur View (P19).',
  postMvp=PM(('K18', 'Geflechtriss lähmt mobile Einheiten im Radius. Skarn-eigene Ergänzung ohne Vorbild-Wert (Review E4); Dauer und Radius werden mit K18 festgelegt.'),
             ('I5 + U14', 'Tarnung als Enhancement (Radar-Unsichtbarkeit).'), AMPH),
  hotbuild=None, icon='cmd_commander',
  parts=P('legs#6 carapace:team*yaw@torso_kopfkamm druse:glow@herzdruse lens:sinew*pitch@kopflinse needle:quartz@taster_l '
          'needle:quartz@taster_r spool:team@ruecken'),
  kitbash='Großer 6-Beiner (Höhe 2,1 WU, Beinspanne 3,4 WU): Keilpanzer-Torso mit teamfarbenem Kopfkamm, Herzdruse als stärkster Glutpunkt '
          'auf dem Rücken, Granatlinse mittig unter dem Kopf, zwei Quarz-Nadeln als Taster links/rechts (symmetrisch, kein Waffen-/Bauarm-Schema), '
          'Spule im Rücken.')

U(id='f2:lnd_t1_engineer', de='Flicker', en='Patcher', roleDe='Ingenieur', roleEn='Engineer', tech=1, group='cmd',
  visual='v_eng', faRef='URL0105', faRole='T1 Engineer', buildableBy=LAND_T1,
  mass=52, energy=260, bt=260, bp=5, hp=147, speed=1.9, turn=180, accel=3.0, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[], special='Baut T1-Strukturen, Assist, Reclaim, Repair. Baustrahl = Fadenstrom (2–3 Granatfäden, nur View).',
  postMvp=PM(AMPH), hotbuild=('Landnest', 'E'), icon='eng_build_t1',
  parts=P('legs#4 carapace:quartz@deck spool:team@spule needle:quartz*yaw@nadel needle:glow*pitch@emitter'),
  kitbash='Kurzer breiter Keilpanzer mit Quarz-Deck auf 4 Beinen, Spule quer über dem Heck (Randscheiben teamfarben, Achse glüht), '
          'eine Quarz-Nadel diagonal nach vorn rechts mit glühendem Emitter; 1 Tech-Streifen schwarz.')

U(id='f2:lnd_t2_engineer', de='Stopfer', en='Darner', roleDe='Ingenieur', roleEn='Engineer', tech=2, group='cmd',
  visual='v_eng', faRef='URL0208', faRole='T2 Engineer', buildableBy=LAND_T2,
  mass=130, energy=650, bt=650, bp=13, hp=405, speed=1.9, turn=160, accel=2.8, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[], special='Baut T1+T2-Strukturen (u. a. Egel II direkt, Druse II, Falle II, Schlehe II, Kokon II).',
  postMvp=PM(AMPH), hotbuild=('Landnest', 'E'), icon='eng_build_t2',
  parts=P('legs#4 carapace:quartz@deck spool:team@spule needle:quartz*yaw@nadel needle:quartz@kurze_nadel needle:glow*pitch@emitter'),
  kitbash='Wie Flicker, Maßstab 1,3, zwei Quarz-Nadeln verschiedener Länge, 2 Tech-Streifen schwarz.')

U(id='f2:lnd_t3_engineer', de='Weber', en='Weaver', roleDe='Ingenieur', roleEn='Engineer', tech=3, group='cmd',
  visual='v_eng', faRef='URL0309', faRole='T3 Engineer', buildableBy=LAND_T3,
  mass=310, energy=1550, bt=1550, bp=32, hp=770, speed=1.9, turn=140, accel=2.6, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[], special='Baut T1–T3-Strukturen (u. a. Igel, Bilsenkraut, Druse III, Egel III direkt). Kokon III nur per Upgrade.',
  postMvp=PM(AMPH), hotbuild=('Landnest', 'E'), icon='eng_build_t3',
  parts=P('legs#6 carapace:quartz@deck spool:team@spule needle:quartz*yaw@nadel needle:quartz@kurze_nadel needle:quartz@dritte_nadel '
          'needle:glow*pitch@emitter'),
  kitbash='Maßstab 1,4 (Deckel für 1×1), 6 Beine, drei Quarz-Nadeln (Anzahl = Tech, dritte statisch), 3 Tech-Streifen schwarz.')

# ---------------------------------------------------------------- Land T1
U(id='f2:lnd_t1_scout', de='Schabe', en='Roach', roleDe='Späher', roleEn='Scout', tech=1, group='land',
  visual='v_scout', faRef='URL0101', faRole='T1 Land Scout', buildableBy=LAND_T1,
  cats=['LAND', 'MOBILE', 'SCOUT', 'INTELLIGENCE', 'TECH1'],
  mass=8, energy=60, bt=60, hp=16, speed=4.8, turn=180, accel=4.0, sizeClass=1, footprint=[1, 1], vision=24, radar=44,
  eco=dict(upkeepEnergyPerSec=1), weapons=[],
  special='Unbewaffnet (Vorbild-Relation; Varkans Funke hat ein MG). Billiger (8 statt 12 Mass), schneller, größeres Radar (44 statt 40).',
  postMvp=PM(('I5', 'Tarnung (Cloak) wie die Vorbild-Referenz; Bedingungen und Energiekosten legt I5 fest. Im MVP ohne Tarnung, Balance unverändert.')),
  hotbuild=('Landnest', 'A'), icon='land_intel_t1',
  parts=P('legs#2 carapace:team antenna@fuehler_l antenna@fuehler_r'),
  kitbash='Kleinster Panzer auf 2 Beinen, zwei lange Fühler (≥ 1,0 × Rumpflänge) schräg nach vorn oben; keine Linse, kein Ring.')

U(id='f2:lnd_t1_bot', de='Floh', en='Flea', roleDe='Leichter Sturmläufer', roleEn='Light Assault Bot', tech=1, group='land',
  visual='v_bot', faRef='URL0106', faRole='T1 Light Assault Bot', buildableBy=LAND_T1,
  mass=35, energy=140, bt=140, hp=95, speed=4.0, turn=45, accel=4.0, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[W('f2:wpn_pulse_lens_t1_light', 'Pulslinse (3er-Puls)', 7, 1.0, 14, 'linear (Puls)', salvo=3, mv=30)],
  special='Zäher Raider: HP/Mass +24 %, DPS/Mass −18 % gegenüber Varkans Stichel (Vorbild-Relation).',
  hotbuild=('Landnest', 'S'), icon='land_bot_t1',
  parts=P('legs#2 carapace:team neck*yaw lens:sinew*pitch'),
  kitbash='Kurzer Keilpanzer hoch auf 2 langen Beinen (Beine länger als der Panzer), Granatlinse auf kurzem Hals.')

U(id='f2:lnd_t1_tank', de='Zecke', en='Tick', roleDe='Kampfläufer', roleEn='Battle Walker', tech=1, group='land',
  visual='v_tank', faRef='URL0107', faRole='T1 Assault Bot (Linienrolle)', buildableBy=LAND_T1,
  mass=56, energy=280, bt=285, hp=280, speed=3.7, turn=80, accel=2.5, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[W('f2:wpn_pulse_lens_t1', 'Pulslinse', 8, 0.3, 18, 'linear (Puls)', mv=30)],
  special='Glaskanone der Linie: DPS/Mass +14 %, HP/Mass −7 %, Tempo 3,7 statt 3,3 gegenüber der Punze. Viele kleine Treffer '
          '(8 Schaden / 0,3 s). Breakpoints: 3 Kommandanten-Treffer, 6 Falle-I-Treffer, 6 Ohrwurm-Salven (exakt Vorbild).',
  hotbuild=('Landnest', 'Q'), icon='land_direct_t1',
  parts=P('legs#4 carapace:team neck*yaw lens:sinew*pitch carapace@heckplatte'),
  kitbash='Flacher Keilpanzer 1,0 × 0,3 × 1,4 WU auf 4 Hochbeinen (Spanne ≈ 1,6 WU), waagerechte Granatlinse (≈ 54 % der Rumpflänge) '
          'ragt über die Bugspitze; teamfarbene Rückenplatte ≈ 34 % inkl. Beine.')

U(id='f2:lnd_t1_arty', de='Nessel', en='Nettle', roleDe='Mobile Artillerie', roleEn='Mobile Artillery', tech=1, group='land',
  visual='v_arty', faRef='URL0103', faRole='T1 Mobile Light Artillery', buildableBy=LAND_T1,
  mass=36, energy=180, bt=200, hp=140, speed=2.9, turn=90, accel=2.2, sizeClass=1, footprint=[1, 1], vision=18,
  weapons=[W('f2:wpn_emp_capsule_t1', 'Blitzkapsel', 230, 5.8, 30, 'ballistisch', minr=5, splash=2, mv=14,
             extra='Im MVP ohne Lähmung; Einschlag hinterlässt ≈ 3 s ein knisterndes Blitz-Decal (nur View).')],
  special='Harter Einzelschlag (2,3 × Kelle), Splash 2, wenig HP. Nachladezeit 5,8 statt 6,0 s: gleicht die fehlende Lähmung '
          'innerhalb des 15-%-Bands aus (faction.md §9.5 Nr. 1, +3,5 % DPS/Mass). Nicht 5,6 s: Varkans Kelle liegt schon 8 % unter ihrer '
          'Referenz, die Kreuz-Relation Nessel/Kelle stiege sonst auf +16 % (Review R1).',
  postMvp=PM(('K18', 'Treffer lähmen Ziele im Splash kurz (Dauer nach Vorbild-Relation); dann Nachladezeit zurück auf 6,0 s.')),
  hotbuild=('Landnest', 'W'), icon='land_arty_t1',
  parts=P('legs#4 carapace:team neck*yaw@schwanzansatz tail:team*pitch pod:sinew@kapsel'),
  kitbash='Langer schmaler Keilpanzer auf 4 Beinen, dreigliedriger Schwanz über dem Rücken, Sechseck-Kapsel (Ø 0,4 WU) schräg nach vorn '
          '(≈ 50°); keine Linse, nichts Waagerechtes.')

U(id='f2:lnd_t1_aa', de='Klette', en='Bur', roleDe='Mobile Flugabwehr', roleEn='Mobile AA', tech=1, group='land',
  visual='v_aa', faRef='URL0104', faRole='T1 Mobile Anti-Air Gun', buildableBy=LAND_T1,
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'DIRECTFIRE', 'TECH1'],
  mass=55, energy=275, bt=220, hp=270, speed=2.9, turn=90, accel=2.5, sizeClass=1, footprint=[1, 1], vision=20,
  weapons=[W('f2:wpn_bur_darts_aa_t1', 'Lenkpfeile (Luft)', 16, 0.5, 32, 'homing (K11)', mv=20, layers=('air',)),
           W('f2:wpn_bur_darts_ground_t1', 'Pfeilsalve (Boden, schwach)', 9, 0.5, 18, 'linear', mv=20, layers=('land',))],
  special='Starke, zerbrechliche T1-Flugabwehr mit schwacher Bodenwaffe (Vorbild-Relation). Beide Waffen im DPS-Vergleich addiert.',
  hotbuild=('Landnest', 'R'), icon='land_aa_t1',
  parts=P('legs#4 carapace:team neck*yaw@kammsockel spike@dorn spike@dorn spike@dorn'),
  kitbash='Keilpanzer auf 4 Beinen, Dornenkamm aus 3 senkrechten Dornen (≥ 75°) quer zur Laufrichtung.')

# ---------------------------------------------------------------- Land T2
U(id='f2:lnd_t2_tank', de='Ohrwurm', en='Earwig', roleDe='Schwerer Kampfläufer', roleEn='Heavy Battle Walker', tech=2, group='land',
  visual='v_tank', faRef='URL0202', faRole='T2 Heavy Tank', buildableBy=LAND_T2,
  mass=290, energy=1450, bt=1300, hp=1980, speed=2.9, turn=90, accel=2.2, sizeClass=2, footprint=[1, 1], vision=22,
  weapons=[W('f2:wpn_pulse_lens_t2', 'Doppel-Pulslinse', 25, 0.6, 24, 'linear (schnell)', salvo=2, mv=100)],
  special='Linsen am Hals geparentet (1 animierter Part). Teurer und zäher als Varkans Meißel (Vorbild-Relation). HP 1.980 statt 1.900: '
          'dieselbe globale HP-Verschiebung wie der Rest des Rosters, bricht keinen Breakpoint (Review R2).',
  hotbuild=('Landnest', 'Q'), icon='land_direct_t2',
  parts=P('legs#4 carapace:team neck*yaw lens:sinew lens:sinew carapace@zangen_platten'),
  kitbash='Zecke × 1,3 mit zwei parallelen Linsen und Zangen-Platten am Bug (aus V2 „Klaue“), 2 Tech-Streifen, weiterhin 4 Beine.')

U(id='f2:lnd_t2_mml', de='Wolfsmilch', en='Spurge', roleDe='Raketenwerfer', roleEn='Missile Launcher', tech=2, group='land',
  visual='v_mml', faRef='URL0111', faRole='T2 Mobile Missile Launcher', buildableBy=LAND_T2,
  mass=180, energy=1300, bt=800, hp=730, speed=3.0, turn=90, accel=2.2, sizeClass=2, footprint=[1, 1], vision=18,
  weapons=[W('f2:wpn_spurge_missile_t2', 'Saftrakete', 200, 3.3, 60, 'homing (Wenderate, K11)', minr=6, splash=1, mv=3)],
  special='Einzelraketen im schnellen Takt statt Varkans 2er-Salve (Vorbild-Relation). RW 60 wie Varkans Rinne.',
  hotbuild=('Landnest', 'W'), icon='land_mml_t2',
  parts=P('legs#4 carapace:team neck*yaw@schwanzansatz tail:team*pitch pod@koecher'),
  kitbash='Schwanz trägt statt der Kapsel einen breiten Köcher (0,5 × 0,25 × 1,1 WU) bei 50° (≥ 2 × Dorn-Breite); keine Linse.')

U(id='f2:lnd_t2_aa', de='Ginster', en='Gorse', roleDe='Flak', roleEn='Flak', tech=2, group='land',
  visual='v_aa', faRef='URL0205', faRole='T2 Mobile AA Flak Artillery', buildableBy=LAND_T2,
  mass=160, energy=800, bt=800, hp=1050, speed=2.9, turn=90, accel=2.4, sizeClass=2, footprint=[1, 1], vision=20,
  weapons=[W('f2:wpn_gorse_flak_t2', 'Dornenflak', 90, 0.6, 40, 'linear + Näherungszünder (MS12)', splash=4, mv=20, layers=('air',))],
  special='Nur Luftziele, Splash trifft Pulks.', hotbuild=('Landnest', 'R'), icon='land_aa_t2',
  parts=P('legs#4 carapace:team neck*yaw@kammsockel spike spike spike spike'),
  kitbash='Klette × 1,3 mit 4 senkrechten Dornen, 2 Tech-Streifen.')

U(id='f2:lnd_t2_shield', de='Gespinst', en='Gossamer', roleDe='Mobiler Schild', roleEn='Mobile Shield', tech=2, group='land',
  visual='v_shield_mobile', faRef='UEL0307', faRole='T2 Mobile Shield Generator (Vorbild hat keinen – Varkan-Referenz)', buildableBy=LAND_T2,
  mass=198, energy=810, bt=600, hp=140, speed=3.5, turn=120, accel=2.8, sizeClass=1, footprint=[1, 1], vision=20,
  shield=dict(hp=2300, radius=15, regenPerSec=50, regenStartS=3, rechargeS=24, upkeepEnergyPerSec=70),
  weapons=[], toggles=['shield (MS13, C17)'],
  special='Vorbild-Fraktion hat keinen mobilen Schild: Referenz wie Varkans Schürze, bewusst am unteren Bandrand '
          '(−10 % Kosten, ≈ −14 % HP+Schild/Mass, faction.md §9.2). Erfüllt U6; der Silberfisch (I5) kommt später zusätzlich.',
  hotbuild=('Landnest', 'D'), icon='land_shield_t2',
  parts=P('legs#4 carapace:team antenna@stuetze_l antenna@stuetze_r webring:team*yaw@netzring'),
  kitbash='Keilpanzer auf 4 Beinen, Netzring waagerecht (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt auf zwei Fühler-Stützen.')

U(id='f2:lnd_t2_bot', de='Milbe', en='Mite', roleDe='Raketenläufer', roleEn='Rocket Bot', tech=2, group='land',
  visual='v_bot', faRef='DRL0204', faRole='T2 Rocket Bot (FAF)', buildableBy=LAND_T2,
  mass=200, energy=1000, bt=1000, hp=570, speed=3.4, turn=80, accel=3.2, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[W('f2:wpn_mite_rockets_t2', 'Stachelraketen (3er-Salve, Direktfeuer)', 60, 4.0, 36, 'linear (langsam, ungelenkt)', salvo=3, splash=2, mv=25)],
  special='Salvenläufer, der Falle I (RW 26) überreicht. Ungelenkte Direktfeuer-Raketen mit Splash; Abschuss aus der Linse, damit der Winkel-Code direkt bleibt.',
  hotbuild=('Landnest', 'S'), icon='land_bot_t2',
  parts=P('legs#2 carapace:team neck*yaw lens:sinew*pitch carapace@seitenplatten'),
  kitbash='Floh × 1,3 mit Seitenplatten und 2 Tech-Streifen, weiterhin 2 Beine.')

# ---------------------------------------------------------------- Land T3
U(id='f2:lnd_t3_bot', de='Tarantel', en='Tarantula', roleDe='Belagerungsläufer', roleEn='Siege Bot', tech=3, group='land',
  visual='v_bot', faRef='URL0303', faRole='T3 Siege Assault Bot', buildableBy=LAND_T3,
  mass=480, energy=5000, bt=2400, hp=3200, speed=3.8, turn=120, accel=2.6, sizeClass=2, footprint=[2, 2], vision=22,
  weapons=[W('f2:wpn_tarantula_lens_t3', 'Doppellinse, schwer (3er-Puls)', 150, 3.3, 20, 'linear', salvo=3, mv=30),
           W('f2:wpn_tarantula_close_t3', 'Nahlinse', 28, 0.4, 24, 'linear (Puls)', mv=35)],
  special='HP 3200 statt 3000: gleicht den fehlenden Raketen-Ablenker innerhalb des Bands aus (faction.md §9.5 Nr. 1).',
  postMvp=PM(('K16', 'Ablenker fängt taktische Raketen im Nahbereich ab; dann HP zurück auf 3000.'),
             ('K18', 'Death-EMP lähmt Einheiten im Umkreis.')),
  hotbuild=('Landnest', 'S'), icon='land_bot_t3',
  parts=P('legs#6 carapace:team neck*yaw lens:sinew lens:sinew lens:sinew@nahlinse carapace@rueckenpanzer'),
  kitbash='Überlanger Keilpanzer auf 6 Beinen, Doppellinse plus kurze Nahlinse, Rückenpanzer, 3 Tech-Streifen.')

U(id='f2:lnd_t3_arty', de='Stechapfel', en='Thornapple', roleDe='Schwere Artillerie', roleEn='Heavy Artillery', tech=3, group='land',
  visual='v_arty', faRef='URL0304', faRole='T3 Mobile Heavy Artillery', buildableBy=LAND_T3,
  mass=800, energy=8000, bt=4300, hp=880, speed=2.2, turn=75, accel=1.8, sizeClass=2, footprint=[2, 2], vision=26,
  weapons=[W('f2:wpn_thornapple_capsule_t3', 'Brandkapsel, schwer', 450, 6.6, 88, 'ballistisch', minr=25, splash=6, mv=24)],
  special='Kein Deploy (wie Varkan). Kleinerer Einzelschlag, schnellerer Takt und größerer Splash als Varkans Pfanne (Vorbild-Relation).',
  hotbuild=('Landnest', 'W'), icon='land_arty_t3',
  parts=P('legs#6 carapace:team neck*yaw@schwanzansatz tail:team*pitch pod:sinew@kapsel tail@zweiter_schwanz'),
  kitbash='Nessel × 1,7 auf 6 Beinen mit zweitem Schwanz, 3 Tech-Streifen.')

U(id='f2:lnd_t3_sniper', de='Langbein', en='Longlegs', roleDe='Präzisionsläufer', roleEn='Sniper Bot', tech=3, group='land',
  visual='v_sniper', faRef='XAL0305', faRole='T3 Sniper Bot (Vorbild hat keinen – Referenz aus anderer FA-Fraktion, wie Varkan)',
  buildableBy=LAND_T3,
  mass=700, energy=22000, bt=4800, hp=460, speed=2.4, turn=110, accel=2.4, sizeClass=1, footprint=[1, 1], vision=26,
  weapons=[W('f2:wpn_longlegs_lens_t3', 'Langlinse', 1000, 6.6, 60, 'linear (schnell)', mv=90)],
  special='Zerbrechlicher und etwas schneller feuernd als Varkans Reißnadel (Fraktionssignatur, im Band).',
  hotbuild=('Landnest', 'F'), icon='land_sniper_t3',
  parts=P('legs#6 carapace:team neck*yaw lens:sinew*pitch@langlinse'),
  kitbash='Panzer hoch über dem Boden (Knie ≥ 1,5 × Rumpflänge) auf 6 überlangen Beinen, Linse ≥ 1,2 × Rumpflänge; Maßstab 1,4.')

U(id='f2:lnd_t3_aa', de='Hagedorn', en='Hawthorn', roleDe='Schwere Flugabwehr', roleEn='Heavy AA', tech=3, group='land',
  visual='v_aa', faRef='DRLK001', faRole='T3 Mobile Missile Anti-Air (FAF)', buildableBy=LAND_T3,
  cats=['LAND', 'MOBILE', 'ANTIAIR', 'DIRECTFIRE', 'TECH3'],
  mass=600, energy=7000, bt=3000, hp=1980, speed=3.6, turn=120, accel=2.4, sizeClass=2, footprint=[1, 1], vision=26,
  weapons=[W('f2:wpn_hawthorn_aa_t3', 'Lenkdornen', 100, 1.0, 60, 'homing (K11)', splash=1.5, mv=15, layers=('air',)),
           W('f2:wpn_hawthorn_ground_t3', 'Bodendornen (schwach)', 30, 1.8, 25, 'linear', mv=10, layers=('land',))],
  special='Lenkflugkörper-Flugabwehr mit schwacher Bodenwaffe (Vorbild-Relation).',
  hotbuild=('Landnest', 'R'), icon='land_aa_t3',
  parts=P('legs#6 carapace:team neck*yaw@kammsockel spike spike spike spike'),
  kitbash='Ginster × 1,4 (1×1-Deckel) mit 4 dickeren Dornen auf 6 Beinen, 3 Tech-Streifen.')

# ---------------------------------------------------------------- Luft
U(id='f2:air_t1_scout', de='Motte', en='Moth', roleDe='Aufklärer', roleEn='Air Scout', tech=1, group='air',
  visual='v_air_scout', faRef='URA0101', faRole='T1 Air Scout', buildableBy=AIR_T1,
  mass=40, energy=560, bt=200, hp=28, speed=19, turn=100, sizeClass=0, footprint=[1, 1], vision=42, radar=64,
  weapons=[], death=dict(ref='f2:wpn_air_crash_s', damage=10, radius=1, note='Absturzschaden (K12)'),
  special='Unbewaffnet, schneller als Varkans Lerche (19 statt 18), größere Sicht.', hotbuild=('Luftnest', 'A'), icon='air_intel_t1',
  parts=P('carapace:team wing:team antenna@fuehler_l antenna@fuehler_r'),
  kitbash='Kleinster Flieger, ein Flügelpaar, zwei Fühler nach vorn; keine Waffen-Parts.')

U(id='f2:air_t1_fighter', de='Bremse', en='Gadfly', roleDe='Abfangjäger', roleEn='Interceptor', tech=1, group='air',
  visual='v_fighter', faRef='URA0102', faRole='T1 Interceptor', buildableBy=AIR_T1,
  mass=50, energy=2200, bt=500, hp=280, speed=15, turn=120, sizeClass=0, footprint=[1, 1], vision=28,
  weapons=[W('f2:wpn_gadfly_pulse_t1', 'Stachelpuls (2 × 3er)', 8, 1.0, 25, 'linear (Vorhalt)', salvo=6, mv=90, layers=('air',))],
  death=dict(ref='f2:wpn_air_crash_s', damage=25, radius=1, note='Absturzschaden (K12)'),
  special='Nur Luftziele. Zwei Stachelpuls-Werfer à 3 × 8 (Vorbild-Referenz hat zwei identische Waffen; spooky 3810 zählte nur eine, korrigiert im fraktionsübergreifenden Abgleich, factions/README.md §5.4).', hotbuild=('Luftnest', 'Q'), icon='air_aa_t1',
  parts=P('carapace wing:team@vorderes_paar wing:team@hinteres_paar'),
  kitbash='Zwei schmale, stark gepfeilte Flügelpaare (X-Grundriss, lang > breit).')

U(id='f2:air_t1_bomber', de='Brummer', en='Bluebottle', roleDe='Bomber', roleEn='Bomber', tech=1, group='air',
  visual='v_bomber', faRef='URA0103', faRole='T1 Attack Bomber', buildableBy=AIR_T1,
  mass=90, energy=2000, bt=500, hp=200, speed=10, turn=80, sizeClass=0, footprint=[1, 1], vision=32, radar=44,
  weapons=[W('f2:wpn_bluebottle_pods_t1', 'Brutkapseln (6er-Reihe)', 50, 5.0, 40, 'ballistisch (Abwurf)', salvo=6, splash=3, mv=0,
             extra='DPS = Salve/Nachladezeit (pro Anflug).')],
  death=dict(ref='f2:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='Mehr, kleinere Kapseln als Varkans Dohle, zerbrechlicher.', hotbuild=('Luftnest', 'W'), icon='air_bomb_t1',
  parts=P('abdomen:team@hinterleib wing:team@breitfluegel wing@stummel'),
  kitbash='Dicker Hinterleib (≥ 1,4 × Flügeltiefe, ragt hinten über) mit kurzen, breiten, geraden Flügeln (T-Form von oben).')

U(id='f2:air_t2_gunship', de='Hummel', en='Bumblebee', roleDe='Kampfschweber', roleEn='Gunship', tech=2, group='air',
  visual='v_gunship', faRef='URA0203', faRole='T2 Gunship', buildableBy=AIR_T2,
  mass=270, energy=5200, bt=1800, hp=850, speed=12, turn=90, sizeClass=0, footprint=[1, 1], vision=32,
  weapons=[W('f2:wpn_bumblebee_lens_t2', 'Streulinse (3er-Puls)', 20, 1.0, 22, 'linear', salvo=3, splash=3, mv=35)],
  death=dict(ref='f2:wpn_air_crash_m', damage=100, radius=1, note='Absturzschaden (K12)'),
  special='Schwebt im Orbit um das Ziel. Kleiner Splash (Vorbild-Relation). Kein Transport (U13 Post-MVP).',
  hotbuild=('Luftnest', 'E'), icon='air_direct_t2',
  parts=P('buzzdisc:team*yaw carapace:team lens:sinew*yaw@bauchlinse'),
  kitbash='Keine Flügel: Schwirrscheibe (opak, dunkel gestreift) über dem Rumpf, Granatlinse unten.')

U(id='f2:air_t2_fbomber', de='Stechmücke', en='Mosquito', roleDe='Jagdbomber', roleEn='Fighter-Bomber', tech=2, group='air',
  visual='v_fbomber', faRef='DRA0202', faRole='T2 Fighter/Bomber (FAF)', buildableBy=AIR_T2,
  mass=420, energy=8000, bt=2400, hp=1150, speed=15, turn=110, sizeClass=0, footprint=[1, 1], vision=32, radar=64,
  weapons=[W('f2:wpn_mosquito_pulse_t2', 'Stechpuls (Luft)', 40, 1.0, 30, 'linear (Vorhalt)', salvo=2, mv=55, layers=('air',)),
           W('f2:wpn_mosquito_pods_t2', 'Brandkapseln (4er)', 150, 10.0, 40, 'ballistisch (Abwurf)', salvo=4, splash=2, mv=0)],
  death=dict(ref='f2:wpn_air_crash_l', damage=200, radius=1, note='Absturzschaden (K12)'),
  special='Beide Waffen addiert im DPS-Vergleich (wie FA-Referenz). Mehr Luftkampf, weniger Bombe als Varkans Elster.',
  hotbuild=('Luftnest', 'R'), icon='air_fbomb_t2',
  parts=P('carapace@schlanker_rumpf wing:team@pfeilfluegel pod@kapsel_l pod@kapsel_r'),
  kitbash='Gepfeiltes Flügelpaar mit zwei Kapseln an den Flügelspitzen, schlanker Keilrumpf (`carapace`, kein Hinterleib: der bleibt Bomber-Monopol), '
          'Spannweite +30 % ggü. Bremse.')

# ---------------------------------------------------------------- Wirtschaft
REGEN_NOTE = 'Nachwachsen: regeneriert {r} HP/s (health.regenPerSec, Vorbild-Relation; Sim über die generische regen-Spalte, PLAN §3.4 G6).'
U(id='f2:str_t1_mex', de='Egel I', en='Leech I', roleDe='Massebohrung', roleEn='Mass Extractor', tech=1, group='eco',
  visual='v_mex', faRef='URB1103', faRole='T1 Mass Extractor', buildableBy=ENG_T1,
  mass=36, energy=360, bt=60, bp=10, hp=375, regen=2, footprint=[2, 2], vision=None,
  eco=dict(massPerSec=2, upkeepEnergyPerSec=2), weapons=[], upgradesTo='f2:str_t2_mex',
  adjacency='Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzender Wabe (FA-Relation, wie Varkan).',
  special='Nur auf Mass-Spots; produziert während des Upgrades weiter (B4). 11 % weniger HP als Zapfstelle I, dafür 2 HP/s Regeneration.',
  hotbuild=('Bau', 'Q'), icon='struct_mass_t1',
  parts=P('crust webring:team@kranz druse:glow*tilt@herzdruse'),
  kitbash='Netzring um den Spot, zentrale Druse mit Glutkern (Saug-Puls-Animation), niedrig.')

U(id='f2:str_t2_mex', de='Egel II', en='Leech II', roleDe='Massebohrung', roleEn='Mass Extractor', tech=2, group='eco',
  visual='v_mex', faRef='URB1202', faRole='T2 Mass Extractor (Upgrade-Kosten)', buildableBy=ENG_T2 + ' | UPGRADE',
  mass=900, energy=5400, bt=900, bp=15, hp=1880, regen=6, footprint=[2, 2], vision=20,
  eco=dict(massPerSec=6, upkeepEnergyPerSec=9), weapons=[], upgradesTo='f2:str_t3_mex', upgradeFrom='f2:str_t1_mex',
  adjacency='Fabriken −10 % Mass-Verbrauch; +12,5 % je Wabe.',
  special='Kosten = Upgrade-Kosten (FA-Semantik). Auch direkt von Stopfer/Weber baubar.', hotbuild=('Bau', 'Q (Upgrade: Command Card)'),
  icon='struct_mass_t2', parts=P('crust webring:team@kranz druse:glow*tilt@herzdruse carapace@seitenplatten'),
  kitbash='Egel auf 2×2 (Höhe × 1,2) mit Seitenplatten, 2 Tech-Streifen.')

U(id='f2:str_t3_mex', de='Egel III', en='Leech III', roleDe='Massebohrung', roleEn='Mass Extractor', tech=3, group='eco',
  visual='v_mex', faRef='URB1302', faRole='T3 Mass Extractor (Upgrade-Kosten)', buildableBy=ENG_T3 + ' | UPGRADE',
  mass=4500, energy=31000, bt=2900, hp=6500, regen=20, footprint=[2, 2], vision=20,
  eco=dict(massPerSec=18, upkeepEnergyPerSec=54), weapons=[], upgradeFrom='f2:str_t2_mex',
  adjacency='Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Wabe.', special='Upgrade-Kosten.',
  hotbuild=('Bau', 'Q (Upgrade: Command Card)'), icon='struct_mass_t3',
  parts=P('crust webring:team@kranz webring@zweiter_ring druse:glow*tilt@herzdruse carapace@seitenplatten'),
  kitbash='Egel auf 2×2 (Höhe × 1,4), doppelter Netzring, 3 Tech-Streifen; nur eine Druse (unterscheidet sich so von der Fumarole).')

U(id='f2:str_t1_pgen', de='Druse I', en='Geode I', roleDe='Kraftwerk', roleEn='Power Generator', tech=1, group='eco',
  visual='v_pgen', faRef='URB1101', faRole='T1 Power Generator', buildableBy=ENG_T1,
  mass=75, energy=750, bt=125, hp=520, regen=2, footprint=[2, 2], vision=None, eco=dict(energyPerSec=20), weapons=[],
  death=dict(ref='f2:wpn_geode_burst_t1', damage=250, radius=2, note='K14, Kettenreaktion-Golden MS10'),
  adjacency='Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % je angrenzender Glimmzelle (SIZE4).',
  special='Frei platzierbar; kein Upgrade (T2/T3 werden neu gebaut, wie FA).', hotbuild=('Bau', 'W'), icon='struct_energy_t1',
  parts=P('crust:team druse:glow@druse'),
  kitbash='Kristallcluster auf Kruste, 1 Druse (Zahl = Tech, Höhe ≥ 1,5 × Krustenhöhe); kein Ring.')

U(id='f2:str_t2_pgen', de='Druse II', en='Geode II', roleDe='Kraftwerk', roleEn='Power Generator', tech=2, group='eco',
  visual='v_pgen', faRef='URB1201', faRole='T2 Power Generator', buildableBy=ENG_T2,
  mass=1200, energy=12000, bt=2200, hp=2290, regen=6, footprint=[6, 6], vision=20, eco=dict(energyPerSec=500), weapons=[],
  death=dict(ref='f2:wpn_geode_burst_t2', damage=1500, radius=5, note='K14'),
  adjacency='Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % je angrenzender Glimmzelle (SIZE12).', special='—',
  hotbuild=('Bau', 'W'), icon='struct_energy_t2',
  parts=P('crust:team druse:glow druse:glow carapace@seitenplatten'),
  kitbash='Kruste auf 6×6 (Maßstab 3,0, Höhe × 1,2) mit 2 Drusen, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.')

U(id='f2:str_t3_pgen', de='Druse III', en='Geode III', roleDe='Kraftwerk', roleEn='Power Generator', tech=3, group='eco',
  visual='v_pgen', faRef='URB1301', faRole='T3 Power Generator', buildableBy=ENG_T3,
  mass=3200, energy=57000, bt=6800, hp=6250, regen=20, footprint=[8, 8], vision=20, eco=dict(energyPerSec=2500), weapons=[],
  death=dict(ref='f2:wpn_geode_burst_t3', damage=5500, radius=10, note='K14; FA-Relation 1:1'),
  adjacency='Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % je angrenzender Glimmzelle (SIZE16).', special='—',
  hotbuild=('Bau', 'W'), icon='struct_energy_t3',
  parts=P('crust:team druse:glow druse:glow druse:glow carapace@seitenplatten_l carapace@seitenplatten_r'),
  kitbash='Kruste auf 8×8 (Maßstab 4,0, Höhe × 1,4) mit 3 Drusen, 3 Tech-Streifen.')

U(id='f2:str_t1_hydro', de='Fumarole', en='Fumarole', roleDe='Dampfkraftwerk', roleEn='Geothermal Plant', tech=1, group='eco',
  visual='v_hydro', faRef='URB1102', faRole='T1 Hydro Power Plant (Spot-Kraftwerk)', buildableBy=ENG_T1,
  mass=160, energy=800, bt=400, hp=1450, regen=5, footprint=[6, 6], vision=None, eco=dict(energyPerSec=100), weapons=[],
  adjacency='Wie Druse II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzender Glimmzelle (SIZE12).',
  special='Nur auf Hydro-Spots; keine Death-Weapon (wie FA).', hotbuild=('Bau', 'E'), icon='struct_hydro_t1',
  parts=P('crust webring:team@offener_ring druse:glow druse:glow druse:glow'),
  kitbash='Offener Netzring mit drei Drusen darin und Dampfsäule (Partikel, nur View).')

U(id='f2:str_t1_mstore', de='Wabe', en='Honeycomb', roleDe='Massespeicher', roleEn='Mass Storage', tech=1, group='eco',
  visual='v_mstore', faRef='URB1106', faRole='T1 Mass Storage', buildableBy=ENG_T1,
  mass=200, energy=1500, bt=250, hp=625, regen=3, footprint=[2, 2], vision=None, eco=dict(storageMass=500), weapons=[],
  adjacency='+12,5 % Produktion je angrenzendem Egel (FA-Relation, max. 4 Seiten = +50 %).',
  special='Keine Death-Weapon.', hotbuild=('Bau', 'R'), icon='struct_mstore_t1',
  parts=P('crust carapace:team@stapel carapace@stapel'),
  kitbash='Niedriger eckiger Stapel aus Panzerplatten (Mass = eckig), keine Druse, keine Spule.')

U(id='f2:str_t1_estore', de='Glimmzelle', en='Glow Cell', roleDe='Energiespeicher', roleEn='Energy Storage', tech=1, group='eco',
  visual='v_estore', faRef='URB1105', faRole='T1 Energy Storage', buildableBy=ENG_T1,
  mass=250, energy=1200, bt=200, hp=520, footprint=[2, 2], vision=None, eco=dict(storageEnergy=10000), weapons=[],
  death=dict(ref='f2:wpn_glowcell_burst', damage=1000, radius=5, note='K14'),
  adjacency='Bufft angrenzende Energieproduzenten (FA-Relation): Druse I +25 % (SIZE4), Druse II und Fumarole +8,3 % (SIZE12), Druse III +6,25 % (SIZE16).',
  special='Keine Regeneration (Vorbild-Relation).', hotbuild=('Bau', 'T'), icon='struct_estore_t1',
  parts=P('crust crust:team@zelle_1 crust:team@zelle_2'),
  kitbash='Zwei flache Sechseckzellen mit Deckelglimmen (Nervennaht, kein Herzkern); keine Druse, keine Spule.')

# ---------------------------------------------------------------- Fabriken
FAC_ADJ = 'Empfängt Adjacency von Egeln (Mass) und Drusen (Energy).'
U(id='f2:str_t1_fac_land', de='Landnest I', en='Land Nest I', roleDe='Landfabrik', roleEn='Land Factory', tech=1, group='fac',
  visual='v_fac_land', faRef='URB0101', faRole='T1 Land Factory', buildableBy=ENG_T1,
  mass=240, energy=2100, bt=300, bp=20, hp=2860, regen=9, footprint=[8, 8], vision=20, eco=dict(storageMass=80), weapons=[],
  upgradesTo='f2:str_t2_fac_land', adjacency=FAC_ADJ,
  special='Queue/Repeat/Rally (B3). Upgrade-Verb „Ausreifen“. 32 % weniger HP als Landwerk I, dafür 9 HP/s Regeneration.',
  hotbuild=('Bau', 'A'), icon='struct_fac_land_t1',
  parts=P('crust:team gate:team@nestmaul carapace@rampe druse:glow@nestkern'),
  kitbash='Nestmaul (V-Portal, offene Spitze = Ausgang) mit Rampe auf gezackter Kruste; Nestkern glüht.')

U(id='f2:str_t2_fac_land', de='Landnest II', en='Land Nest II', roleDe='Landfabrik', roleEn='Land Factory', tech=2, group='fac',
  visual='v_fac_land', faRef='URB0201', faRole='T2 Land Factory HQ (Upgrade-Kosten)', buildableBy='UPGRADE',
  mass=1400, energy=11000, bt=2300, bp=40, hp=5700, regen=20, footprint=[8, 8], vision=20, eco=dict(storageMass=160), weapons=[],
  upgradesTo='f2:str_t3_fac_land', upgradeFrom='f2:str_t1_fac_land', adjacency=FAC_ADJ,
  special='Nur per Upgrade (kein HQ/Support-System, B9 Post-MVP).', hotbuild=('Bau', 'Upgrade (Command Card)'),
  icon='struct_fac_land_t2',
  parts=P('crust:team gate:team@nestmaul carapace@rampe druse:glow@nestkern spool:team@brutspule'),
  kitbash='Landnest × 1,3 mit Brutspule, 2 Tech-Streifen.')

U(id='f2:str_t3_fac_land', de='Landnest III', en='Land Nest III', roleDe='Landfabrik', roleEn='Land Factory', tech=3, group='fac',
  visual='v_fac_land', faRef='URB0301', faRole='T3 Land Factory HQ (Upgrade-Kosten)', buildableBy='UPGRADE',
  mass=5200, energy=47000, bt=12000, bp=90, hp=11450, regen=40, footprint=[8, 8], vision=20, eco=dict(storageMass=320), weapons=[],
  upgradeFrom='f2:str_t2_fac_land', adjacency=FAC_ADJ, special='Nur per Upgrade.',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_fac_land_t3',
  parts=P('crust:team gate:team@nestmaul carapace@rampe druse:glow@nestkern druse:glow@zweiter_kern spool:team@brutspule carapace@seitenplatten'),
  kitbash='Landnest × 1,7 mit zweitem Nestkern und Seitenplatten, 3 Tech-Streifen.')

U(id='f2:str_t1_fac_air', de='Luftnest I', en='Air Nest I', roleDe='Luftfabrik', roleEn='Air Factory', tech=1, group='fac',
  visual='v_fac_air', faRef='URB0102', faRole='T1 Air Factory', buildableBy=ENG_T1,
  mass=210, energy=2400, bt=300, bp=20, hp=2860, regen=9, footprint=[8, 8], vision=20, eco=dict(storageMass=80), weapons=[],
  upgradesTo='f2:str_t2_fac_air', adjacency=FAC_ADJ, special='Baut keine Engineers (wie FA).',
  hotbuild=('Bau', 'S'), icon='struct_fac_air_t1',
  parts=P('crust:team gate:team@nestmaul webring@landenetz druse:glow@nestkern'),
  kitbash='Nestmaul mit flachem Landenetz (Netzring) statt Rampe.')

U(id='f2:str_t2_fac_air', de='Luftnest II', en='Air Nest II', roleDe='Luftfabrik', roleEn='Air Factory', tech=2, group='fac',
  visual='v_fac_air', faRef='URB0202', faRole='T2 Air Factory HQ (Upgrade-Kosten)', buildableBy='UPGRADE',
  mass=920, energy=17500, bt=2300, bp=40, hp=5700, regen=20, footprint=[8, 8], vision=20, eco=dict(storageMass=160), weapons=[],
  upgradeFrom='f2:str_t1_fac_air', adjacency=FAC_ADJ, special='Nur per Upgrade; kein T3-Luftnest (U12 Post-MVP).',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_fac_air_t2',
  parts=P('crust:team gate:team@nestmaul webring@landenetz druse:glow@nestkern spool:team@brutspule'),
  kitbash='Luftnest × 1,3 mit Brutspule, 2 Tech-Streifen.')

# ---------------------------------------------------------------- Verteidigung
U(id='f2:str_t1_pd', de='Falle I', en='Snare I', roleDe='Punktverteidigung', roleEn='Point Defense', tech=1, group='def',
  visual='v_pd', faRef='URB2101', faRole='T1 Point Defense', buildableBy=ENG_T1,
  mass=250, energy=2000, bt=250, hp=1350, footprint=[1, 1], vision=24,
  weapons=[W('f2:wpn_trap_lens_t1', 'Pulslinse (Stellung)', 50, 0.3, 26, 'linear', mv=35)],
  special='Dieselbe Linse wie die Zecke unter einer schrägen Falltür-Platte.', hotbuild=('Bau', 'Z'), icon='struct_direct_t1',
  parts=P('crust carapace:team*yaw@falltuer lens:sinew*pitch'),
  kitbash='Gezackte Kruste, schräge Falltür-Platte (teamfarben), darunter waagerechte Granatlinse.')

U(id='f2:str_t2_pd', de='Falle II', en='Snare II', roleDe='Punktverteidigung', roleEn='Point Defense', tech=2, group='def',
  visual='v_pd', faRef='URB2301', faRole='T2 Point Defense', buildableBy=ENG_T2,
  mass=480, energy=3300, bt=600, hp=2000, footprint=[2, 2], vision=28,
  weapons=[W('f2:wpn_trap_lens_t2', 'Dreifach-Pulslinse', 10, 0.3, 50, 'linear (schnell)', salvo=3, mv=100)],
  special='Große Reichweite, kein Splash (Vorbild-Relation). Kein Upgrade von Falle I (wie FA).', hotbuild=('Bau', 'Z'),
  icon='struct_direct_t2', parts=P('crust carapace:team*yaw@falltuer lens:sinew lens:sinew lens:sinew'),
  kitbash='Falle × 1,3 mit drei Linsen unter der Falltür, 2 Tech-Streifen.')

U(id='f2:str_t1_aa', de='Schlehe I', en='Sloe I', roleDe='Flugabwehrturm', roleEn='AA Tower', tech=1, group='def',
  visual='v_aa_struct', faRef='URB2104', faRole='T1 Anti-Air Turret', buildableBy=ENG_T1,
  mass=150, energy=1500, bt=190, hp=830, footprint=[1, 1], vision=24,
  weapons=[W('f2:wpn_spine_aa_t1', 'Dornensalve', 14, 0.4, 44, 'linear (Vorhalt)', salvo=2, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Bau', 'X'), icon='struct_aa_t1',
  parts=P('crust:team neck*yaw@kammsockel spike spike'),
  kitbash='Kruste mit Dornenkamm aus 2 senkrechten Dornen.')

U(id='f2:str_t2_aa', de='Schlehe II', en='Sloe II', roleDe='Flakturm', roleEn='Flak Tower', tech=2, group='def',
  visual='v_aa_struct', faRef='URB2204', faRole='T2 Anti-Air Flak Artillery', buildableBy=ENG_T2,
  mass=400, energy=4000, bt=540, hp=2480, footprint=[2, 2], vision=24,
  weapons=[W('f2:wpn_spine_flak_t2', 'Splitterdornen (Flak)', 38, 0.5, 44, 'linear + Näherungszünder (MS12)', salvo=2, splash=5, mv=30, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Bau', 'X'), icon='struct_aa_t2',
  parts=P('crust:team neck*yaw@kammsockel spike spike spike carapace@seitenplatten'),
  kitbash='Schlehe × 1,3 mit 3 Dornen und Seitenplatten, 2 Tech-Streifen.')

U(id='f2:str_t3_sam', de='Igel', en='Hedgehog', roleDe='Raketenabwehr', roleEn='SAM Site', tech=3, group='def',
  visual='v_aa_struct', faRef='URB2304', faRole='T3 Anti-Air SAM Launcher', buildableBy=ENG_T3,
  mass=800, energy=8000, bt=1400, hp=5200, footprint=[2, 2], vision=28,
  weapons=[W('f2:wpn_hedgehog_sam_t3', 'Saftraketen-Flugabwehr', 300, 3.5, 60, 'homing + Näherungszünder', salvo=4, splash=1.5, mv=45, layers=('air',))],
  special='Nur Luftziele.', hotbuild=('Bau', 'X'), icon='struct_sam_t3',
  parts=P('crust:team neck*yaw@kammsockel spike spike spike spike'),
  kitbash='Kruste auf 2×2 mit doppelt so vielen, dickeren Dornen im Halbkreis (4), 3 Tech-Streifen.')

U(id='f2:str_t1_wall', de='Hecke', en='Hedge', roleDe='Mauer', roleEn='Wall', tech=1, group='def',
  visual='v_wall', faRef='URB5101', faRole='Wall Section', buildableBy=ENG_T1,
  mass=3, energy=20, bt=15, hp=540, footprint=[1, 1], vision=0, weapons=[],
  special='wall-Flag (Drag-Linie), blockiert Schüsse und Pathing.', hotbuild=('Bau', 'C'), icon='wall',
  parts=P('crust spike:team@dornenkappen'),
  kitbash='Niedriger Krustenblock mit kurzen Dornen (≤ 0,3 × Blockhöhe, keine AA-Lesart), nur die Spitzen-Kappen teamfarben (≈ 10 %).')

# ---------------------------------------------------------------- Intel & Schilde
U(id='f2:str_t1_radar', de='Fühler I', en='Feeler I', roleDe='Radar', roleEn='Radar', tech=1, group='intel',
  visual='v_radar', faRef='URB3101', faRole='T1 Radar System', buildableBy=ENG_T1,
  mass=80, energy=720, bt=80, bp=13, hp=11, footprint=[2, 2], vision=20, radar=116,
  eco=dict(upkeepEnergyPerSec=20), weapons=[], toggles=['radar (MS10, C17)'], upgradesTo='f2:str_t2_radar',
  special='Stall schaltet ab (E3). Extrem fragil (FA-Relation).', hotbuild=('Bau', 'D'), icon='struct_intel_t1',
  parts=P('crust:team antenna@fuehler_l antenna@fuehler_r'),
  kitbash='Zwei hohe, geknickte Fühler als V (35° gespreizt); kein Ring.')

U(id='f2:str_t2_radar', de='Fühler II', en='Feeler II', roleDe='Radar', roleEn='Radar', tech=2, group='intel',
  visual='v_radar', faRef='URB3201', faRole='T2 Radar System (Upgrade-Kosten)', buildableBy='UPGRADE',
  mass=180, energy=3600, bt=780, bp=20, hp=55, footprint=[2, 2], vision=24, radar=200,
  eco=dict(upkeepEnergyPerSec=150), weapons=[], toggles=['radar (MS10, C17)'],
  upgradesTo='f2:str_t3_radar', upgradeFrom='f2:str_t1_radar', special='Nur per Upgrade.',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_intel_t2',
  parts=P('crust:team antenna@fuehler_l antenna@fuehler_r carapace@seitenplatten'),
  kitbash='Fühler auf 2×2 (Höhe × 1,2) mit Seitenplatten, 2 Tech-Streifen.')

U(id='f2:str_t3_radar', de='Fühler III', en='Feeler III', roleDe='Radar', roleEn='Radar', tech=3, group='intel',
  visual='v_radar', faRef='URB3104', faRole='T3 Omni Sensor Array (Upgrade-Kosten; hier ohne Omni)', buildableBy='UPGRADE',
  mass=1200, energy=15000, bt=1200, hp=55, footprint=[2, 2], vision=30, radar=350,
  eco=dict(upkeepEnergyPerSec=400), weapons=[], toggles=['radar (MS10, C17)'], upgradeFrom='f2:str_t2_radar',
  special='Kein Omni (I4 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation (wie Varkans Horcher III).',
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_intel_t3',
  parts=P('crust:team antenna@fuehler_l antenna@fuehler_r antenna@kurzer_fuehler carapace@seitenplatten'),
  kitbash='Fühler auf 2×2 (Höhe × 1,4) mit drittem, kurzem Fühler, 3 Tech-Streifen.')

U(id='f2:str_t2_shield', de='Kokon II', en='Cocoon II', roleDe='Schildgenerator', roleEn='Shield Generator', tech=2, group='intel',
  visual='v_shield', faRef='URB4202', faRole='T2 Shield Generator (Stufe 1 der Schildkette)', buildableBy=ENG_T2,
  mass=160, energy=2000, bt=700, bp=20, hp=450, footprint=[6, 6], vision=20,
  shield=dict(hp=3500, radius=18, regenPerSec=45, regenStartS=3, rechargeS=20, upkeepEnergyPerSec=100),
  eco=dict(upkeepEnergyPerSec=100), weapons=[], toggles=['shield (MS13, C17)'], upgradesTo='f2:str_t3_shield',
  special='Billig und schwach (160 statt 600 Mass, 3.500 statt 9.000 Schild-HP), am unteren Bandrand der Vorbild-Referenz. '
          'Kollaps + Wiederaufbau nach rechargeS; Stall schaltet ab.',
  hotbuild=('Bau', 'F'), icon='struct_shield_t2',
  parts=P('crust antenna@dreibein antenna@dreibein antenna@dreibein webring:team*yaw@netzring'),
  kitbash='Netzring waagerecht (Ø ≥ 0,8 × Footprint-Kante) auf Fühler-Dreibein; kein V.')

U(id='f2:str_t3_shield', de='Kokon III', en='Cocoon III', roleDe='Schildgenerator', roleEn='Shield Generator', tech=3, group='intel',
  visual='v_shield', faRef='URB4206', faRole='T3 Shield Generator (erste T3-Stufe der Schildkette, Upgrade-Kosten)', buildableBy='UPGRADE',
  mass=2600, energy=42000, bt=3600, hp=500, footprint=[6, 6], vision=20,
  shield=dict(hp=12000, radius=32, regenPerSec=125, regenStartS=1, rechargeS=25, upkeepEnergyPerSec=400),
  eco=dict(upkeepEnergyPerSec=400), weapons=[], toggles=['shield (MS13, C17)'], upgradeFrom='f2:str_t2_shield',
  special='Nur per Upgrade. Die zwei T2-Zwischenstufen der Vorbild-Kette entfallen (ein Sprung II→III); Vergleich gegen die erste T3-Stufe. '
          'Gesamtkosten Kokon II+III = 2.760 Mass für 12.500 HP+Schild (4,53/Mass), Varkans Schirm II+III 3.800 Mass für 17.520 (4,61/Mass).',
  postMvp=PM(('B8', 'Weitere In-Place-Stufen Kokon IV/V wie die Vorbild-Kette.')),
  hotbuild=('Bau', 'Upgrade (Command Card)'), icon='struct_shield_t3',
  parts=P('crust antenna@dreibein antenna@dreibein antenna@dreibein webring:team*yaw@netzring webring@zweiter_ring carapace@seitenplatten'),
  kitbash='Kokon auf 6×6 (Höhe × 1,4/1,2) mit zweitem Netzring und Seitenplatten, 3 Tech-Streifen.')

# ---------------------------------------------------------------- Artillerie-Stellungen
U(id='f2:str_t2_arty', de='Schierling', en='Hemlock', roleDe='Artilleriestellung', roleEn='Artillery Emplacement', tech=2, group='arty',
  visual='v_arty_struct', faRef='URB2303', faRole='T2 Artillery Installation', buildableBy=ENG_T2,
  mass=1680, energy=12000, bt=1600, hp=3280, footprint=[2, 2], vision=28,
  weapons=[W('f2:wpn_hemlock_capsule_t2', 'Brandkapsel (Stellung)', 1750, 20.0, 110, 'ballistisch', minr=50, splash=4, mv=26)],
  special='RW 110 wie Varkans Tiegel (FA 115). Artillerie-Adjacency optional mit E11.', hotbuild=('Bau', 'V'),
  icon='struct_arty_t2', parts=P('crust neck*yaw@schwanzansatz tail:team*pitch pod:sinew@kapsel'),
  kitbash='Großer Schwanz auf Kruste, Kapsel schräg nach vorn (45–55°).')

U(id='f2:str_t3_arty', de='Bilsenkraut', en='Henbane', roleDe='Schwere Artilleriestellung', roleEn='Heavy Artillery Emplacement',
  tech=3, group='arty', visual='v_arty_struct', faRef='URB2302', faRole='T3 Heavy Artillery Installation (auf MVP-Kartengröße skaliert)',
  buildableBy=ENG_T3,
  mass=46000, energy=870000, bt=70000, hp=7280, footprint=[8, 8], vision=28,
  weapons=[W('f2:wpn_henbane_capsule_t3', 'Bilsenkapsel', 3700, 11.4, 200, 'ballistisch', minr=60, splash=9, mv=55)],
  special='FA-Referenz: RW 825, 69.600 Mass, 3.700 Schaden alle 7,6 s, Splash 9. Hier wie Varkans Hochofen skaliert: RW 200 '
          '(Kartenpool ≥ 354 WU), Kosten ≈ 66 %, gleicher Einzelschuss und Splash, Feuerrate × ⅔; DPS/Mass und HP/Mass in Relation. '
          'Kleinerer Einzelschuss, größerer Splash und schnellerer Takt als der Hochofen (Vorbild-Relation).',
  hotbuild=('Bau', 'V'), icon='struct_arty_t3',
  parts=P('crust neck*yaw@lafette tail:team*pitch@schwanz pod:sinew@kapsel tail@zweiter_schwanz carapace@gegengewicht'),
  kitbash='8×8: doppelter Schwanz, Kapsel Ø 3,0 WU, Gegengewicht; 3 Tech-Streifen.')

# ---------------------------------------------------------------- Rollen-Daten aus Varkan (gleiche Feature-IDs)
RENAME = [('Vogt', 'Rädelsführer'), ('Lotbruch', 'Geflechtriss'), ('Abstich', 'Überschlag'), ('Meister', 'Weber'),
          ('Geselle', 'Stopfer'), ('Glutspeicher', 'Glimmzelle')]
for u in R:
    c = CORE_BY[u['id'].split(':')[1]]
    u.setdefault('cats', c['categories'])
    u['ms'] = c['msFirst']; u['ms9'] = c['ms9Core']
    note = c['msNote']
    for a, b in RENAME: note = note.replace(a, b)
    u['msNote'] = note
    u['core'] = c

# ---------------------------------------------------------------- abgeleitete Felder (identisch zu Varkan)
H_TECH = {0: 1.0, 1: 1.0, 2: 1.2, 3: 1.4}
MOB_SCALE = {0: 1.0, 1: 1.0, 2: 1.3, 3: 1.7}
MOB_CAP_1x1 = 1.4
FLOW_CATS = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
BY_ID = {u['id']: u for u in R}


def fa_reload(rof):
    return math.floor(10 / rof + 1e-6) / 10


def fa_weapon(db, bp, idx=None):
    ws = db[bp]['weapons']
    if idx is not None:
        w = ws[idx]
    else:
        ok = [w for w in ws if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
        w = max(ok, key=lambda w: w['dps'])
    rel = fa_reload(w['rof'])
    salvo = max(1, round(w['dps'] * rel / w['dmg']))
    return dict(damage=w['dmg'], salvo=salvo, reloadS=rel, splash=w['splash'] or 0)


def fa_metrics(db, bp):
    r = db[bp]
    hp = r['hp'] + (r['shield'] or 0)
    dps = r['dps']
    if bp.endswith('L0001'):
        dps = 100.0  # nur Hauptwaffe, ohne Overcharge/Enhancements
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
    fa = fa_metrics(FA, u['faRef'])
    fr = FA[u['faRef']]
    fa_dpm = fa['dps'] / fr['mass'] if fa['dps'] else None
    fa_hpm = (fr['hp'] + (fr['shield'] or 0)) / fr['mass']
    assert bool(dps) == bool(fa_dpm), ('bewaffnet vs. FA', u['id'])
    rd = (dps / u['mass']) / fa_dpm if dps else None
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
    # Kreuz-Relation zu Varkan: (f2/Varkan) gegen (Vorbild-FA/Varkan-FA) – steht die Paarung im FA-Verhältnis?
    c = u['core']; cb = c['balance']; cfa = cb['fa']
    rel = dict(coreId=c['id'], coreFaBp=cfa['bp'])
    if dps and cb['dpsPerMass'] and cfa['dpsPerMass']:
        rel['dpsPerMassVsCorePct'] = round(((dps / u['mass']) / cb['dpsPerMass'] - 1) * 100, 1)
        rel['faDpsPerMassVsCorePct'] = round((fa_dpm / cfa['dpsPerMass'] - 1) * 100, 1)
        rel['devPct_dps'] = round(((dps / u['mass']) / cb['dpsPerMass'] / (fa_dpm / cfa['dpsPerMass']) - 1) * 100, 1)
    rel['hpPerMassVsCorePct'] = round(((hp_eff / u['mass']) / cb['hpPerMass'] - 1) * 100, 1)
    rel['faHpPerMassVsCorePct'] = round((fa_hpm / cfa['hpPerMass'] - 1) * 100, 1)
    rel['devPct_hp'] = round(((hp_eff / u['mass']) / cb['hpPerMass'] / (fa_hpm / cfa['hpPerMass']) - 1) * 100, 1)
    parts = u['parts']
    tris = sum(TRIS[p['part']] for p in parts)
    anim = sum(1 for p in parts if p.get('anim'))
    mobile = u['group'] in ('cmd', 'land', 'air')
    legs = next((p.get('count') for p in parts if p['part'] == 'legs'), None)
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
    stripe_mat = 'black' if ('ENGINEER' in u['cats'] and 'COMMAND' not in u['cats']) else 'quartz'
    e = dict(
        id=u['id'], name=dict(de=u['de'], en=u['en']), role=dict(de=u['roleDe'], en=u['roleEn']),
        tech=u['tech'], group=u['group'], visual=u['visual'], ms9Core=u['ms9'], msFirst=u['ms'], msNote=u['msNote'],
        faReference=dict(devOnly=True, role=u['faRole'], bp=u['faRef'], crossCheckBp=cfa['bp'] if cfa['bp'] != u['faRef'] else None),
        categories=u['cats'], buildableBy=u['buildableBy'],
        economy={k: v for k, v in dict(mass=u['mass'], energy=u['energy'], buildTime=u['bt'], buildPower=u.get('bp'),
                                       **(u.get('eco') or {})).items() if v is not None},
        health=dict(max=u['hp'], **({'regenPerSec': u['regen']} if u.get('regen') else {})),
        shield=u.get('shield'), weapons=ws,
        motion=(dict(layer='air' if u['group'] == 'air' else 'land', speed=u['speed'], turnRateDeg=u['turn'],
                     accel=u.get('accel'), sizeClass=u['sizeClass'], footprint=u['footprint'],
                     **({'legs': legs} if legs else {})) if mobile
                else dict(layer='land', speed=0, footprint=u['footprint'], structure=True)),
        intel={k: v for k, v in dict(vision=u.get('vision'), radar=u.get('radar')).items() if v is not None},
        special=dict(toggles=u.get('toggles', []), upgradesTo=u.get('upgradesTo'), upgradeFrom=u.get('upgradeFrom'),
                     adjacency=u.get('adjacency'), deathWeapon=u.get('death'), notes=u['special'],
                     postMvp=u.get('postMvp', [])),
        hotbuild=(dict(menu=u['hotbuild'][0], slot=u['hotbuild'][1]) if u['hotbuild'] else None),
        icon=u['icon'],
        kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris, legs=legs, techStripes=stripes,
                     techStripeMat=stripe_mat if stripes else None, scale=scale, description=u['kitbash']),
        balance=dict(dps=round(dps, 2) if dps else None, dpsPerMass=round(dps / u['mass'], 4) if dps else None,
                     hpPerMass=round(hp_eff / u['mass'], 4),
                     hpBasis='HP+Schild' if (u.get('shield') or fr['shield']) else 'HP',
                     fa=fa, devDpsPerMassPct=dev_d, devHpPerMassPct=dev_h, devProductPct=dev_p,
                     pulk=pulk, withinBand25=inband, withinTarget15=in15, vsCore=rel),
    )
    if u['group'] == 'air':
        e['motion']['accel'] = None
        e['motion']['note'] = 'kinematisches Flugmodell: speed = Reisetempo, turnRateDeg = Entwurfswert (FA: Air.TurnSpeed)'
    out.append(e)
E = {e['id']: e for e in out}

# ---------------------------------------------------------------- Treffer-bis-Tod (exakt Vorbild-FA)
def htk_row(att, wi, fw, t_hp, f_t_hp, fa_att, fa_t, match_rule='exact'):
    w = att['weapons'][wi]
    ours = math.ceil(t_hp / (w['damage'] * w['salvo'])); theirs = math.ceil(f_t_hp / (fw['damage'] * fw['salvo']))
    return dict(weapon=w['ref'], salvoDamage=w['damage'] * w['salvo'], targetHp=t_hp, hits=ours,
                ttkS=round((ours - 1) * w['reloadS'], 1),
                fa=dict(attacker=fa_att, target=fa_t, salvoDamage=fw['damage'] * fw['salvo'], targetHp=f_t_hp, hits=theirs,
                        ttkS=round((theirs - 1) * fw['reloadS'], 1)),
                match=ours == theirs)


HTK_PAIRS = [('f2:cmd_commander', 0, 1, t) for t in
             ('f2:lnd_t1_bot', 'f2:lnd_t1_tank', 'f2:lnd_t1_arty', 'f2:lnd_t1_aa', 'f2:lnd_t1_engineer', 'f2:lnd_t1_scout')] + [
    ('f2:str_t1_pd', 0, None, 'f2:lnd_t1_tank'), ('f2:str_t1_pd', 0, None, 'f2:lnd_t1_bot'),
    ('f2:lnd_t1_arty', 0, None, 'f2:lnd_t1_bot'), ('f2:lnd_t1_arty', 0, None, 'f2:lnd_t1_engineer'),
    ('f2:lnd_t1_arty', 0, None, 'f2:lnd_t1_tank'),
    ('f2:lnd_t2_tank', 0, None, 'f2:lnd_t1_bot'), ('f2:lnd_t2_tank', 0, None, 'f2:lnd_t1_tank'),
    ('f2:lnd_t2_mml', 0, None, 'f2:str_t2_pd'),
    ('f2:str_t2_arty', 0, None, 'f2:str_t2_mex'), ('f2:str_t2_arty', 0, None, 'f2:str_t1_pd'),
    ('f2:str_t2_arty', 0, None, 'f2:str_t2_pgen'),
    ('f2:str_t1_aa', 0, None, 'f2:air_t1_scout'),
    ('f2:str_t3_sam', 0, None, 'f2:air_t2_gunship'), ('f2:str_t3_sam', 0, None, 'f2:air_t2_fbomber'),
    # Skarn-eigene Breakpoints
    ('f2:lnd_t1_tank', 0, None, 'f2:lnd_t1_bot'), ('f2:lnd_t1_bot', 0, None, 'f2:lnd_t1_engineer'),
    ('f2:lnd_t1_aa', 0, None, 'f2:air_t1_scout'),
]
htk = []
for a, wi, fwi, t in HTK_PAIRS:
    fw = fa_weapon(FA, BY_ID[a]['faRef'], fwi)
    r = htk_row(E[a], wi, fw, E[t]['health']['max'], FA[BY_ID[t]['faRef']]['hp'], BY_ID[a]['faRef'], BY_ID[t]['faRef'])
    htk.append(dict(attacker=a, target=t, **r))

# ---------------------------------------------------------------- Kreuz-Check Skarn <-> Varkan (faction.md §9.2)
CORE_E = {u['id']: u for u in CORE['units']}
CORE_FAWPN = {'core:cmd_commander': 0}
F2_FAWPN = {'f2:cmd_commander': 1}
# Ausnahme: Varkans Punze trifft mit 28 statt FA 24 (bewusste Varkan-Abweichung, roster.md §14). Punze→Zecke kann daher
# nicht gleichzeitig mit Kelle→Zecke (3) und Kommandant→Zecke (3) exakt sein; geprüft wird dann die Tötungszeit (±10 %).
CROSS_TTK_EXCEPTIONS = {('core:lnd_t1_tank', 'f2:lnd_t1_tank'):
                        'Varkans Punze 28 statt 24 Schaden (Varkan-Entscheidung). Exakte Salvenzahl bräuchte Zecke-HP > 308 und bräche '
                        'Kommandant→Zecke (3) und Kelle→Zecke (3). Geprüft wird die Tötungszeit.'}
CROSS_MANDATORY = [('f2:lnd_t1_tank', 'core:lnd_t1_tank'), ('core:lnd_t1_tank', 'f2:lnd_t1_tank'),
                   ('f2:lnd_t1_arty', 'core:lnd_t1_tank'), ('core:lnd_t1_arty', 'f2:lnd_t1_tank')]
CROSS_BREAKPOINT_MAX = 10
CROSS_ATT = ['cmd_commander', 'lnd_t1_bot', 'lnd_t1_tank', 'lnd_t1_arty', 'lnd_t2_tank', 'str_t1_pd']
CROSS_TGT = ['lnd_t1_bot', 'lnd_t1_tank', 'lnd_t1_arty', 'lnd_t1_aa', 'lnd_t1_engineer', 'lnd_t2_tank']


def side(uid):
    if uid.startswith('f2:'):
        return E[uid], FA, BY_ID[uid]['faRef'], F2_FAWPN.get(uid)
    c = CORE_E[uid]
    return c, FA_CORE, c['faReference']['bp'], CORE_FAWPN.get(uid)


def cross_row(a, t):
    ae, adb, abp, afw = side(a); te, tdb, tbp, _ = side(t)
    fw = fa_weapon(adb, abp, afw)
    r = htk_row(ae, 0, fw, te['health']['max'], tdb[tbp]['hp'], abp, tbp)
    exc = CROSS_TTK_EXCEPTIONS.get((a, t))
    ttk_dev = None
    if r['fa']['ttkS']:
        ttk_dev = round((r['ttkS'] / r['fa']['ttkS'] - 1) * 100, 1)
    breakpoint = r['fa']['hits'] <= CROSS_BREAKPOINT_MAX
    if (a, t) in CROSS_MANDATORY:
        ok = r['match'] or (exc is not None and ttk_dev is not None and abs(ttk_dev) <= 10)
    else:   # Info-Matrix: kleine Salvenzahlen sind Breakpoints (exakt), große nur über die Tötungszeit (±10 %)
        ok = r['match'] if breakpoint else (ttk_dev is not None and abs(ttk_dev) <= 10)
    cause = None
    if not r['match']:
        # Ursache: Welche Seite weicht von ihrer FA-Referenz ab? (Seite durch ihre FA-Werte ersetzt -> passt es dann?)
        a_is_f2 = a.startswith('f2:')
        salvo_real = r['salvoDamage']; salvo_fa = r['fa']['salvoDamage']
        hp_real = r['targetHp']; hp_fa = r['fa']['targetHp']
        if a_is_f2:   # Varkan ist Ziel
            core_fixed = math.ceil(hp_fa / salvo_real) == r['fa']['hits']
            f2_fixed = math.ceil(hp_real / salvo_fa) == r['fa']['hits']
        else:         # Varkan ist Angreifer
            core_fixed = math.ceil(hp_real / salvo_fa) == r['fa']['hits']
            f2_fixed = math.ceil(hp_fa / salvo_real) == r['fa']['hits']
        cause = 'Varkan' if core_fixed and not f2_fixed else 'Skarn' if f2_fixed and not core_fixed else 'beide'
    return dict(attacker=a, target=t, **r, ttkDevPct=ttk_dev, breakpoint=breakpoint, exception=exc, ok=ok, cause=cause,
                mandatory=(a, t) in CROSS_MANDATORY)


cross = [cross_row(a, t) for a, t in CROSS_MANDATORY]
seen = set(CROSS_MANDATORY)
for ns_a, ns_t in (('f2', 'core'), ('core', 'f2')):
    for a in CROSS_ATT:
        for t in CROSS_TGT:
            pr = (f'{ns_a}:{a}', f'{ns_t}:{t}')
            if pr not in seen:
                seen.add(pr); cross.append(cross_row(*pr))

# ---------------------------------------------------------------- Schildbrechen (Info)
def shots_to_break(w, sh):
    net_regen = sh['regenPerSec'] * max(0.0, w['reloadS'] - sh['regenStartS'])
    dmg = w['damage'] * w['salvo']
    if dmg <= net_regen: return None
    n = 1
    while n * dmg - (n - 1) * net_regen < sh['hp']: n += 1
    return n


shield_break = []
for a, t in (('f2:str_t2_arty', 'f2:str_t2_shield'), ('f2:str_t3_arty', 'f2:str_t2_shield'),
             ('f2:str_t3_arty', 'f2:str_t3_shield'), ('f2:lnd_t3_arty', 'f2:str_t2_shield')):
    w = E[a]['weapons'][0]; sh = E[t]['shield']; n = shots_to_break(w, sh)
    fw = fa_weapon(FA, BY_ID[a]['faRef']); fsh = dict(sh, hp=FA[BY_ID[t]['faRef']]['shield']); fn = shots_to_break(fw, fsh)
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
    v['legs'] = sorted({E[m]['kitbash']['legs'] for m in v['members'] if E[m]['kitbash']['legs']})

# ---------------------------------------------------------------- Checks / Lints (faction.md §3.3, §5.3)
ids = [e['id'] for e in out]
assert len(ids) == len(set(ids))
assert {i.split(':')[1] for i in ids} == set(CORE_BY), 'gleiche Rollen-IDs wie Varkan'
for e in out:
    k = e['kitbash']; b = e['balance']; cats = set(e['categories'])
    assert k['animatedParts'] <= 2, e['id']
    lim = 7 if e['group'] in ('cmd', 'land', 'air') else 9
    assert k['partCount'] <= lim, (e['id'], k['partCount'])
    assert k['trisEstimate'] <= 350, e['id']
    assert b['withinBand25'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'])
    assert b['withinTarget15'], (e['id'], b['devDpsPerMassPct'], b['devHpPerMassPct'], b['devProductPct'])
    if b['pulk']: assert abs(b['pulk']['devPct']) <= 15, (e['id'], b['pulk'])
    for kk in ('upgradesTo', 'upgradeFrom'):
        if e['special'][kk]: assert e['special'][kk] in ids, (e['id'], kk)
    flow = bool(cats & FLOW_CATS)
    for p in k['parts']:
        if p['part'] in ('spool', 'druse') or p.get('mat') == 'glow':
            assert flow, ('Glut-Monopol', e['id'], p)
        if p['part'] == 'spike':
            assert cats & {'ANTIAIR', 'WALL'}, ('Dorn nur AA/Mauer', e['id'])
        if p['part'] == 'tail':
            assert 'ARTILLERY' in cats, ('Schwanz nur Artillerie/MML', e['id'])
        if p['part'] == 'abdomen':
            assert 'BOMBER' in cats and 'ANTIAIR' not in cats, ('Hinterleib nur Bomber', e['id'])
        if p['part'] == 'lens' and p.get('mat') != 'glow':
            assert 'DIRECTFIRE' in cats, ('Linse = Direktfeuer', e['id'])
    assert any(p.get('mat') == 'team' for p in k['parts']), ('Teamfarbe', e['id'])
    if e['group'] in ('cmd', 'land'):
        assert k['legs'] in (2, 4, 6), ('Beinzahl', e['id'])
        if e['tech'] == 3 or 'COMMAND' in cats:
            assert k['legs'] == 6, ('T3/Rädelsführer = 6 Beine', e['id'])
    if e['special']['upgradesTo'] and 'STRUCTURE' in cats:
        assert e['economy'].get('buildPower'), ('buildPower', e['id'])
    if e['shield']: assert 'regenStartS' in e['shield'], e['id']
    for w in e['weapons']:
        assert abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, w['ref']
    # gleiche Rolle = gleiches Icon und gleiche Hotbuild-Taste wie Varkan
    c = CORE_BY[e['id'].split(':')[1]]
    assert e['icon'] == c['icon'], e['id']
    assert (e['hotbuild'] or {}).get('slot') == (c['hotbuild'] or {}).get('slot'), e['id']
    assert abs(b['vsCore']['devPct_hp']) <= 25 and abs(b['vsCore'].get('devPct_dps', 0)) <= 25, ('Kreuz-Relation', e['id'], b['vsCore'])
for h in htk:
    assert h['match'], ('Treffer-bis-Tod', h)
for x in cross:
    if x['mandatory']: assert x['ok'], ('Kreuz-Check', x)
    if x['breakpoint'] and not x['match'] and not x['mandatory']:
        assert x['cause'] == 'Varkan' or x['cause'] == 'beide', ('Skarn bricht Kreuz-Breakpoint', x)
for vid, v in visuals.items():
    assert v['supersetParts'] <= (8 if v['mobile'] else 9), (vid, v['supersetParts'])
    assert v['trisEstimate'] <= 350, (vid, v['trisEstimate'])
assert len(visuals) <= 28

glyphs = sorted({re.sub(r'^(land|air|eng|struct)_', '', re.sub(r'_t\d$', '', e['icon'])) for e in out
                 if e['icon'] not in ('cmd_commander', 'wall')})
assert glyphs == CORE['iconGlyphs'], 'gleiche Icon-Grammatik wie Varkan'

RESERVED = [
    dict(id='f2:lnd_t2_stealth', de='Silberfisch', en='Silverfish', role='mobiler Tarnfeld-Träger', needs=['I5'],
         faRefDevOnly='URL0306', hotbuild=dict(menu='Landnest', slot='G'), icon='land_stealth_t2 (Token stealth, reserviert)'),
    dict(id='f2:str_t2_stealth', de='Nachtschatten', en='Nightshade', role='Tarnfeld-Generator', needs=['I5'],
         faRefDevOnly='URB4203', hotbuild=dict(menu='Bau', slot='G'), icon='struct_stealth_t2 (Token stealth, reserviert)'),
    dict(id='f2:lnd_t2_amph', de='Wasserläufer', en='Pondskater', role='amphibischer Kampfläufer', needs=['M13'],
         faRefDevOnly='URL0203', hotbuild=None, icon='land_direct_t2 (amph: keine eigene Glyphe)'),
    dict(id='f2:nav_t2_destroyer', de='Bisamratte', en='Muskrat', role='Zerstörer, der an Land laufen kann', needs=['U17', 'M13'],
         faRefDevOnly=None, hotbuild=None, icon='Marine-Grundform (reserviert)'),
    dict(id='f2:lnd_t3_armored', de='Schildwanze', en='Shieldbug', role='schwer gepanzerter T3-Läufer',
         needs=['U10-Erweiterung (nur Budget)', 'M13 (nur für die Amphibik der Referenz)'], faRefDevOnly='XRL0305', hotbuild=None, icon='land_direct_t3'),
]

n9 = sum(e['ms9Core'] for e in out)
mob = sum(1 for e in out if e['group'] in ('cmd', 'land', 'air'))
conv = dict(CORE['conventions'])
conv.update(
    commander='Rädelsführer: Mass 2000 nominell (nicht baubar), DPS nur Hauptwaffe; Überschlag nach Varkans Abstich-Formel',
    faReference='dev-only: faReference wird beim Blueprint-Build per Lint entfernt und darf nie in view.json oder i18n landen (faction.md §2.5). '
                'bp = Primärreferenz der Vorbild-Fraktion, crossCheckBp = Varkans Referenz derselben Rolle.',
    techStripes='Breite 0,10 WU × Maßstab, Abstand 0,10 WU, im hinteren Drittel des Panzers; quarzweiß, bei Engineers schwarz (#141418) '
                'auf dem Quarz-Deck; Rädelsführer und Hecke ohne Streifen',
    legs='kitbash.legs / motion.legs = Beinzahl (Instanzparameter des Bein-Renderers, nur View): 2 = leicht/schnell, 4 = Linie, 6 = T3 und '
         'Rädelsführer. legs zählt als 1 Part, Tris-Schätzung ohne Beine (Render-Pfad).',
    regen='health.regenPerSec bei Strukturen = „Nachwachsen“ nach Vorbild-Relation (faction.md §9.3). Offen: ob die Sim das generisch anwendet.',
    postMvp='special.postMvp = [{feature, effect}]: Eigenheit der Vorbild-Fraktion, die eine Post-MVP-Mechanik braucht. Ohne Sim-Wirkung; '
            'die Kern-Balance gilt ohne sie (faction.md §9.4/9.5). Fraktionsweit zusätzlich: Veteranen-Regeneration (U9) und '
            '„Nachwachsen im Feld“ für mobile Einheiten (K10-Mechanik regenStartS).',
    crossFaction='checks.crossFaction: Salven bis Tod Skarn↔Varkan müssen denselben Wert liefern wie die FA-Paarung der beiden '
                 'Referenzfraktionen (Pflichtpaare mandatory=true). balance.vsCore: (f2/Varkan) ÷ (Vorbild-FA/Varkan-FA) − 1 je Achse, Gate ±25 %.',
    balanceGate='Hart: |devDpsPerMassPct| und |devHpPerMassPct| ≤ 25 gegen die Vorbild-Referenz. Ziel (erzwungen): Einzelachsen, Produkt '
                'und Pulk-DPS/Mass der Artillerie je ≤ ±15 %; Treffer-bis-Tod-Matrix exakt wie die Vorbild-FA; Kreuz-Pflichtpaare gegen Varkan.',
    visual=CORE['conventions']['visual'] + ' Beinzahl ist Instanzparameter, kein Part.',
    faSource='FAForever/spooky-db app/data/index.json (Version 3810), DPS-Formel app/js/dps.js; Extraktion tools/roster/f2/fa_extract.py',
)
names = {e['id'].split(':')[1]: e['name']['de'] for e in out}
doc = dict(
    schema='faf-roster/1', faction='f2 (Skarn)', generated='2026-09-29', language='de',
    sourceOfTruth='roster.json ist die einzige Quelle für Zahlen, ●/○-Status und Kitbash-Parts; faction.md (f2) und roster.md verweisen darauf.',
    counts=dict(total=len(out), mobile=mob, structures=len(out) - mob, ms9Core=n9,
                visuals=len(visuals), iconGlyphs=len(glyphs), reservedPostMvp=len(RESERVED)),
    conventions=conv,
    hotbuildGrid={
        'Landnest': {'Q': 'Kampfläufer (Zecke/Ohrwurm)', 'W': 'Artillerie (Nessel/Wolfsmilch/Stechapfel)',
                     'E': 'Engineer (Flicker/Stopfer/Weber)', 'R': 'Flugabwehr (Klette/Ginster/Hagedorn)',
                     'A': 'Späher (Schabe)', 'S': 'Läufer (Floh/Milbe/Tarantel)', 'D': 'Support (Gespinst)',
                     'F': 'Präzision (Langbein)', 'G': 'reserviert: Tarnfeld (Silberfisch, I5)'},
        'Luftnest': {'Q': 'Abfangjäger (Bremse)', 'W': 'Bomber (Brummer)', 'E': 'Gunship (Hummel)',
                     'R': 'Jagdbomber (Stechmücke)', 'A': 'Aufklärer (Motte)'},
        'Bau': {'Q': 'Egel', 'W': 'Druse', 'E': 'Fumarole', 'R': 'Wabe', 'T': 'Glimmzelle',
                'A': 'Landnest', 'S': 'Luftnest', 'D': 'Fühler', 'F': 'Kokon', 'G': 'reserviert: Tarnfeld-Generator (Nachtschatten, I5)',
                'Z': 'Falle', 'X': 'Schlehe/Igel', 'C': 'Hecke', 'V': 'Schierling/Bilsenkraut'},
        'rule': CORE['hotbuildGrid']['rule'] + ' Raster identisch zu Varkan (gleiche Taste = gleiche Rolle in jeder Fraktion).'},
    silhouettePairs=dict(
        ms9=[['f2:lnd_t1_tank', 'f2:lnd_t1_aa'], ['f2:lnd_t1_arty', 'f2:lnd_t1_aa'], ['f2:lnd_t2_mml', 'f2:lnd_t2_aa'],
             ['f2:lnd_t2_tank', 'f2:lnd_t2_mml'], ['f2:lnd_t1_bot', 'f2:lnd_t1_scout'], ['f2:lnd_t1_engineer', 'f2:lnd_t1_scout'],
             ['f2:str_t1_pd', 'f2:str_t1_aa'], ['f2:str_t1_mex', 'f2:str_t1_pgen'], ['f2:str_t1_pgen', 'f2:str_t1_estore'],
             ['f2:str_t1_mstore', 'f2:str_t1_estore'], ['f2:str_t1_aa', 'f2:str_t1_wall']],
        ms14=[['f2:air_t1_bomber', 'f2:air_t1_fighter'], ['f2:air_t1_fighter', 'f2:air_t2_fbomber'], ['f2:air_t1_scout', 'f2:air_t1_bomber'],
              ['f2:str_t1_radar', 'f2:str_t2_shield'], ['f2:lnd_t1_scout', 'f2:lnd_t2_shield'], ['f2:str_t3_arty', 'f2:str_t3_pgen'],
              ['f2:str_t3_mex', 'f2:str_t1_hydro']],
        crossFaction=[['core:lnd_t1_tank', 'f2:lnd_t1_tank'], ['core:lnd_t1_arty', 'f2:lnd_t1_arty'], ['core:lnd_t1_aa', 'f2:lnd_t1_aa'],
                      ['core:lnd_t1_engineer', 'f2:lnd_t1_engineer'], ['core:cmd_commander', 'f2:cmd_commander']],
    ),
    iconGlyphs=glyphs,
    visuals={k: dict(members=v['members'], supersetParts=v['supersetParts'], trisEstimate=v['trisEstimate'], legs=v['legs'], parts=v['counts'])
             for k, v in visuals.items()},
    reservedPostMvp=RESERVED,
    checks=dict(hitsToKill=htk, crossFaction=cross, shieldBreak=shield_break),
    units=out,
)
for pr in doc['silhouettePairs']['ms9']:
    assert all(E[i]['ms9Core'] for i in pr), pr
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(doc, open(OUT, 'w'), ensure_ascii=False, indent=2)
print('total', len(out), 'mobile', mob, 'ms9', n9, 'visuals', len(visuals), 'glyphs', len(glyphs))
for e in out:
    b = e['balance']; v = b['vsCore']
    print(f"{e['id']:22s} {'●' if e['ms9Core'] else '○'} {e['msFirst']:5s} dps/m {b['devDpsPerMassPct']} hp/m {b['devHpPerMassPct']} "
          f"prod {b['devProductPct']} pulk {b['pulk'] and b['pulk']['devPct']} | vsCore dps {v.get('devPct_dps')} hp {v['devPct_hp']}")
for h in htk: print('HTK', h['attacker'], '->', h['target'], h['hits'], h['fa']['hits'], h['ttkS'], h['fa']['ttkS'])
for x in cross:
    print('X', 'M' if x['mandatory'] else ' ', x['attacker'], '->', x['target'], x['hits'], x['fa']['hits'], x['ttkS'], x['fa']['ttkS'], x['ttkDevPct'], 'ok' if x['ok'] else '--', x['cause'] or '')
for s in shield_break: print('SHIELD', s['attacker'], s['target'], s['shots'], s['timeS'], s['faShots'], s['faTimeS'])
for k, v in visuals.items(): print('VIS', k, v['supersetParts'], v['trisEstimate'], v['legs'])
