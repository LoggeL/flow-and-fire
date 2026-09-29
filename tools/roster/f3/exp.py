# Experimentals (T4, Post-MVP) der Fraktion f3 „Orden von Sael“ für docs/design/factions/f3/roster.json → Schlüssel `experimentals`.
# Design: docs/design/factions/f3/experimentals.md. Wird von gen.py importiert (build()), damit ein Neuerzeugen des Rosters
# die T4-Einträge behält. Gates wie die Kern-Einheiten (±25 % hart; Einzelachsen, Produkt und Pulk ±15 %) gegen die
# T4-Referenzen der Vorbild-Fraktion (fa_ref_t4.json, dev-only), dazu Sael-Identität (Schild-Anteil, Reichweite ≥ Vorbild,
# zerbrechliche Strukturen), Setons-Brücke (engste Stelle ≥ 72 WU), T4-Kitbash-Budget und die Monopol-Lints aus faction.md §5.3.
# FA-Referenzen erzeugen:  python3 exp.py --extract <spooky index.json>   (schreibt fa_ref_t4.json, spooky-db 3810)
# Prüfen/Anzeigen:         python3 exp.py
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF_PATH = os.path.join(HERE, 'fa_ref_t4.json')

# Vorbild-T4 (Primärreferenz) und Varkan-Gegenproben (Vorbild der Varkan-Referenzfraktion, nur Info).
T4_REFS = ['UAL0401', 'UAS0401', 'UAA0310', 'XAB2307', 'XAB1401', 'UEL0401', 'UES0401', 'UEB2401']
# Korrekturen an spooky 3810 (gegen FAForever/fa develop geprüft, 2026-09-29); gleiche Werte in validate.py.
FA_T4_OVERRIDES = {
    'XAB2307': dict(dps=425.81, note='develop: Granate teilt sich in 6 Splitter à 220 (AIFFragmentationSensorShell01, Fragments = 6, '
                                     'FragmentRadius 7); spooky zählt nur einen Splitter (70,97). 6 × 220 / 3,1 s = 425,81 DPS.'),
    'UAA0310': dict(speed=8, note='Luft-Tempo aus develop (Air.MaxAirspeed 8; spooky Physics.MaxSpeed 1), wie die MVP-Luft.'),
}
# develop-Stand (nur dokumentiert; Roster bleibt wie alle Kern-Einheiten auf 3810, Nachziehen gemeinsam vor dem Einbau)
FA_T4_DEVELOP = [
    dict(bp='UAA0310', spooky='45.000 M / 1.530.000 E / BT 50.625, Schild-Regen 180/s',
         develop='42.750 M / 1.453.500 E / BT 48.094, Schild-Regen 240/s, Luft-Tempo 8 (Air.MaxAirspeed)',
         verdict='nach 3810 um 5 % verbilligt; Relation DPS/Mass +5 %, HP/Mass +5 % → beim Nachziehen Pelikan-Kosten mitziehen.'),
    dict(bp='UAS0401', spooky='24.000 M / 380.000 E / BT 38.400, Kanone 8.000 / 10 s',
         develop='25.000 M / 400.000 E / BT 40.000, Kanone 10.000 / 11 s (RackSalvoReloadTime 10,9)',
         verdict='nach 3810 stärker (DPS/Mass +9 %); Ammonit beim Nachziehen auf 10.000 / 11 s.'),
    dict(bp='XAB2307', spooky='220 / 3,1 s = 70,97 DPS', develop='6 Splitter × 220 / 3,1 s = 425,81 DPS, 15.000 E pro Schuss',
         verdict='spooky-Fehler (Splitter nicht gezählt) → FA_T4_OVERRIDES.'),
    dict(bp='XAB1401', spooky='kein Ertrag (Skript)', develop='Skript XAB1401: Grundertrag 20 M/s + 1.000 E/s, deckt Mehrbedarf bis 10.000 M/s '
         'bzw. 1.000.000 E/s; Todeswaffe 35.000 im Radius 25', verdict='Ertragsmodell aus develop übernommen (spooky führt es nicht).'),
    dict(bp='UAL0401', spooky='identisch', develop='Greifklauen RW 30 (spooky 41), TractorDamage 240', verdict='ohne Einfluss (Klauen nicht übernommen).'),
]

# T4-Tris je Part (LOD0): runde Parts doppelt so fein wie im MVP-Katalog (faction.md §3.3), weil T4 3–6× größer ist.
TRIS = dict(shell=120, hoverpad=64, legs=30, orb=160, lance=24, horn=64, spine=20, sickle=96, ring=144, arch=72,
            mast=48, fan=32, lantern=128, wing=32)
MATS = {'team', 'gold', 'glow', 'jade'}
FLOW_CATS = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
# T4-Kitbash-Budget: Tris L0/L1/L2 wie @faf/modelkit T4_BUDGET (tech: 4), Part-Einträge ≤ 10 und animierte Parts ≤ 3
# (Schnittmenge der f2/f4-Vorschläge; PartStream-Limit 8 bleibt frei). Beine zählen als Tris je Bein.
BUDGET = dict(trisL0=1500, trisL1=800, trisL2=320, parts=10, animated=3)
BRIDGE_WU = 72          # Setons: engste Stelle der Landbrücke 72–80 WU (packages/formats/scripts/mapgen-setons.ts), Gate 72
BRIDGE_ABREAST = 6      # mindestens 6 Einheiten nebeneinander → Außenmaß ≤ 12 WU
ENG_T4 = 'ENGINEER & TECH3'
GROUND_CATS_EXCL = ('Death', 'Teleport', 'Anti Air', 'Anti Navy', 'Defense', None)


def P(spec):
    """'shell:team*yaw@rueckenschild' ; Multiplikator '#n' (bei legs = Beinzahl)."""
    out = []
    for s in spec.split():
        anim = mat = note = count = None
        if '@' in s: s, note = s.split('@')
        if '#' in s: s, count = s.split('#'); count = int(count)
        if '*' in s: s, anim = s.split('*')
        if ':' in s: s, mat = s.split(':')
        assert s in TRIS, s
        assert mat is None or mat in MATS, mat
        out.append({k: v for k, v in dict(part=s, mat=mat, anim=anim, count=count, note=note).items() if v is not None})
    return out


def W(ref, typ, dmg, reload, rng, proj, salvo=1, minr=None, splash=0, mv=None, layers=('land',), fr=None, extra=None):
    w = dict(ref=ref, type=typ, damage=dmg, salvo=salvo, reloadS=reload, dps=round(dmg * salvo / reload, 2),
             rangeMin=minr, range=rng, projectile=proj, muzzleVelocity=mv, splash=splash, layers=list(layers), firingRandomness=fr)
    if extra: w['notes'] = extra
    return {k: v for k, v in w.items() if v is not None}


def PM(*rows):
    return [dict(feature=f, what=w, fallback=fb) for f, w, fb in rows]


X = []
def T4(**k): X.append(k)


# ---------------------------------------------------------------- 1. Land-Sturm (Vorbild-Rolle: amphibischer Riesen-Sturmläufer)
T4(id='f3:exp_lnd_assault', de='Karkinos', en='Karkinos', roleDe='Riesen-Sturmläufer', roleEn='Colossal Assault Walker',
   group='land', faRef='UAL0401', crossBp='UEL0401', faRole='Experimental Assault Bot (amphibisch, Strahl, Greifklauen)',
   cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'BOT', 'EXPERIMENTAL'],
   mass=27500, energy=343750, bt=51500, hp=76000, shield=dict(hp=26000, kind='personal', regenPerSec=90, regenStartS=3, rebuildS=60,
                                                                  upkeepEnergyPerSec=150),
   regen=10,
   weapons=[W('f3:wpn_karkinos_lance', 'Tiefenlanze (Doppellanze, Einzelstoß)', 1200, 0.5, 42, 'linear', minr=2, splash=0.5, mv=60,
              extra='Vorbild: Dauerstrahl 250 alle 0,1 s. Sael-Präzision: gleicher DPS als großer Einzelstoß (−4 %), RW +5 %; kein Strahl-Feature nötig.'),
            W('f3:wpn_karkinos_claw', 'Scherenlanzen (2 × kurz)', 60, 0.5, 30, 'linear', salvo=2, mv=45,
              extra='Eigene Antwort auf Schwärme statt der Greifklauen des Vorbilds: zwei kurze Lanzen in den Scherenschalen, feuern unabhängig.')],
   speed=2.4, turn=40, accel=0.8, footprint=[4, 4], sizeClass=5, dims=dict(length=5.2, width=6.4, height=5.0, legSpan=8.4),
   gait='walker', hoverHeight=None, vision=50, radar=None,
   death=dict(ref='f3:wpn_karkinos_crack', damage=8000, radius=7, note='Schalenbruch: Rückenschild birst in Perlmutt-Splittern (P14); FA-Relation 1:1.'),
   notes='Einziger Läufer unter den Sael-T4: geht heran (Gangart-Regel §5.1 Nr. 3) und hält mit Personal-Schild. Keine Flugabwehr: '
         'wie das Vorbild verwundbar aus der Luft, Begleitung durch Diadem oder Pelikan nötig. Schild-Anteil 25 % der Balance-HP (Sael-Identität A3/A5).',
   postMvp=PM(('K10', 'Personal-Schild 26.000 (Regen 90/s ab 3 s, Neuaufbau 60 s, 150 E/s), Rumpf 76.000 HP', 'vor K10: health.max = HP + Schild = 102.000'),
              ('M13', 'Amphibisch: schreitet über den Grund von Wasser, feuert nicht unter Wasser (Vorbild amphibisch)', 'Layer land, Wasser unpassierbar'),
              ('U16', 'Erstes Land-Experimental des Ordens: Bau durch Kustos/Prior, großes Wrack (90 % Mass, K5)', 'kein Blueprint vor U16'),
              ('P14', 'Großereignis-Effekt beim Schalenbruch (Klangschalen-Schlag, Splitterregen)', 'Standard-Todeseffekt')),
   needs=['U16', 'K10', 'M13', 'K5', 'P14'],
   icon='land_direct_t4', slot='Q',
   parts=P('legs#10 shell:team@rueckenschild shell:jade@bauchschale shell:team#2@scherenschalen orb:team*yaw@perle '
           'lance*pitch#2@tiefenlanze lance#2@scherenlanzen'),
   legs=10,
   monopoly='Scherenschild: breitester Rückenschild der Armee (6,4 × 5,2 WU, breiter als lang) mit zwei vorgestreckten Scherenschalen, '
            'in jeder eine kurze Lanze; obenauf die Perle mit waagerechter Doppellanze.',
   kitbash='Flach gewölbter, teamfarbener Rückenschild mit Goldrand auf 10 spitzen Beinen (5 Paare, Knie über dem Schildrand); vorn zwei '
           'geschlossene Scherenschalen (teamfarben, Innenseite Perlmutt) auf kurzen Armen, aus jeder ragt eine kurze Lanze; auf dem Schildscheitel '
           'die teamfarbene Perle (Ø 1,5 WU) mit zwei parallelen Lanzen (3,6 WU, ragen 1,2 WU über den Schildrand). Unterseite Tiefjade-Bauchschale. '
           'Ab K10 liegt die Schildhülle als flaches Ellipsoid über dem Rückenschild.')

# ---------------------------------------------------------------- 2. Land-Festung (Vorbild-Rolle: Unterwasser-Schlachtschiff mit Fabrik)
T4(id='f3:exp_lnd_fortress', de='Ammonit', en='Ammonite', roleDe='Schwebende Festung', roleEn='Hover Fortress',
   group='land', faRef='UAS0401', crossBp='UEL0401', faRole='Experimental Battleship (tauchend, Fabrik) → als Schweber auf Land und Wasser',
   cats=['LAND', 'MOBILE', 'HOVER', 'DIRECTFIRE', 'FACTORY', 'EXPERIMENTAL'],
   mass=24000, energy=380000, bt=38400, hp=44000, shield=dict(hp=18000, kind='personal', regenPerSec=60, regenStartS=3, rebuildS=60,
                                                                  upkeepEnergyPerSec=100),
   regen=0, buildPower=225,
   weapons=[W('f3:wpn_ammonite_lance', 'Gezeitenlanze (Einzelstoß, Überlänge)', 8000, 10.0, 158, 'linear (langsam, Flugzeit)', minr=10,
              splash=5, mv=35, fr=0.2, extra='Vorbild: Schiffskanone 8.000 alle 10 s, RW 150. RW +5 % (Sael-Reichweite). 1 Treffer tötet jede T3-Landeinheit.')],
   speed=2.5, turn=35, accel=0.6, footprint=[8, 8], sizeClass=5, dims=dict(length=11.0, width=9.0, height=4.6, legSpan=None),
   gait='hover', hoverHeight=0.6, vision=60, radar=150,
   builds='Landkapitel-Liste T1–T3 (nur Schweber: Glimmer, Kauri, Triton, Dünung, Brecher, Seeigel, Seestern, Muschel, Woge, Konus, Diadem, '
          'Novize bis Kustos), Build Power 225, Ausstoß durch das Kapiteltor am Heck; Queue/Repeat/Rally wie ein Kapitel (B3).',
   death=dict(ref='f3:wpn_ammonite_crack', damage=6000, radius=8, note='Spiralbruch: die Windungen reißen von außen nach innen (P14).'),
   notes='Schwimmendes Kapitel: trägt eine Schweberarmee über Wasser in die Flanke (mit M13) und schichtet vor Ort nach. Ersetzt das Tauchen '
         'des Vorbilds durch Schweben und Personal-Schild. Tiefenwaffen gegen Marine fehlen (U18); an Land gegen die Kanonen-DPS ±0 %.',
   postMvp=PM(('M13', 'Schwebt über Wasser (Layer Hover); einzige Sael-T4 für Wasserkarten', 'Layer land, Wasser unpassierbar'),
              ('K10', 'Personal-Schild 18.000 (Regen 60/s ab 3 s, Neuaufbau 60 s, 100 E/s), Rumpf 44.000 HP', 'vor K10: health.max = 62.000'),
              ('B3-Erweiterung', 'Produktion aus einer mobilen Einheit (Queue läuft auch in Bewegung, Ausstoß am Kapiteltor)', 'keine Produktion'),
              ('U18', 'Tiefenstachel gegen Schiffe und U-Boote (Vorbild 6 × 350 alle 5 s, RW 80), nur mit U17/U18', 'entfällt'),
              ('I3', 'Radar 150 WU', 'nur Sicht 60 WU')),
   needs=['U21', 'M13', 'K10', 'B3-Erweiterung', 'I3', 'P14'],
   icon='land_sniper_t4', slot='E',
   parts=P('hoverpad shell:team#3@windungen shell:jade@bauchschale orb:team*yaw@muendungsperle lance*pitch@gezeitenlanze '
           'ring*yaw@schildring arch:glow@kapiteltor'),
   legs=None,
   monopoly='Liegende Spiralschale: drei ineinanderlaufende, teamfarbene Windungen (Ø 9 → 5 → 2,5 WU) als flache Spirale auf dem größten '
            'Schwebeteller, aus der Mündung eine Perle mit Überlänge-Lanze (≥ 1,2 × Rumpflänge), am Heck das goldene Kapiteltor.',
   kitbash='Dunkler Schwebeteller (Schattensaum 10 %), darauf drei liegende Schalenwindungen, die sich zur Mündung hin öffnen (teamfarbene '
           'Emaille, Goldkanten an den Windungsnähten); in der Mündung die Perle (Ø 1,8 WU) mit der Gezeitenlanze (13,5 WU, ragt 4 WU über den Bug); '
           'über der innersten Windung ein waagerechter Schildring (Personal-Schild, ab K10); am Heck ein niedriges, goldenes Kapiteltor mit Goldkern '
           '(Produktion). Schwebehöhe 0,6 WU.')

# ---------------------------------------------------------------- 3. Luft (Vorbild-Rolle: Schwebeträger mit Senkstrahl und Blasen-Schild)
T4(id='f3:exp_air_carrier', de='Pelikan', en='Pelican', roleDe='Schwebeträger', roleEn='Hover Carrier',
   group='air', faRef='UAA0310', crossBp='UES0401', faRole='Experimental Aircraft Carrier (fliegend, Senkstrahl, Blasen-Schild, Fabrik)',
   cats=['AIR', 'MOBILE', 'DIRECTFIRE', 'ANTIAIR', 'FACTORY', 'SHIELD', 'EXPERIMENTAL'],
   mass=45000, energy=1530000, bt=50625, hp=36000, shield=dict(hp=34000, kind='bubble', radius=22, regenPerSec=180, regenStartS=2,
                                                                  rebuildS=120, upkeepEnergyPerSec=500),
   regen=15, buildPower=180,
   weapons=[W('f3:wpn_pelican_plunge', 'Senkstoß (aus dem Kehlsack, nur unter sich)', 1650, 0.5, 30, 'senkrecht (Hitscan-Puls)', splash=4,
              extra='Vorbild: Dauerstrahl 333 alle 0,1 s nach unten. Sael: großer Einzelstoß alle 0,5 s, gleicher DPS (−1 %); trifft nur '
                    'Ziele im Kegel ±30° unter dem Rumpf (Schweben über dem Ziel).'),
            W('f3:wpn_pelican_skyspine', 'Himmelsstachel (4 × Lenkrakete, Luft)', 300, 1.3, 120, 'Lenkflugkörper', salvo=4, splash=2, mv=100,
              layers=('air',)),
            W('f3:wpn_pelican_burstspine', 'Sprengstachel (2 Werfer × 2, Nahbereich, Luft)', 240, 0.5, 44, 'linear (Flak)', salvo=4, splash=3, mv=20,
              layers=('air',))],
   speed=8, turn=20, accel=0.5, footprint=[16, 16], sizeClass=0, dims=dict(length=14.0, width=20.0, height=4.0, legSpan=None),
   gait='air', hoverHeight=None, vision=70, radar=200,
   builds='Luftkapitel-Liste T1–T2 (Seeschwalbe, Sturmvogel, Tölpel, Albatros, Raubmöwe), Build Power 180; Kehlsack-Hangar für 40 Flieger '
          'T1–T2 (lagert, repariert, startet in Wellen).',
   death=dict(ref='f3:wpn_pelican_crash', damage=7000, radius=15, note='Absturz: Kuppel zerschellt, Kehlsack reißt auf (K12, P14); FA-Relation 1:1.'),
   notes='Langsamster, zähester Flieger des Ordens: schwebt über eine Basis und schlägt senkrecht nach unten, schützt darunter mit dem '
         'Blasen-Schild (+13 % Schild, −15 % Radius gegenüber dem Vorbild, A5). Konter: Jäger in Masse unter dem Schildrand, Hochlilien.',
   postMvp=PM(('U12', 'Flugmodell der schweren Luft (Schweben über dem Ziel, Wendekreis, Bau durch T3-Engineers)', 'kein Blueprint'),
              ('K10', 'Blasen-Schild 34.000, Radius 22, Regen 180/s ab 2 s, Neuaufbau 120 s, 500 E/s', 'vor K10: health.max = 70.000, kein Schutz für andere'),
              ('B3-Erweiterung', 'Produktion aus einer fliegenden Einheit (Luftkapitel-Liste T1–T2)', 'keine Produktion'),
              ('U13', 'Kehlsack-Hangar: lagert bis 40 Flieger T1–T2 und startet sie in Wellen', 'kein Hangar'),
              ('U20', 'Air Staging im Hangar: Reparatur und Treibstoff', 'entfällt'),
              ('K12', 'Absturzschaden 7.000 im Radius 15', 'Standard-Todeseffekt')),
   needs=['U21', 'U12', 'K10', 'B3-Erweiterung', 'U13', 'U20', 'K12', 'I3', 'P14'],
   icon='air_direct_t4', slot='R',
   parts=P('wing:team#2@ovalschwinge shell@rueckenkuppel shell:team@kehlsack ring*yaw@schildring arch:glow@hangartor'),
   legs=None,
   monopoly='Kehlsack-Schwinge: die breiteste Ovalschwinge (20 WU Spannweite) mit hängendem, teamfarbenem Kehlsack (≥ 0,6 × Rumpflänge), '
            'darüber eine Kuppel mit waagerechtem Schildring; keine Lanze, keine Perle.',
   kitbash='Zwei teamfarbene Ovalschwingen-Hälften mit Goldkante (Spannweite 20 WU, Tiefe 9 WU, keine Pfeilung), mittig eine hochgewölbte '
           'Rückenkuppel aus Perlmutt, um sie ein waagerechter Schildring (Ø 7 WU, dreht langsam); darunter hängt der Kehlsack (teamfarben, '
           '9 WU lang, ragt vorn 1 WU über die Schwinge), an seinem Heck das goldene Hangartor mit Goldkern. Beim Senkstoß leuchtet die '
           'Kehlsack-Unterseite 0,5 s vorher jadefarben auf (Lichtnaht, kein Goldkern).')

# ---------------------------------------------------------------- 4. Game-Ender (Vorbild-Rolle: Schnellfeuer-Fernartillerie mit Splittergranaten)
T4(id='f3:exp_str_arty', de='Kreuzsee', en='Cross Sea', roleDe='Fernartillerie', roleEn='Strategic Artillery',
   group='structure', faRef='XAB2307', crossBp='UEB2401', faRole='Rapid-Fire Artillery Installation (Game-Ender)',
   cats=['STRUCTURE', 'DEFENSE', 'INDIRECTFIRE', 'ARTILLERY', 'STRATEGIC', 'EXPERIMENTAL', 'SIZE20'],
   mass=202500, energy=5400000, bt=100000, hp=8100, shield=None, regen=0,
   energyPerShot=15000,
   weapons=[W('f3:wpn_crosssea_horn', 'Kreuzseegranate (6 Splitter)', 220, 3.1, 1500, 'ballistisch (teilt sich über dem Ziel)', salvo=6,
              minr=150, splash=2, mv=150, fr=0.2,
              extra='Vorbild: 6 Splitter à 220 alle 3,1 s, RW 4.000. RW 1.500 = kartenweit bis 1.024 WU (Setons-Diagonale 1.448). '
                    'Splitter fallen auf zwei gekreuzte Bögen (Streukreis 7 WU). 15.000 E pro Schuss (Dauerfeuer ≈ 4.840 E/s, Stall = Feuerpause, E3). '
                    'Streuung 0,20 statt 0,25 (Sael-Präzision).')],
   speed=0, turn=None, accel=None, footprint=[10, 10], sizeClass=None, dims=dict(length=10.0, width=10.0, height=9.0, legSpan=None),
   gait=None, hoverHeight=None, vision=28, radar=None,
   death=dict(ref='f3:wpn_crosssea_crack', damage=4000, radius=10, note='Hornbruch: Energievorrat der Kammer entlädt sich (K14, P14).'),
   notes='Game-Ender des Ordens: kartenweites Schnellfeuer mit Splittern statt eines großen Einschlags; bricht Perlmutt-Schilde durch '
         'Dauerlast statt Burst. Zerbrechlich (−10 % HP/Mass, A6), frisst Energie pro Schuss. Die Hornmündung leuchtet 0,5 s vor jedem Schuss.',
   postMvp=PM(('U21', 'Game-Ender: Bau durch Kustos/Prior, kartenweite Reichweite', 'kein Blueprint'),
              ('K1-Erweiterung', 'Splittergeschoss: teilt sich über dem Ziel in 6 Splitter (je eigener Einschlag, Streukreis 7 WU)',
               'Salve aus 6 Einzelgranaten à 220 mit Streukreis 7 WU (vorhandene K1-Streuung), gleiche Pulk-Rechnung'),
              ('K13', 'Stationäre Artillerie; eigenes T4-Reichweiten-Gate: RW 1.500 ≥ Diagonale jeder Karte bis 1.024 WU, Mindest-RW 150', 'Karten > 1.024 WU (M14): RW-Deckel prüfen'),
              ('E3', 'Energie pro Schuss (15.000) als Stall-Verbraucher: bei Energy-Stall Feuerpause', 'Dauerverbrauch 4.840 E/s'),
              ('K14', 'Todeswaffe 4.000 im Radius 10', 'Standard-Todeseffekt'),
              ('P14', 'Großereignis: Einschlag-Kreuzmuster auf der Minimap, Alert „Fernbeschuss“', 'Standard-Alert')),
   needs=['U21', 'K13', 'K2', 'K4', 'K1-Erweiterung', 'E3', 'I3', 'K14', 'P14'],
   icon='struct_arty_t4', slot='W',
   parts=P('shell:team@kissen shell@gegenschale mast*yaw@lafette horn*pitch#3@hornkranz shell:jade@kammerschale'),
   legs=None,
   monopoly='Hornkranz: drei große Hörner als Trommel um eine gemeinsame schräge Achse (50°), größte Horn-Mündung der Armee (Ø 2,4 WU), '
            'dahinter eine hohe Gegenschale.',
   kitbash='Teamfarbener Kissen-Sockel über den ganzen 10 × 10-Footprint, darauf eine niedrige Lafette (dreht), die den Hornkranz trägt: drei '
           'Hörner (je 6 WU, Mündung Ø 2,4 WU, Goldkante an der Mündung) um eine Achse, die sich zwischen den Schüssen um 120° weiterdreht; '
           'hinten eine hohe Gegenschale (8 WU) und unter der Lafette die Tiefjade-Kammerschale. Keine Perle, keine Lanze, keine Laterne.')

# ---------------------------------------------------------------- 5. Eco (Vorbild-Rolle: Ressourcen-Generator mit Bedarfsdeckung)
T4(id='f3:exp_str_eco', de='Perle', en='Pearl', roleDe='Ressourcenperle', roleEn='Resource Pearl',
   group='structure', faRef='XAB1401', crossBp=None, faRole='Experimental Resource Generator',
   cats=['STRUCTURE', 'ECONOMIC', 'EXPERIMENTAL', 'STRATEGIC', 'SIZE16'],
   mass=250200, energy=7506000, bt=325000, hp=4500, shield=None, regen=0,
   eco=dict(massPerSec=20, energyPerSec=1000, demandCapMassPerSec=10000, demandCapEnergyPerSec=1000000, storageEnergy=100000),
   weapons=[],
   speed=0, turn=None, accel=None, footprint=[8, 8], sizeClass=None, dims=dict(length=8.0, width=8.0, height=6.5, legSpan=None),
   gait=None, hoverHeight=None, vision=14, radar=None,
   death=dict(ref='f3:wpn_pearl_crack', damage=35000, radius=25, note='Perlsprung der Perle: wie das Vorbild (35.000 im Radius 25), K14/P14. '
              'Nie neben die eigene Basis setzen.'),
   notes='„Die Perle gibt, was das Kapitel verlangt, nicht mehr.“ Grundertrag 20 M/s + 1.000 E/s; darüber deckt sie jeden Mehrbedarf des '
         'Kapitels bis 10.000 M/s bzw. 1.000.000 E/s (Vorbild-Relation). Teuerstes Bauwerk des Ordens, zerbrechlich (−10 % HP/Mass, A6).',
   postMvp=PM(('E17', 'Endgame-Eco: Grundertrag plus Bedarfsdeckung (Mehrbedarf pro Tick bis zu den Deckeln)', 'kein Blueprint'),
              ('E4', 'Energiespeicher 100.000', '–'),
              ('K14', 'Todeswaffe 35.000 im Radius 25 (Perlsprung)', 'Standard-Todeseffekt'),
              ('P14', 'Großereignis: Perlsprung mit Klangschalen-Schlag und Druckring', 'Standard-Todeseffekt')),
   needs=['U21', 'E17', 'E4', 'K14', 'P14'],
   icon='struct_mass_t4', slot='T',
   parts=P('shell:team@kissen shell@untere_schale shell*pitch@obere_schale orb:glow@riesenperle ring:gold*spin@goldring'),
   legs=None,
   monopoly='Offene Muschel: größte Perle der Armee (Ø 3,2 WU, Goldkern) in einer aufgeklappten Doppelschale, darüber ein kreisender Goldring.',
   kitbash='Teamfarbener Kissen-Sockel (8 × 8), darauf die untere Muschelschale (Perlmutt innen, Schalenrinde außen), die obere Schale 40° '
           'aufgeklappt (öffnet sich beim Bau schichtweise, nur View); dazwischen schwebt die Riesenperle mit Goldkern (umschlossen, Flow-Ausnahme '
           'faction.md §5.3 Nr. 6), über ihr kreist ein flacher Goldring. Beim Energy-Stall verblasst der Goldkern zu Perlgrau.')


# ---------------------------------------------------------------- Rechnen
def load_refs():
    FA = json.load(open(REF_PATH))
    for bp, o in FA_T4_OVERRIDES.items():
        if bp in FA and 'dps' in o:
            for w in FA[bp]['weapons']:
                if w['cat'] == 'Artillery': w['dps'] = o['dps']
        if bp in FA and 'speed' in o: FA[bp]['speed'] = o['speed']
    return FA


def fa_ground_dps(r):
    return round(sum(w['dps'] for w in r['weapons'] if w['cat'] not in GROUND_CATS_EXCL and (w['dmg'] or 0) > 0 and w['rof']), 2)


def fa_air_dps(r):
    return round(sum(w['dps'] for w in r['weapons'] if w['cat'] == 'Anti Air'), 2)


def fa_reload(rof):
    return math.floor(10 / rof + 1e-6) / 10


def main_fa_weapon(r):
    ok = [w for w in r['weapons'] if w['cat'] not in GROUND_CATS_EXCL and (w['dmg'] or 0) > 0 and w['rof']]
    return max(ok, key=lambda w: w['dps'])


def pulkT(s):
    return math.pi * (s + 0.5) ** 2 / 4


def build(icon_glyphs=None, own_units=None):
    """Liefert (entries, errs)."""
    FA = load_refs()
    out, errs = [], []
    for k in X:
        cats = set(k['cats'])
        ws = k['weapons']
        gdps = round(sum(w['dps'] for w in ws if 'land' in w['layers']), 2)
        adps = round(sum(w['dps'] for w in ws if 'air' in w['layers']), 2)
        parts = k['parts']
        tris = sum(TRIS[p['part']] * p.get('count', 1) for p in parts)
        anim = sum(1 for p in parts if p.get('anim'))
        sh = k.get('shield')
        hpb = k['hp'] + (sh['hp'] if sh else 0)
        e = dict(
            id=k['id'], name=dict(de=k['de'], en=k['en']), role=dict(de=k['roleDe'], en=k['roleEn']),
            tier='T4', tech=4, group=k['group'], visual='v_exp_' + k['en'].lower().replace(' ', ''), postMvp=True, ms9Core=False, msFirst='post-MVP',
            msNote='T4 ist Post-MVP (features.json U16/U21); keine Sim-Wirkung vor den genannten Features.',
            needs=k['needs'],
            faReference=dict(devOnly=True, role=k['faRole'], bp=k['faRef'], crossCheckBp=k['crossBp']),
            categories=k['cats'],
            buildableBy=ENG_T4,
            economy={kk: v for kk, v in dict(mass=k['mass'], energy=k['energy'], buildTime=k['bt'], buildPower=k.get('buildPower'),
                                               energyPerShot=k.get('energyPerShot'), **(k.get('eco') or {})).items() if v is not None},
            health=dict(max=hpb, hull=k['hp'], regenPerSec=k['regen']),
            shield=sh,
            weapons=ws,
            motion={kk: v for kk, v in dict(layer='air' if k['group'] == 'air' else 'land', speed=k['speed'], turnRateDeg=k['turn'],
                                             accel=k['accel'], sizeClass=k['sizeClass'], footprint=k['footprint'], gait=k['gait'],
                                             hoverHeightView=k['hoverHeight'], legs=k['legs'],
                                             structure=True if k['group'] == 'structure' else None,
                                             dimensionsWU=k['dims']).items() if v is not None},
            intel={kk: v for kk, v in dict(vision=k['vision'], radar=k['radar']).items() if v is not None},
            special=dict(toggles=[], builds=k.get('builds'), deathWeapon=k['death'], notes=k['notes'], postMvp=k['postMvp']),
            hotbuild=dict(menu='Bau (T4-Tab)', slot=k['slot']),
            icon=k['icon'],
            iconMarker='eckige Klammer um die Grundform statt Tech-Kerben, Größenfaktor 1,5 (Varkan faction.md §6.4)',
            kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris,
                         trisBudget=dict(L0=BUDGET['trisL0'], L1=BUDGET['trisL1'], L2=BUDGET['trisL2']), legs=k['legs'],
                         techMarker='Klammerbögen: zwei Tiefjade-Winkel am hinteren Schalenrand statt Tech-Streifen (entspricht der Icon-Klammer)',
                         monopoly=k['monopoly'], description=k['kitbash']),
        )
        # ------------------------------------------------ Balance gegen Vorbild-T4
        r = FA[k['faRef']]
        m, fm = k['mass'], r['mass']
        fhp = r['hp'] + (r['shield'] or 0)
        dh = (hpb / m / (fhp / fm) - 1) * 100
        b = dict(dps=gdps, dpsAir=adps or None, hpBasis='HP+Schild' if (sh or r['shield']) else 'HP', hpPerMass=round(hpb / m, 4),
                 fa=dict(bp=k['faRef'], mass=fm, energy=r['energy'], buildTime=r['bt'], hp=r['hp'], shieldHp=r['shield'], regen=r.get('regen'),
                         dpsGround=fa_ground_dps(r), dpsAir=fa_air_dps(r) or None, hpPerMass=round(fhp / fm, 4), speed=r['speed']),
                 devHpPerMassPct=round(dh, 1))
        fg = fa_ground_dps(r)
        if gdps or fg:
            dd = (gdps / m / (fg / fm) - 1) * 100
            dp = ((1 + dd / 100) * (1 + dh / 100) - 1) * 100
            b.update(dpsPerMass=round(gdps / m, 5), devDpsPerMassPct=round(dd, 1), devProductPct=round(dp, 1))
        else:
            dd = dp = None
            b.update(dpsPerMass=None, devDpsPerMassPct=None, devProductPct=None)
        fa_ = fa_air_dps(r)
        if adps or fa_:
            da = (adps / m / (fa_ / fm) - 1) * 100
            b['devAirDpsPerMassPct'] = round(da, 1)
        else:
            da = None
        axes = [v for v in (dd, dh, dp, da) if v is not None]
        b['withinBand25'] = all(abs(v) <= 25 for v in (dd, dh, da) if v is not None)
        b['withinTarget15'] = all(abs(v) <= 15 for v in axes)
        if 'ARTILLERY' in cats:
            fw = main_fa_weapon(r); w = ws[0]
            rel = fa_reload(fw['rof'])
            fsal = 6 if k['faRef'] == 'XAB2307' else max(1, round(fw['dps'] * rel / fw['dmg']))
            pk = (w['damage'] * w['salvo'] * pulkT(w['splash']) / w['reloadS'] / m) / (fw['dmg'] * fsal * pulkT(fw['splash'] or 0) / rel / fm) - 1
            b['pulk'] = dict(devPct=round(pk * 100, 1), faSalvo=fsal, faReloadS=rel, faSplash=fw['splash'])
        if k.get('eco'):
            # Info: Ersatzwert des Grundertrags (Mass, die eigene Brunnen-Ketten und Laternen III für denselben Ertrag kosten)
            # und der gedeckte Mehrbedarf, ab dem sich die Perle in 10 min amortisiert.
            E_ = own_units or {}
            mex = [E_.get(i) for i in ('f3:str_t1_mex', 'f3:str_t2_mex', 'f3:str_t3_mex')]
            pg = E_.get('f3:str_t3_pgen')
            if all(mex) and pg:
                chain = sum(x['economy']['mass'] for x in mex); mps = mex[-1]['economy']['massPerSec']
                m_per_eps = pg['economy']['mass'] / pg['economy']['energyPerSec']
                repl = k['eco']['massPerSec'] / mps * chain + k['eco']['energyPerSec'] * m_per_eps
                b['payback'] = dict(baseReplacementMass=round(repl), baseShareOfCostPct=round(repl / k['mass'] * 100, 1),
                                    breakEvenDemandMassPerSec10min=round(k['mass'] / 600),
                                    note='Grundertrag ersetzt nur wenige Brunnen-Ketten und Laternen; der Wert liegt in der Bedarfsdeckung '
                                         '(Vorbild-Relation). Amortisation in 10 min ab ≈ breakEvenDemandMassPerSec10min gedecktem Mehrbedarf.')
            b['ecoMatchesFa'] = True
        # Sael-Identität: Reichweite ≥ Vorbild (Hauptwaffe), Schild-Anteil bei mobilen T4, zerbrechliche Strukturen (A6)
        idt = {}
        if ws and k['group'] != 'structure':
            fw = main_fa_weapon(r)
            idt['rangeAtLeastFa'] = ws[0]['range'] >= (fw['range'] or 0)
        if k['group'] in ('land', 'air'):
            idt['shieldShare'] = round((sh['hp'] if sh else 0) / hpb, 2)
            idt['shieldShareOk'] = idt['shieldShare'] >= 0.25
        if k['group'] == 'structure':
            idt['frailer'] = hpb / m < fhp / fm
        b['identity'] = idt
        if k['crossBp'] and k['crossBp'] in FA:
            c = FA[k['crossBp']]
            b['crossInfo'] = dict(bp=k['crossBp'], note='Gegenprobe: T4 der Varkan-Vorbild-Fraktion, nur Info (Varkan hat noch keine T4)',
                                  dpsGround=fa_ground_dps(c), mass=c['mass'], hpPerMass=round((c['hp'] + (c['shield'] or 0)) / c['mass'], 4))
        e['balance'] = b
        # ------------------------------------------------ Setons-Brücke
        d = k['dims']
        outer = max(d['width'], d.get('legSpan') or 0, min(k['footprint']))
        e['motion']['bridge'] = dict(minBridgeWU=BRIDGE_WU, outerWidthWU=outer, abreast=int(BRIDGE_WU // outer),
                                     ok=k['group'] != 'land' or BRIDGE_WU // outer >= BRIDGE_ABREAST)
        out.append(e)

        # ------------------------------------------------ Checks
        def chk(c, *msg):
            if not c: errs.append((k['id'],) + msg)
        chk(e['id'].startswith('f3:exp_'), 'ID-Schema')
        chk(b['withinBand25'], 'Band ±25 %', b)
        chk(b['withinTarget15'], 'Ziel ±15 %', b)
        if b.get('pulk'): chk(abs(b['pulk']['devPct']) <= 15, 'Pulk ±15 %', b['pulk'])
        chk(all(v for kk, v in idt.items() if kk != 'shieldShare'), 'Sael-Identität', idt)
        for w in ws:
            chk(abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, '10-Hz-Tick', w['ref'])
            chk(abs(w['damage'] * w['salvo'] / w['reloadS'] - w['dps']) < 0.01, 'DPS-Feld', w['ref'])
            if w['projectile'].startswith('ballistisch'): chk(w.get('firingRandomness') is not None, 'firingRandomness fehlt', w['ref'])
        chk(tris <= BUDGET['trisL0'] and len(parts) <= BUDGET['parts'] and anim <= BUDGET['animated'], 'T4-Budget', tris, len(parts), anim)
        chk(any(p.get('mat') == 'team' for p in parts), 'Teamfarbe')
        pn = [p['part'] for p in parts]
        flow = bool(cats & FLOW_CATS)
        # Monopol-Lints faction.md §5.3 Nr. 6, für T4 übernommen
        chk('spine' not in pn or ('ANTIAIR' in cats and 'AIR' not in cats), 'Stachel-Monopol')
        chk('horn' not in pn or 'ARTILLERY' in cats, 'Horn-Monopol')
        chk('lance' not in pn or 'orb' in pn, 'Lanze ohne Perle')
        chk(sum(p.get('count', 1) for p in parts if p['part'] == 'orb') <= 1, 'mehr als 1 Perle')
        chk('orb' not in pn or 'lance' in pn or flow, 'Perle ohne Lanze nur Flow')
        chk(not any(p['part'] in ('lantern', 'sickle') or p.get('mat') == 'glow' for p in parts) or flow, 'Licht-Monopol')
        chk(('hoverpad' in pn) == (k['gait'] == 'hover'), 'Schwebeteller/Gangart')
        chk(('legs' in pn) == (k['gait'] == 'walker'), 'Beine/Gangart')
        for p in parts:
            if p['part'] == 'lance': chk(p.get('anim') in (None, 'pitch', 'yaw'), 'Lanze waagerecht')
        if k['gait'] == 'walker':
            chk((k['legs'] or 0) >= 8 and d['width'] > d['length'], 'T4-Läufer: ≥ 8 Beine, Rückenschild breiter als lang')
        chk(e['motion']['bridge']['ok'], 'Setons-Brücke', e['motion']['bridge'])
        if k['group'] == 'land': chk(k['sizeClass'] == math.ceil(outer / 2), 'sizeClass = ceil(Außenmaß / 2)', k['sizeClass'], outer)
        import re as _re
        g = _re.match(r'^(land|air|struct)_([a-z_]+)_t4$', e['icon'])
        chk(g, 'Icon-Schema', e['icon'])
        if g and icon_glyphs: chk(g.group(2) in icon_glyphs, 'Icon-Glyphe nicht in der gemeinsamen Liste', g.group(2))
        for pm in k['postMvp']: chk(pm['feature'] and pm['what'] and pm['fallback'], 'postMvp')
    ids = [e['id'] for e in out]
    assert len(ids) == len(set(ids))
    kinds = [e['group'] for e in out]
    if kinds.count('land') < 1 or kinds.count('air') < 1 or not any('STRATEGIC' in e['categories'] for e in out):
        errs.append(('Mix', 'mind. 1 Land, 1 Luft, 1 Game-Ender/Spezial-Struktur'))
    slots = [e['hotbuild']['slot'] for e in out]
    if len(slots) != len(set(slots)): errs.append(('Hotbuild', 'T4-Slots doppelt'))
    return out, errs


def reserved(entries):
    """Kurzeinträge für reservedPostMvp (Namensabgleich in cross.py, das nur units und reservedPostMvp liest)."""
    return [dict(id=e['id'], de=e['name']['de'], en=e['name']['en'], role=e['role']['de'], tier='T4', needs=e['needs'],
                 faRefDevOnly=e['faReference']['bp'], hotbuild=e['hotbuild'], icon=e['icon'], detail='experimentals')
            for e in entries]


def extract(index_path):
    sys.path.insert(0, HERE)
    import fa_extract as FX
    db = json.load(open(index_path))
    units = {u['Id'].upper(): u for u in db['units']}
    out = {'_meta': dict(source='FAForever/spooky-db app/data/index.json', version=db.get('version'), devOnly=True,
                         note='T4-Referenzen (Vorbild + Varkan-Gegenproben). Nur Relationen. FA-Namen nie in Anzeige/i18n. '
                              'Korrekturen und develop-Stand in exp.py (FA_T4_OVERRIDES, FA_T4_DEVELOP).')}
    for b in T4_REFS:
        out[b] = FX.entry(units[b])
        out[b]['regen'] = (units[b].get('Defense') or {}).get('RegenRate')
    json.dump(out, open(REF_PATH, 'w'), indent=1, ensure_ascii=False)
    print('fa_ref_t4.json:', len(out) - 1, 'BPs')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--extract':
        extract(sys.argv[2]); sys.exit(0)
    ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
    D = json.load(open(os.path.join(ROOT, 'docs', 'design', 'factions', 'f3', 'roster.json')))
    ents, errs = build(icon_glyphs=D['iconGlyphs'], own_units={u['id']: u for u in D['units']})
    for e in ents:
        b = e['balance']
        print(f"{e['id']:20s} {e['name']['de']:10s} M{e['economy']['mass']:>7} HP{e['health']['max']:>7} DPS{b['dps']:>8} AA{b['dpsAir']} "
              f"dps/m {b.get('devDpsPerMassPct')} hp/m {b['devHpPerMassPct']} prod {b.get('devProductPct')} aa {b.get('devAirDpsPerMassPct')} "
              f"pulk {(b.get('pulk') or {}).get('devPct')} idt {b['identity']} tris {e['kitbash']['trisEstimate']} parts {e['kitbash']['partCount']} "
              f"anim {e['kitbash']['animatedParts']} bridge {e['motion']['bridge']['abreast']}")
    for x in errs: print('FEHLER', *x)
    sys.exit(1 if errs else 0)
