# Experimentals (T4, Post-MVP) der Fraktion f2 „Skarn“ für docs/design/factions/f2/roster.json → Schlüssel `experimentals`.
# Design: docs/design/factions/f2/experimentals.md. Wird von gen.py importiert (build()), damit ein Neuerzeugen des Rosters
# die T4-Einträge behält. Gates wie die Kern-Einheiten (±25 % hart, Einzelachsen + Produkt + Pulk ±15 %) gegen die
# T4-Referenzen der Vorbild-Fraktion (fa_ref_t4.json, dev-only), dazu das Identitäts-Gate „billiger, schneller, zerbrechlicher“,
# die Setons-Brücke (engste Stelle ≥ 72 WU) und das T4-Kitbash-Budget.
# FA-Referenzen erzeugen:  python3 exp.py --extract <spooky index.json>   (schreibt fa_ref_t4.json)
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REF_PATH = os.path.join(HERE, 'fa_ref_t4.json')

# Vorbild-T4 (Primärreferenz) und Gegenproben anderer FA-Fraktionen (nur Info). Das Vorbild hat kein Eco-Experimental.
T4_REFS = ['URL0402', 'XRL0403', 'URA0401', 'URL0401', 'XAB1401', 'UEL0401', 'UEB2401', 'UAL0401', 'XSL0401']

TRIS = dict(carapace=24, legs=0, lens=8, neck=12, tail=36, pod=20, spike=8, spool=60, needle=16, antenna=16,
            druse=54, webring=24, crust=32, gate=24, wing=12, abdomen=36, buzzdisc=14)
MATS = {'team', 'sinew', 'glow', 'quartz'}
FLOW_CATS = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
# T4-Kitbash-Budget (Vorschlag, faction.md §3.3 erweitert): Tris LOD0 ohne Beine, Part-Einträge, animierte Parts
BUDGET = dict(trisL0=1200, trisL1=700, trisL2=350, parts=12, animated=3)
BRIDGE_WU = 72          # Setons: engste Stelle der Landbrücke ≈ 74 WU (content/maps/src/setons.spec.md), Gate 72
BRIDGE_ABREAST = 6      # mindestens 6 Einheiten nebeneinander → Außenmaß ≤ 12 WU
ICON_GLYPHS = None      # wird aus roster.json (iconGlyphs) gesetzt


def P(spec):
    """'carapace:team*yaw@kopf' ; Multiplikator 'spike#6' (bei legs = Beinzahl)."""
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


def W(ref, typ, dmg, reload, rng, proj, salvo=1, minr=None, splash=0, mv=None, layers=('land',), extra=None):
    w = dict(ref=ref, type=typ, damage=dmg, salvo=salvo, reloadS=reload, dps=round(dmg * salvo / reload, 2),
             rangeMin=minr, range=rng, projectile=proj, muzzleVelocity=mv, splash=splash, layers=list(layers))
    if extra: w['notes'] = extra
    return {k: v for k, v in w.items() if v is not None}


def PM(*pairs):
    return [dict(feature=f, effect=e) for f, e in pairs]


ENG_T4 = 'ENGINEER & TECH3'
X = []
def T4(**k): X.append(k)


# ---------------------------------------------------------------- 1. Land-Angriff (Vorbild-Rolle: schneller Tarn-Strahlläufer)
T4(id='f2:exp_lnd_assault', de='Skolopender', en='Scolopendra', roleDe='Experimenteller Sturmläufer', roleEn='Experimental Assault Walker',
   group='land', faRef='URL0402', crossBp=None, faRole='Experimental Spiderbot (Strahl, Tarnfeld, amphibisch)',
   cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'ANTIAIR', 'EXPERIMENTAL'],
   mass=19500, energy=250000, bt=27000, hp=42000, regen=10,
   weapons=[W('f2:wpn_scolopendra_beam', 'Granatstrahl (Dauerstrahl; MVP-Fallback Pulslinse 390 alle 0,1 s)', 390, 0.1, 30, 'Strahl',
              minr=4, splash=0.5, extra='K1-Erweiterung Beam-Waffentyp. Bis dahin Hitscan-Puls mit identischem DPS (faction.md §9.4).'),
            W('f2:wpn_scolopendra_jaw', 'Kieferlinsen (2 × Puls)', 150, 0.7, 60, 'linear', salvo=2, mv=35),
            W('f2:wpn_scolopendra_spines', 'Dornenkamm Heck (2 × Lenkpfeil, Luft)', 40, 2.0, 60, 'Lenkflugkörper', salvo=4, mv=30,
              layers=('air',))],
   speed=2.7, turn=30, accel=1.2, footprint=[4, 10], dims=dict(length=11.0, width=3.2, height=2.2, legSpan=5.6),
   vision=32, upkeepE=0,
   death=dict(ref='f2:wpn_segment_rupture', damage=4000, radius=6, note='Segmentbruch: Kette reißt Glied für Glied (P14); FA-Relation 1:1.'),
   notes='Schnellstes Land-Experimental der Skarn und das billigste des Rosters. Frisst sich mit dem Strahl durch Linien, hält aber '
         'keinen Stellungskrieg aus. Ohne Tarnfeld (I5) und Torpedo (U18) bleibt die Balance im Band (Torpedo in der FA-Summe 50 DPS = 1,1 %).',
   postMvp=PM(('K1-Erweiterung', 'Granatstrahl als echter Dauerstrahl (Schaden pro Tick, trifft alles auf der Strahllinie bis zum ersten Hindernis).'),
              ('I5', 'Tarnfeld um sich (Radar- und Sicht-Tarnung für sich und Einheiten im Radius 12 WU), Unterhalt 400 E/s wie die Vorbild-Relation.'),
              ('M13', 'Amphibisch: läuft über den Grund von Wasser.'),
              ('U18', 'Giftstachel unter Wasser (Torpedo, 50 Schaden alle 4 s, RW 45).')),
   needs=['U16', 'U21', 'K1-Erweiterung', 'I5', 'M13', 'U18', 'P14'],
   icon='land_direct_t4',
   parts=P('legs#14 carapace:team*yaw@kopfsegment carapace:team#6@rumpfsegmente carapace#6@seitenplatten lens:sinew*pitch@strahllinse '
           'lens:sinew#2@kieferlinsen carapace:sinew#2@giftklauen spike#6@dornenkamm_heck'),
   legs=14,
   monopoly='Segmentkette: sieben flache Keilglieder hintereinander (Länge ≥ 3,4 × Breite), 14 Beine als Doppelreihe; überlange Strahllinse am Kopf.',
   kitbash='Kopfsegment (Keil, teamfarben, dreht als Turm) mit überlanger waagerechter Granatlinse (4,2 WU, ragt 1,5 WU über den Kopf) und zwei '
           'Kieferlinsen an den Giftklauen; dahinter sechs Rumpfglieder mit teamfarbenen Rückenplatten und dunklen Seitenplatten, 14 Beine '
           '(7 Paare, Knie über dem Rücken). Auf den letzten zwei Gliedern ein Dornenkamm aus 6 senkrechten Dornen (AA). Glieder schwingen '
           'phasenversetzt zum Beinzyklus (nur View).')

# ---------------------------------------------------------------- 2. Land-Schwer mit Brutbeutel (Vorbild-Rolle: amphibischer Megaläufer, baut Einheiten)
T4(id='f2:exp_lnd_siege', de='Assel', en='Woodlouse', roleDe='Experimenteller Brutläufer', roleEn='Experimental Brood Walker',
   group='land', faRef='XRL0403', crossBp='UEL0401', faRole='Experimental Megabot (amphibisch, baut Einheiten, Flak, Torpedos)',
   cats=['LAND', 'MOBILE', 'DIRECTFIRE', 'ANTIAIR', 'FACTORY', 'EXPERIMENTAL'],
   mass=36000, energy=420000, bt=58000, hp=104000, regen=1, buildPower=45,
   weapons=[W('f2:wpn_woodlouse_twinlens', 'Zwillingslinsen (2 Türme × 2 Linsen)', 720, 1.2, 60, 'linear', salvo=4, minr=4, splash=2, mv=65),
            W('f2:wpn_woodlouse_flak', 'Flakdornen (Luft)', 18, 0.6, 40, 'linear (Flak)', splash=2, mv=20, layers=('air',))],
   speed=2.2, turn=45, accel=0.8, footprint=[8, 8], dims=dict(length=9.5, width=7.0, height=4.4, legSpan=10.5),
   vision=32, upkeepE=0,
   builds='Landnest-Liste T1–T3 der Skarn (ohne Engineers), Build Power 45, Ausstoß aus dem Brutmaul am Bug; Queue/Repeat/Rally wie ein Nest (B3).',
   death=dict(ref='f2:wpn_brood_burst', damage=8000, radius=9, note='Brutbersten: Platten fliegen auseinander (P14); FA-Relation 1:1.'),
   notes='Zähester Körper des Rosters und mobiles Nest: trägt eine T3-Armee über die Front und brütet vor Ort nach. Ohne Torpedo (U18) '
         'fehlen 11,6 % der FA-Summen-DPS; gegen Landziele liegt die Assel damit +8,3 % über der Vorbild-Relation (im Band, keine Kompensation nötig).',
   postMvp=PM(('M13', 'Amphibisch: läuft über den Grund von Wasser; brütet auch unter Wasser.'),
              ('U18', 'Tiefenstachel (Torpedo, 20 × 4 Schaden alle 1,3 s, RW 64) und Torpedo-Ablenker.'),
              ('B3-Erweiterung', 'Produktion aus einer mobilen Einheit (Queue läuft auch in Bewegung, Ausstoß am Bug).')),
   needs=['U21', 'B3-Erweiterung', 'M13', 'U18', 'P14'],
   icon='land_direct_t4',
   parts=P('legs#14 carapace:team#7@querplatten carapace@bauchschale neck*yaw#2@linsentraeger lens:sinew*pitch#4@zwillingslinsen '
           'gate:glow@brutmaul spool:team@brutspule spike#4@flakdornen'),
   legs=14,
   monopoly='Plattenkuppel: sieben überlappende, teamfarbene Querplatten als flache Kuppel (Breite ≥ 0,7 × Länge), vorn ein glühendes Brutmaul.',
   kitbash='Ovaler, flach gewölbter Rücken aus sieben überlappenden Querplatten (teamfarben, Kanten dunkel glänzend) auf 14 kurzen Hochbeinen; '
           'vorn unter dem Kopfschild das Brutmaul (V-Portal, Herzkern) mit liegender Spule dahinter; links und rechts vorn je ein Linsenträger '
           'mit zwei waagerechten Granatlinsen; auf der dritten Platte vier kurze Flakdornen. Kein Schwanz, keine Fühler.')

# ---------------------------------------------------------------- 3. Luft (Vorbild-Rolle: schweres Tarn-Gunship)
T4(id='f2:exp_air_gunship', de='Tsetse', en='Tsetse', roleDe='Experimenteller Kampfschweber', roleEn='Experimental Gunship',
   group='air', faRef='URA0401', crossBp=None, faRole='Experimental Gunship (Radar-Tarnung, Luftabwehr)',
   cats=['AIR', 'MOBILE', 'DIRECTFIRE', 'ANTIAIR', 'EXPERIMENTAL'],
   mass=27500, energy=780000, bt=46000, hp=70000, regen=70,
   weapons=[W('f2:wpn_tsetse_bellylens', 'Bauchlinsen (4 × Puls)', 300, 0.7, 30, 'linear', salvo=4, splash=3, mv=30),
            W('f2:wpn_tsetse_quiver', 'Stachelköcher (2 × 3 Raketen)', 200, 2.0, 30, 'Lenkflugkörper', salvo=6, mv=35),
            W('f2:wpn_tsetse_spines', 'Dornenkamm (4 × Lenkpfeil, Luft)', 140, 2.5, 60, 'Lenkflugkörper', salvo=4, mv=30, layers=('air',))],
   speed=10, turn=None, accel=None, footprint=[6, 6], dims=dict(length=10.0, width=11.0, height=2.4, legSpan=None),
   vision=46, upkeepE=0,
   death=dict(ref='f2:wpn_tsetse_crash', damage=5000, radius=8, note='Absturz (K12); FA-Relation 1:1.'),
   notes='Schneller als die Vorbild-Referenz (10 statt 9 WU/s) und etwas zerbrechlicher; Regeneration nach Vorbild-Relation (70 HP/s). '
         'Ohne Radar-Tarnung (I5) und Absturzschaden (K12) bleibt die Balance im Band.',
   postMvp=PM(('I5', 'Radar-Tarnung (unsichtbar für Radar, Unterhalt 600 E/s wie die Vorbild-Relation).'),
              ('K12', 'Absturzschaden 5000 im Radius 8 beim Abschuss.'),
              ('U12', 'Flugmodell und Luftfabrik-Pfad der schweren T3/T4-Luft (Bau durch T3-Engineers, Landung, Wendekreis).')),
   needs=['U21', 'U12', 'I5', 'K12', 'P14'],
   icon='air_direct_t4',
   parts=P('carapace:team#3@rumpfglieder neck:team#4@ausleger buzzdisc*spin#4@schwirrscheiben lens:sinew*pitch#4@bauchlinsen '
           'pod:sinew#2@stachelkoecher spike#4@dornenkamm carapace:sinew@kopfschild'),
   legs=None,
   monopoly='Vierfach-Schwirrscheibe: vier opake Schwirrscheiben an X-Auslegern um einen langen Gliederrumpf, keine Flügel.',
   kitbash='Langer Gliederrumpf aus drei Keilgliedern (teamfarbene Rückenplatten), am Kopf ein dunkler Kopfschild; vier teamfarbene Ausleger im X, '
           'an jedem eine Schwirrscheibe (opak, gestreift, dreht); unter dem Rumpf vier Bauchlinsen in zwei Paaren, seitlich zwei Stachelköcher; '
           'auf dem mittleren Glied ein Dornenkamm aus vier senkrechten Dornen.')

# ---------------------------------------------------------------- 4. Game-Ender (Vorbild-Rolle: mobile Schnellfeuer-Superartillerie)
T4(id='f2:exp_lnd_arty', de='Bärenklau', en='Hogweed', roleDe='Experimentelle Schnellfeuer-Artillerie', roleEn='Experimental Rapid-Fire Artillery',
   group='land', faRef='URL0401', crossBp='UEB2401', faRole='Experimental Mobile Rapid-Fire Artillery (Game-Ender)',
   cats=['LAND', 'MOBILE', 'ARTILLERY', 'INDIRECTFIRE', 'EXPERIMENTAL', 'STRATEGIC'],
   mass=210000, energy=3800000, bt=230000, hp=8500, regen=0,
   weapons=[W('f2:wpn_hogweed_umbel', 'Doldensalve (20 Kapseln nacheinander, 0,25 s Abstand)', 1500, 20.0, 4000, 'ballistisch', salvo=20,
              minr=150, splash=12, mv=160, extra='Feuert nur verwurzelt (Wurzeln 10 s, Lösen 5 s). Reichweite kartenweit auf allen MVP-Karten.')],
   speed=1.6, turn=80, accel=0.6, footprint=[6, 8], dims=dict(length=8.5, width=5.5, height=10.5, legSpan=9.0),
   vision=26, upkeepE=0,
   death=dict(ref='f2:wpn_umbel_collapse', damage=3000, radius=8, note='Doldenkollaps: ungezündete Kapseln platzen (Death-Weapon-Pfad wie U1, Effekt P14).'),
   notes='Game-Ender der Skarn: kartenweite Salven, aber mit 8500 HP für 210.000 Mass das zerbrechlichste Experimental (Vorbild-Relation). '
         'Skarn-eigene Gegenspiel-Regel: feuert nur verwurzelt; Wurzeln und Lösen dauern, die Salve ist am Doldenglühen 3 s vorher sichtbar. '
         'Reichweite 4000 WU wie die Vorbild-Relation: auf Setons (1024 WU) und allen MVP-Karten kartenweit, erst auf großen Karten (M14) eine Grenze.',
   postMvp=PM(('C17', 'Toggle Wurzeln/Lösen (10 s / 5 s); verwurzelt immobil, Beine als Anker gespreizt.'),
              ('M13', 'Amphibisch: läuft über den Grund von Wasser (Vorbild-Relation), feuert nicht unter Wasser.')),
   needs=['U21', 'K2', 'K4', 'C17', 'M13', 'I3', 'P14'],
   icon='land_arty_t4',
   parts=P('legs#8 carapace:team@rumpf carapace*deploy#2@ankersporne neck*yaw@schwanzansatz tail:team*pitch#2@doppelschwanz '
           'pod:sinew#12@dolde'),
   legs=8,
   monopoly='Dolde: ein doppelt gegliederter Riesenschwanz trägt eine schirmförmige Dolde aus 12 Kapseln (Ø 4 WU) schräg nach vorn (50°).',
   kitbash='Breiter Keilrumpf auf 8 gespreizten Beinen, hinten zwei Ankersporne (klappen beim Wurzeln in den Boden); aus dem Rücken wächst ein '
           'doppelt gegliederter Riesenschwanz (teamfarben) bis 10,5 WU Höhe, an der Spitze die Dolde: 12 Kapseln radial auf einem flachen '
           'Schirm, Spitze schräg nach vorn. Keine Linse, nichts Waagerechtes.')

# ---------------------------------------------------------------- 5. Eco (Vorbild hat keins; Fremdreferenz nur als Obergrenze)
T4(id='f2:exp_str_eco', de='Myzel', en='Mycelium', roleDe='Experimenteller Geflechtknoten', roleEn='Experimental Tangle Node',
   group='structure', faRef=None, crossBp=None, infoBp='XAB1401', faRole='(keine Vorbild-Rolle; Fremdreferenz Experimental Resource Generator nur als Obergrenze)',
   cats=['STRUCTURE', 'ECONOMIC', 'EXPERIMENTAL', 'SIZE100'],
   mass=36000, energy=900000, bt=90000, hp=5000, regen=25,
   eco=dict(massPerSec=60, energyPerSec=3000),
   weapons=[],
   speed=0, turn=None, accel=None, footprint=[10, 10], dims=dict(length=10.0, width=10.0, height=6.0, legSpan=None),
   vision=20, upkeepE=0,
   death=dict(ref='f2:wpn_spore_burst', damage=3000, radius=20, note='Sporenbruch (K14): kleiner als die Fremdreferenz, trotzdem nicht neben die eigene Basis setzen.'),
   notes='Spot-freie Endgame-Wirtschaft ohne Unterhalt: 60 M/s und 3000 E/s. Amortisation ≈ 1,8 × Egel-Kette (Gate 1,5–3,0 ×): '
         'lohnt, wenn die Spots vergeben sind, verdrängt aber nie das Egel-Netz. Zerbrechlich (5000 HP), wächst mit 25 HP/s nach.',
   postMvp=PM(('E17', 'Endgame-Eco: fester Ertrag 60 M/s + 3000 E/s ohne Spot und ohne Unterhalt.'),
              ('K14', 'Sporenbruch 3000 Schaden im Radius 20.'),
              ('G6-Aura', 'Wurzelnetz: eigene Strukturen im Radius 30 WU regenerieren doppelt (Modifier über die generische regen-Spalte, '
                          'keine eigene Feature-ID; Vorschlag unter E17).')),
   needs=['U21', 'E17', 'K14'],
   icon='struct_mass_t4',
   parts=P('crust:team@kruste webring:glow#3@ringgeflecht druse:glow#5@drusen carapace:sinew#6@wurzelplatten'),
   legs=None,
   monopoly='Ringgeflecht: drei konzentrische, glühende Netzringe flach über einer 10 × 10-Kruste, fünf Drusen im Ring; niedrig und breit.',
   kitbash='Achteckige Kruste mit gezackter, teamfarbener Oberkante über den ganzen 10 × 10-Footprint; darauf drei konzentrische Netzringe '
           '(Herzkern, pulsieren im Herzschlag), in der Mitte eine hohe Druse, vier kleinere im inneren Ring; sechs dunkle Wurzelplatten laufen '
           'sternförmig über den Rand hinaus (nur Optik, im Footprint).')


# ---------------------------------------------------------------- Rechnen
def load_refs():
    return json.load(open(REF_PATH))


def fa_reload(rof):
    return math.floor(10 / rof + 1e-6) / 10


def main_fa_weapon(r):
    ok = [w for w in r['weapons'] if w['cat'] not in ('Death', 'Teleport', None) and (w['dmg'] or 0) > 0 and w['rof']]
    return max(ok, key=lambda w: w['dps'])


def build(core_units=None, icon_glyphs=None, own_units=None):
    """Liefert (entries, checks). core_units/own_units: dict id → Eintrag (für Amortisation)."""
    FA = load_refs()
    E = own_units or {}
    out, errs = [], []
    for k in X:
        cats = set(k['cats'])
        ws = k['weapons']
        dps = sum(w['dps'] for w in ws)
        parts = k['parts']
        tris = sum(TRIS[p['part']] * (p.get('count', 1) if p['part'] != 'legs' else 1) for p in parts)
        anim = sum(1 for p in parts if p.get('anim'))
        e = dict(
            id=k['id'], name=dict(de=k['de'], en=k['en']), role=dict(de=k['roleDe'], en=k['roleEn']),
            tier='T4', tech=4, group=k['group'], postMvp=True, ms9Core=False, msFirst='post-MVP',
            msNote='T4 ist Post-MVP (features.json U16/U21); keine Sim-Wirkung vor den genannten Features.',
            needs=k['needs'],
            faReference=dict(devOnly=True, role=k['faRole'], bp=k['faRef'], crossCheckBp=k['crossBp'],
                             **({'infoBp': k['infoBp']} if k.get('infoBp') else {})),
            categories=k['cats'],
            buildableBy=ENG_T4,
            economy={kk: v for kk, v in dict(mass=k['mass'], energy=k['energy'], buildTime=k['bt'], buildPower=k.get('buildPower'),
                                               upkeepEnergyPerSec=k.get('upkeepE') or None, **(k.get('eco') or {})).items() if v is not None},
            health=dict(max=k['hp'], regenPerSec=k['regen']),
            shield=None,
            weapons=ws,
            motion={kk: v for kk, v in dict(layer='air' if k['group'] == 'air' else 'land', speed=k['speed'], turnRateDeg=k['turn'],
                                             accel=k['accel'], sizeClass=dict(land=3, air=0).get(k['group']), footprint=k['footprint'],
                                             legs=k['legs'], structure=True if k['group'] == 'structure' else None,
                                             dimensionsWU=k['dims']).items() if v is not None},
            intel=dict(vision=k['vision']),
            special=dict(toggles=['wurzeln (C17)'] if k['id'].endswith('arty') else [], builds=k.get('builds'),
                         deathWeapon=k['death'], notes=k['notes'], postMvp=k['postMvp']),
            hotbuild=dict(menu='Bau (T4-Tab)', slot=dict(exp_lnd_assault='Q', exp_lnd_arty='W', exp_lnd_siege='E', exp_air_gunship='R',
                                                         exp_str_eco='T')[k['id'].split(':')[1]]),
            icon=k['icon'],
            iconMarker='eckige Klammer um die Grundform statt Tech-Kerben, Größenfaktor 1,5 (faction.md Varkan §6.4)',
            kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris,
                         trisBudget=dict(L0=BUDGET['trisL0'], L1=BUDGET['trisL1'], L2=BUDGET['trisL2']),
                         legs=k['legs'], techMarker='Klammer-Winkel quarzweiß (2 Winkel an den vorderen Panzerecken statt Tech-Streifen)',
                         monopoly=k['monopoly'], description=k['kitbash']),
        )
        # ------------------------------------------------ Balance gegen Vorbild-T4
        b = dict(dps=round(dps, 2))
        if k['faRef']:
            r = FA[k['faRef']]
            fdps = r['dps']
            hpm, fhpm = k['hp'] / k['mass'], r['hp'] / r['mass']
            b.update(dpsPerMass=round(dps / k['mass'], 5), hpPerMass=round(hpm, 4),
                     fa=dict(bp=k['faRef'], mass=r['mass'], energy=r['energy'], buildTime=r['bt'], hp=r['hp'], regen=r['regen'],
                             dps=fdps, dpsPerMass=round(fdps / r['mass'], 5), hpPerMass=round(fhpm, 4), speed=r['speed']))
            dd = ((dps / k['mass']) / (fdps / r['mass']) - 1) * 100
            dh = (hpm / fhpm - 1) * 100
            dp = ((1 + dd / 100) * (1 + dh / 100) - 1) * 100
            b.update(devDpsPerMassPct=round(dd, 1), devHpPerMassPct=round(dh, 1), devProductPct=round(dp, 1))
            b['withinBand25'] = abs(dd) <= 25 and abs(dh) <= 25
            b['withinTarget15'] = abs(dd) <= 15 and abs(dh) <= 15 and abs(dp) <= 15
            if 'ARTILLERY' in cats:
                fw = main_fa_weapon(r); w = ws[0]
                t = lambda s: math.pi * (s + 0.5) ** 2 / 4
                rel = fa_reload(fw['rof']); fsal = max(1, round(fw['dps'] * rel / fw['dmg']))
                pk = (w['damage'] * w['salvo'] * t(w['splash']) / w['reloadS'] / k['mass']) / \
                     (fw['dmg'] * fsal * t(fw['splash'] or 0) / rel / r['mass']) - 1
                b['pulk'] = dict(devPct=round(pk * 100, 1), faSalvo=fsal, faReloadS=rel)
            # Identität „billiger, schneller, zerbrechlicher“
            b['identity'] = dict(cheaper=k['mass'] <= r['mass'], faster=(k['speed'] or 0) >= (r['speed'] or 0), frailer=hpm <= fhpm + 1e-9)
            if k['crossBp'] and k['crossBp'] in FA:
                c = FA[k['crossBp']]
                b['crossInfo'] = dict(bp=k['crossBp'], note='Gegenprobe Varkan-Vorbild, nur Info (Varkan hat noch keine T4)',
                                      dpsPerMass=round(c['dps'] / c['mass'], 5),
                                      hpPerMass=round((c['hp'] + (c['shield'] or 0)) / c['mass'], 4))
        else:
            # Eco: Amortisation gegen die eigene Egel-Kette (Mass-Äquivalent der Energie über Druse III)
            mex = [E[i] for i in ('f2:str_t1_mex', 'f2:str_t2_mex', 'f2:str_t3_mex')] if E else None
            pg = E.get('f2:str_t3_pgen') if E else None
            if mex and pg:
                m_per_e = pg['economy']['mass'] / pg['economy']['energyPerSec']
                chain_mass = sum(x['economy']['mass'] for x in mex)
                chain_up = mex[-1]['economy'].get('upkeepEnergyPerSec', 0) * m_per_e
                chain_pay = (chain_mass + chain_up) / mex[-1]['economy']['massPerSec']
                own_pay = (k['mass'] - k['eco']['energyPerSec'] * m_per_e) / k['eco']['massPerSec']
                ratio = own_pay / chain_pay
                b.update(payback=dict(massEquivPerEnergyPerSec=round(m_per_e, 3), paybackS=round(own_pay, 0),
                                      mexChainPaybackS=round(chain_pay, 0), ratio=round(ratio, 2), gate='1,5 ≤ ratio ≤ 3,0'))
                b['withinBand25'] = b['withinTarget15'] = 1.5 <= ratio <= 3.0
            r = FA.get(k.get('infoBp'))
            if r:
                b['foreignInfo'] = dict(bp=k['infoBp'], mass=r['mass'], hp=r['hp'],
                                        note='Fremdreferenz (andere FA-Fraktion), nur Obergrenze für Kosten und Sprengkraft')
        e['balance'] = b
        # ------------------------------------------------ Setons-Brücke
        d = k['dims']
        outer = max(d['width'], d.get('legSpan') or 0, min(k['footprint']))
        if k['group'] == 'land':
            e['motion']['bridge'] = dict(minBridgeWU=BRIDGE_WU, outerWidthWU=outer, abreast=int(BRIDGE_WU // outer),
                                         ok=BRIDGE_WU // outer >= BRIDGE_ABREAST)
        out.append(e)

        # ------------------------------------------------ Checks
        def chk(c, *m):
            if not c: errs.append((k['id'],) + m)
        chk(e['id'].startswith('f2:exp_'), 'ID-Schema')
        chk(b.get('withinBand25'), 'Band ±25 %', b)
        chk(b.get('withinTarget15'), 'Ziel ±15 %', b)
        if b.get('pulk'): chk(abs(b['pulk']['devPct']) <= 15, 'Pulk ±15 %')
        if b.get('identity'):
            chk(all(b['identity'].values()), 'Identität billiger/schneller/zerbrechlicher', b['identity'])
        for w in ws:
            chk(abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, '10-Hz-Tick', w['ref'])
        chk(tris <= BUDGET['trisL0'] and len(parts) <= BUDGET['parts'] and anim <= BUDGET['animated'], 'T4-Budget', tris, len(parts), anim)
        chk(any(p.get('mat') == 'team' for p in parts), 'Teamfarbe')
        for p in parts:
            if p['part'] in ('spool', 'druse') or p.get('mat') == 'glow': chk(cats & FLOW_CATS, 'Glut-Monopol', p)
            if p['part'] == 'spike': chk('ANTIAIR' in cats, 'Dorn-Monopol', p)
            if p['part'] == 'tail': chk('ARTILLERY' in cats, 'Schwanz-Monopol', p)
            if p['part'] == 'lens': chk('DIRECTFIRE' in cats, 'Linsen-Monopol', p)
            if p['part'] == 'abdomen': chk('BOMBER' in cats, 'Hinterleib-Monopol', p)
        if k['group'] == 'land': chk((k['legs'] or 0) >= 8, 'T4 = ≥ 8 Beine')
        if k['group'] == 'land': chk(e['motion']['bridge']['ok'], 'Setons-Brücke', e['motion']['bridge'])
        glyph = e['icon'].split('_', 1)[1].rsplit('_', 1)[0]
        chk(e['icon'].endswith('_t4') and e['icon'].split('_')[0] in ('land', 'air', 'struct'), 'Icon-Schema', e['icon'])
        if icon_glyphs: chk(glyph in icon_glyphs, 'Icon-Glyphe nicht in der gemeinsamen Liste', glyph)
        for pm in k['postMvp']: chk(pm['feature'] and pm['effect'], 'postMvp')
    ids = [e['id'] for e in out]
    assert len(ids) == len(set(ids))
    kinds = [e['group'] for e in out]
    if kinds.count('land') < 1 or kinds.count('air') < 1 or not any('STRATEGIC' in e['categories'] or e['group'] == 'structure' for e in out):
        errs.append(('Mix', 'mind. 1 Land, 1 Luft, 1 Game-Ender/Spezial-Struktur'))
    return out, errs


def extract(index_path):
    sys.path.insert(0, HERE)
    import fa_extract as FX
    db = json.load(open(index_path))
    units = {u['Id'].upper(): u for u in db['units']}
    out = {'_meta': dict(source='FAForever/spooky-db app/data/index.json', version=db.get('version'), devOnly=True,
                         note='T4-Referenzen (Vorbild + Gegenproben). Nur Relationen. FA-Namen nie in Anzeige/i18n.')}
    for b in T4_REFS:
        out[b] = FX.entry(units[b])
    json.dump(out, open(REF_PATH, 'w'), indent=1, ensure_ascii=False)
    print('fa_ref_t4.json:', len(out) - 1, 'BPs')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--extract':
        extract(sys.argv[2]); sys.exit(0)
    ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
    D = json.load(open(os.path.join(ROOT, 'docs', 'design', 'factions', 'f2', 'roster.json')))
    ents, errs = build(icon_glyphs=D['iconGlyphs'], own_units={u['id']: u for u in D['units']})
    for e in ents:
        b = e['balance']
        print(f"{e['id']:20s} {e['name']['de']:12s} M{e['economy']['mass']:>7} HP{e['health']['max']:>7} DPS{b['dps']:>8} "
              f"dps/m {b.get('devDpsPerMassPct')} hp/m {b.get('devHpPerMassPct')} prod {b.get('devProductPct')} pulk {(b.get('pulk') or {}).get('devPct')} "
              f"pay {(b.get('payback') or {}).get('ratio')} tris {e['kitbash']['trisEstimate']} parts {e['kitbash']['partCount']} "
              f"bridge {(e['motion'].get('bridge') or {}).get('abreast')}")
    for x in errs: print('FEHLER', *x)
    sys.exit(1 if errs else 0)
