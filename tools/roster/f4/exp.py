# Experimentals (T4, Post-MVP) des Aurith-Chors für docs/design/factions/f4/roster.json → Schlüssel `experimentals`.
# Design und Begründung: docs/design/factions/f4/experimentals.md. Wird von gen.py importiert (build()); die MVP-Zählung
# (49 / 26 ● / 28 Visuals) bleibt unberührt, weil T4 nicht in `units` steht (cross.py und die MVP-Gates sehen sie nicht).
# FA-Referenz: fa_ref_t4.json (ref_t4.py, spooky-db 3810 + FAF develop), nur Relationen, dev-only.
import json, math
from pathlib import Path

HERE = Path(__file__).resolve().parent
FA4 = json.load(open(HERE / 'fa_ref_t4.json'))

# T4-Budget (Vorschlag, experimentals.md §3): eigenes Visual je T4 (kein Superset), Modellkit-Klasse `exp`
T4_BUDGET = dict(maxParts=10, maxAnimated=4, lod0=1500, lod1=800, lod2=320, segmentFactor=3,
                 note='Tris-Schätzung = Summe der Primitive (faction.md §3.3) × Segmentfaktor 3 (T4 füllt bis 15 % des Bildschirms, '
                      'runde Primitive mit dreifacher Segmentzahl). Teile ≤ 10, davon ≤ 4 animiert (PartStream-Limit 8 bleibt frei). '
                      'Tris L0/L1/L2 = @faf/modelkit T4_BUDGET (1500/800/320), LOD-Distanzen T4 120/360 WU.')
SETONS_BRIDGE_WU = 74   # engste Stelle der Landbrücke (content/maps/src/setons.spec.md §Landbrücke)
BRIDGE_MIN_WU = 72      # Planungsgrenze (gemeinsam mit f2): engste Brücke 72 WU
BRIDGE_ABREAST = 6      # mindestens 6 T4 nebeneinander → Außenmaß ≤ 12 WU (wie f2)
SIZE_CLASS_MAX = 7      # packages/blueprints/src/schema.ts: sizeClass 0–7

T4_ENG = 'ENGINEER & TECH3 | COMMAND & TECH3'  # Vorsänger; Kantor erst mit T3-Upgrade (U14)
T4_MENU = 'Bau (T4-Tab)'                        # Hotbuild-Tab wie f2: Q Sturmläufer, W Artillerie, R Luft, T Eco; Aurith: V Strategiewerfer


def build(NS, P, W, PM, TRIS):
    X = []

    def T(**k):
        k['id'] = f"{NS}:{k['id']}"
        X.append(k)

    # ------------------------------------------------------------ 1. Land: Sturmläufer (Vorbild XSL0401)
    T(id='exp_assault', de='Hymne', en='Hymn', roleDe='Experimenteller Sturmläufer', roleEn='Experimental Assault Walker',
      group='land', layer='land', faRef='XSL0401', faRole='Experimental Assault Bot', feature='U16',
      cats=['LAND', 'MOBILE', 'EXPERIMENTAL', 'DIRECTFIRE', 'INDIRECTFIRE', 'ANTIAIR', 'BOT'],
      mass=26500, energy=330000, bt=46875, hp=72000, regen=20, speed=2.4, turn=60, accel=0.8, sizeClass=3, footprint=[4, 4],
      vision=50,
      weapons=[W('wpn_hymn_beam', 'Große Schwebung (Strahl zwischen den Brustzinken)', 500, 5.0, 46, 'hitscan-puls', salvo=10, minr=4, splash=3,
                 extra='Strahl nach Konvention `beam` (10 Pulse pro Zyklus). Glyphen sammeln sich 1,5 s vor dem Zyklus an den Zinken (nur View).'),
               W('wpn_hymn_fork', 'Doppelgabelton (beide Brustzinken)', 560, 0.6, 46, 'linear', salvo=2, mv=30),
               W('wpn_hymn_horn', 'Stoßklang (Schultertrichter)', 2000, 3.5, 46, 'ballistisch (flach)', splash=6, mv=40,
                 extra='Sammelbewegung der Glyphen 1,5 s vor dem Schuss (§3.5).'),
               W('wpn_hymn_pipes', 'Pfeifenkranz (Flugabwehr, gestuft)', 30, 1.0, 46, 'linear', salvo=6, splash=3, mv=30, layers=('air',))],
      groundIdx=[0, 1, 2], airIdx=[3], faGroundIdx=[0, 1, 2], faAirIdx=[3], slot='Q', outer=6.0,
      death=dict(ref=f'{NS}:wpn_hymn_afterring', damage=6000, radius=6,
                 field=dict(durationS=20, radius=14, pulseS=0.5, damagePerPulse=500, targets='zufällig, Freund und Feind'),
                 note='Nachhall: Aufprall 6000/6, danach 20 s ein stehendes Resonanzfeld (Entladungsbögen, 1000 DPS gegen je ein Ziel im Umkreis 14). '
                      'Kein eigener Blueprint, keine Einheit (Vorbild: bewegliches Energiewesen 30 s).'),
      special='Linienbrecher der späten Phase. Weniger, schwerere und sichtbar geladene Schüsse als das Vorbild (Δ DPS/Mass −9 %), dafür zäher '
              '(Δ HP/Mass +7,5 %). Reichweite 46 liegt unter dem Heerhorn (88) und dem Großhorn (200): Konter sind Artillerie, Bomber, Masse an Diskanten.',
      postMvp=PM(('U16', 'Erstes Land-Experimental: Bau durch Vorsänger vor Ort, großes Wrack', 'nicht baubar'),
                 ('K14', 'Todeswaffe mit Nachwirkung: 20-s-Resonanzfeld mit Pulsen (DoT-Feld, Erweiterung von K14)', 'nur Aufprall 6000/6'),
                 ('M13', 'amphibisch: läuft über den Seegrund (Vorbild ebenso)', 'nur Land'),
                 ('P14', 'Großereignis-Effekt beim Zerspringen (Glassturm, Kamera-Shake)', 'normaler Struktur-Tod-Effekt'),
                 ('A16', 'KI baut und eskortiert T4 mit Engineer-Pulks', 'KI baut keine T4')),
      needsBeam=True, icon='land_bot_t4',
      parts=P('legs keel:amber@spindel_torso fork*yawpitch@brustgabel lens@strahllinse horn:team*pitch@schultertrichter '
              'pipe@pfeifen_links pipe@pfeifen_rechts fin:team@kamm fin:team@zweiter_kamm'),
      kitbash='Riesiges Dreibein (legs count 3, rückwärts geknickt), Höhe ≈ 9 WU (3,2 × Kantor), hoher Spindel-Torso aus Bernstein. Waagerechte '
              'Brustgabel mit Strahllinse zwischen den Zinken (Zinken 4,2 WU, ragen 1,5 WU über die Brust), rechts auf der Schulter ein '
              'kleiner Trichter (Länge ≤ Gabel ÷ 1,5, Hybrid-Regel §5.3), auf dem Rücken zwei Gruppen aus je drei gestuften senkrechten Pfeifen, '
              'dazwischen zwei parallele teamfarbene Kämme, die nach hinten bis über die Hüfte auslaufen. Kein Kristall, keine Krone, kein Kopf, '
              'keine Arme: Der Kantor liest sich über Krone und Sichel, die Hymne über Größe, Doppelkamm und Pfeifen.',
      pairs=['cmd_commander', 'lnd_t2_bot'])

    # ------------------------------------------------------------ 2. Land: Wandernde Halle (Fremdreferenz UEL0401)
    T(id='exp_mobile_fac', de='Ensemble', en='Ensemble', roleDe='Wandernde Halle', roleEn='Roving Hall',
      group='land', layer='land', faRef='UEL0401', faRole='Experimental Mobile Factory (Fremdreferenz, Vorbild ohne mobile Fabrik)', feature='U21',
      cats=['LAND', 'MOBILE', 'EXPERIMENTAL', 'FACTORY', 'ARTILLERY', 'INDIRECTFIRE', 'DIRECTFIRE', 'ANTIAIR', 'SHIELD'],
      mass=28000, energy=350000, bt=47500, bp=135, hp=11000, regen=20, speed=1.7, turn=30, accel=0.5, sizeClass=3, footprint=[6, 6],
      vision=32,
      shield=dict(hp=24000, radius=26, regenPerSec=130, regenStartS=3, rechargeS=60, upkeepEnergyPerSec=600),
      weapons=[W('wpn_ensemble_horn', 'Chorstoß (zwei Trichter im Wechsel)', 1400, 1.0, 90, 'ballistisch', salvo=2, minr=10, splash=1.5, mv=25,
                 extra='Die Trichter feuern abwechselnd; Sammelbewegung der Glyphen 0,5 s vor jedem Stoß.'),
               W('wpn_ensemble_fork', 'Gabelkranz (Nahabwehr)', 150, 0.3, 40, 'linear', salvo=2, mv=40),
               W('wpn_ensemble_pipes', 'Pfeifenbank (Flugabwehr)', 40, 1.0, 40, 'linear', salvo=3, mv=40, layers=('air',))],
      groundIdx=[0, 1], airIdx=[2], faGroundIdx=[0, 1], faAirIdx=[2], slot='W', outer=6.0,
      death=dict(ref=f'{NS}:wpn_ensemble_shatter', damage=4000, radius=7, note='Zerspringen der Apsis, Vorbild-Relation 1:1'),
      special='Singt T1–T3-Landeinheiten der Grundhalle in Bewegung (Build Power 135, Ausgang durch die Apsis am Heck) und trägt eine große '
              'Glocke (24.000 Schild-HP, Radius 26). Gegenüber der Fremdreferenz verschoben Richtung Schild und Halle: DPS/Mass −5 %, HP+Schild/Mass +7,7 %. '
              'Die Aurith-Asymmetrie: stärkster mobiler Schild der Fraktion (Stille 9.600), aber die langsamste Einheit (1,7 WU/s, 30 °/s).',
      postMvp=PM(('U21', 'Volles Experimental-Roster', 'nicht baubar'),
                 ('B12', 'NEU: Mobile Fabrik – Bauen während der Fahrt, Ausgang und Rally relativ zur Einheit, Queue auf der Einheit', 'keine Produktion'),
                 ('K10', 'mobiler Blasen-Schild auf einer T4 (wie Stille, größer)', 'HP ohne Schild (11.000)'),
                 ('M13', 'Hover: gleitet über Wasser (Gleiter-Look wird echt)', 'nur Land')),
      icon='land_arty_t4',
      parts=P('keel:amber@riesenkiel shell:team@apsis_heck crystal:glow@resonanzkern horn:team*yawpitch@trichter_links '
              'horn:team*yawpitch@trichter_rechts fork*yaw@gabelkranz mast@schildmast ring@glocke_waagerecht pipe@pfeifenbank fin:team@kamm'),
      kitbash='Überlanger Gleiter-Kiel 7 × 5 WU, Höhe ≈ 5 WU, 0,3 WU Schwebespalt. Hinten eine halb offene Muschel-Apsis (offene Seite nach hinten = Ausgang) '
              'mit Kristall über dem Scheitel (Resonanzkern, Flow-Einheit: FACTORY). Vorn links und rechts je ein offener Trichter 50° (Artillerie), '
              'mittig ein Mast mit waagerechtem Reif Ø 5 WU als höchstem Punkt (Schild), vor dem Mast ein kurzer Gabelkranz, seitlich eine '
              'Pfeifenbank. Teamfarbener Kamm über die ganze Länge. Lesereihenfolge von oben: Reif (Schild) → Trichter (Artillerie) → Apsis (Halle).',
      pairs=['str_t3_fac_land', 'lnd_t3_shield'])

    # ------------------------------------------------------------ 3. Luft: Bomber (Vorbild XSA0402)
    T(id='exp_air_bomber', de='Heupferd', en='Katydid', roleDe='Experimenteller Bomber', roleEn='Experimental Bomber',
      group='air', layer='air', faRef='XSA0402', faRole='Experimental Bomber', feature='U21',
      cats=['AIR', 'MOBILE', 'EXPERIMENTAL', 'BOMBER', 'ANTIAIR', 'HIGHALTAIR'],
      mass=48000, energy=1920000, bt=67500, hp=50000, regen=25, speed=16, turn=40, accel=None, sizeClass=0, footprint=[6, 6],
      vision=70,
      weapons=[W('wpn_katydid_bomb', 'Dröhnbombe (ein Abwurf pro Anflug)', 12000, 14.0, 90, 'Bombe', splash=17,
                 extra='Bomber-DPS nach Konvention (Salvenschaden / Nachladezeit). Auftreffen mit 1 s Brummton-Vorwarnung am Boden (nur View/Audio).'),
               W('wpn_katydid_pipes', 'Zirpkranz (vier Pfeifengruppen)', 400, 1.0, 64, 'linear', salvo=4, mv=90, layers=('air',))],
      groundIdx=[0], airIdx=[1], faGroundIdx=[0], faAirIdx=[1], slot='R',
      death=dict(ref=f'{NS}:wpn_air_crash_xl', damage=8000, radius=10, note='Absturzschaden (K12), Vorbild-Relation 1:1'),
      special='Hybrid Bomber + Flugabwehr (Fächer primär, Pfeifen sekundär). Langsamer als das Vorbild (16 statt 18 WU/s, „schwer statt schnell“, A10), '
              'dafür schwerere Bombe (12.000 statt 11.000, Radius 17 statt 19). Eine Bombe tötet jede T3-Landeinheit außer Grollen-Pulks unter Schild. '
              'Konter: Hochorgel-Netz, Abfangjäger in Masse, Schilde.',
      postMvp=PM(('U21', 'Luft-Experimental', 'nicht baubar'),
                 ('U12', 'T3-Luft (Flughöhe HIGHALTAIR, Jäger-Gegenstück) als Voraussetzung', 'fliegt auf normaler Flughöhe'),
                 ('P14', 'Großereignis-Effekt beim Bombeneinschlag und Absturz', 'normaler Einschlag')),
      icon='air_bomb_t4',
      parts=P('shell:team@faecher_oben shell:amber@deckfluegel lens@bauchkammer keel:amber@mittelkiel pipe*yaw@pfeifen_vorn '
              'pipe*yaw@pfeifen_hinten fin:team@fluegelrippe_links fin:team@fluegelrippe_rechts'),
      kitbash='Breiter Fächer (Muschel von oben) mit Spannweite 12 WU und Länge 8 WU, darunter ein zweiter, kleinerer Amber-Fächer als Deckflügel, '
              'mittig ein kurzer Kiel und eine große Bauch-Linse (Bombenkammer). Auf der Fächeroberseite vier Gruppen gestufter senkrechter '
              'Pfeifen (Flugabwehr), zwei teamfarbene Flügelrippen strahlen vom Kiel zur Fächerkante. Breit ≥ lang wie jeder Aurith-Bomber; '
              'keine Pfeilung, keine Gabel, keine Reifen. Teamfarbe ≥ 45 % der Draufsicht (Fächer).',
      pairs=['air_t1_bomber', 'air_t2_fbomber'])

    # ------------------------------------------------------------ 4. Game-Ender: Strategiewerfer (Vorbild XSB2401)
    T(id='exp_strat_missile', de='Tuba', en='Tuba', roleDe='Experimenteller Strategiewerfer', roleEn='Experimental Strategic Launcher',
      group='def', layer='land', faRef='XSB2401', faRole='Experimental Missile Launcher (strategisch)', feature='U21',
      cats=['STRUCTURE', 'EXPERIMENTAL', 'STRATEGIC', 'SILO', 'NUKE', 'INDIRECTFIRE'],
      mass=185000, energy=10000000, bt=250000, bp=2160, hp=12500, footprint=[6, 6], vision=28,
      weapons=[W('wpn_tuba_final', 'Schlussakkord (strategische Rakete)', 1000000, 60.0, 20000, 'Lenkrakete (strategisch)', splash=42, mv=30,
                 extra='Innenring 1.000.000 Schaden, Radius 42 (alles verstummt, auch Kommandanten); Außenring 7.500 Schaden, Radius 58. '
                       'Rakete singt sich selbst: 600 M / 6.000 E / buildTime 129.600 bei Build Power 2.160 = 60 s; Lager 1, Start leer. '
                       'Aurith-Signatur: 3 s vor dem Einschlag erscheint am Ziel ein phasenblauer Glyphenring (für alle sichtbar).')],
      groundIdx=[], airIdx=[], faGroundIdx=[], faAirIdx=[], slot='V',
      missile=dict(mass=600, energy=6000, buildTime=129600, buildS=60, hp=60000, inner=dict(damage=1000000, radius=42),
                   outer=dict(damage=7500, radius=58), storage=1, initialStorage=0, warningRingS=3),
      death=dict(ref=f'{NS}:wpn_tuba_shatter', inner=dict(damage=20000, radius=15), outer=dict(damage=5000, radius=20),
                 note='Zerspringen des Trichters, Vorbild-Relation 1:1'),
      special='Game-Ender. Kosten ≈ 1,0 × Vorbild (Mass −1,4 %), Innenring −7 % (42 statt 45), dafür für den Verteidiger sichtbare Vorwarnung 3 s. '
              'Eine Rakete pro 60 s ohne eigene Munitionskosten außer 600 M: Die Antwort muss eine Raketenabwehr (K17) oder der Angriff auf die Tuba sein.',
      postMvp=PM(('K17', 'Strategische Raketen und Raketenabwehr (manueller Start, Abfangen)', 'nicht baubar'),
                 ('U21', 'Game-Ender im vollen Experimental-Roster', 'nicht baubar'),
                 ('P14', 'Großereignis-Effekt: Stille-Welle (Druckring, Farbentzug, 2 s Audio-Ducking)', 'Struktur-Tod-Effekt'),
                 ('A21', 'KI startet strategische Raketen und baut Abwehr', 'KI nutzt die Tuba nicht')),
      icon='struct_mml_t4',
      parts=P('lens:team@dreipass_1 lens:team@dreipass_2 lens:team@dreipass_3 ring*yaw@drehkranz horn:team*pitch@riesentrichter '
              'spindle@raketenspitze fin@gegengewicht fin:team@zweiter_kamm'),
      kitbash='Dreipass-Sockel 6 × 6 WU, darauf ein Drehkranz und ein riesiger offener Trichter (Öffnung Ø 3,6 WU, Länge 5 WU), 55° geneigt, '
              'also schräg = indirekt (nie ≥ 75°, das wäre Flugabwehr). Solange eine Rakete geladen ist, ragt eine dicke Spindel '
              '(Ø 1,2 WU) aus der Trichteröffnung (Zustand „geladen“ ohne HUD lesbar, nur View). Zwei Kämme als Gegengewicht nach hinten. '
              'Keine Kristalle (keine Flow-Struktur).',
      pairs=['str_t3_arty', 'str_t3_sam'])

    # ------------------------------------------------------------ 5. Eco: Resonanzgenerator (Fremdreferenz XAB1401)
    T(id='exp_resource', de='Klangschale', en='Singing Bowl', roleDe='Experimenteller Resonanzgenerator', roleEn='Experimental Resource Generator',
      group='eco', layer='land', faRef='XAB1401', faRole='Experimental Resource Generator (Fremdreferenz, Vorbild ohne T4-Eco)', feature='E17',
      cats=['STRUCTURE', 'EXPERIMENTAL', 'ECONOMIC', 'MASSPRODUCTION', 'ENERGYPRODUCTION', 'STRATEGIC'],
      mass=250200, energy=7506000, bt=325000, hp=5500, footprint=[8, 8], vision=14,
      eco=dict(massPerSecMax=4000, energyPerSecMax=400000, storageMass=10000, storageEnergy=100000, rampUpS=90),
      weapons=[], groundIdx=[], airIdx=[], faGroundIdx=[], faAirIdx=[], slot='T',
      death=dict(ref=f'{NS}:wpn_bowl_shatter', damage=35000, radius=24, note='Zerspringen der Schale: ein Ring, Radius 24 statt 25 (Dreipass 8 × 8)'),
      special='Ertrag folgt dem Verbrauch der Armee bis höchstens 4.000 M/s und 400.000 E/s (FAF-Relation). Aurith-Asymmetrie „Einschwingen“: '
              'Nach Fertigstellung steigt die Obergrenze in 90 s linear von 0 auf den Höchstwert (Vorbild: sofort). Dafür HP +10 %. '
              'Amortisation bei 1.000 M/s Verbrauch ≈ 250 s + 45 s Einschwingen.',
      postMvp=PM(('E17', 'Endgame-Eco: Ertrag folgt dem Verbrauch (Paragon-Mechanik) plus Einschwing-Rampe', 'nicht baubar'),
                 ('U21', 'volles Experimental-Roster', 'nicht baubar'),
                 ('P14', 'Großereignis-Effekt beim Zerspringen', 'Struktur-Tod-Effekt')),
      icon='struct_mass_t4',
      parts=P('lens:team@dreipass_1 lens:team@dreipass_2 lens:team@dreipass_3 lens:amber@schalenboden ring:amber@schalenrand '
              'crystal:glow@kristall_1 crystal:glow@kristall_2 crystal:glow@kristall_3 crystal:glow*spin@kloeppel'),
      kitbash='Dreipass-Sockel 8 × 8 WU, darin eine flache Riesenschale: Linse als Boden und waagerechter Amber-Reif Ø 6,5 WU als Rand '
              '(Reif ohne Mast = Flow-Anschluss). Drei stehende Kristalle (Höhe 5 WU) im Dreieck außen um die Schale (Resonator-Grammatik, '
              'drei = höchste Stufe), ein kleinerer Kristall als „Klöppel“ kreist langsam auf dem Rand (spin, nur View; beim Einschwingen schneller). '
              'Kein Mast, keine Muschel, keine Pfeifen.',
      pairs=['str_t3_pgen', 'str_t3_mex'])
    return X


def fa_reload(rof): return math.floor(10 / rof + 1e-6) / 10


def entries(X, TRIS):
    out = []
    for u in X:
        r = FA4[u['faRef']]
        ws = u['weapons']
        gnd = sum(ws[i]['dps'] for i in u['groundIdx'])
        air = sum(ws[i]['dps'] for i in u['airIdx'])
        fgnd = sum(r['weapons'][i]['dps'] for i in u['faGroundIdx'])
        fair = sum(r['weapons'][i]['dps'] for i in u['faAirIdx'])
        sh = (u.get('shield') or {}).get('hp', 0)
        hp_eff = u['hp'] + sh
        fhp = r['hp'] + (r['shield'] or 0)
        m, fm = u['mass'], r['mass']
        dd = round(((gnd / m) / (fgnd / fm) - 1) * 100, 1) if gnd and fgnd else None
        da = round(((air / m) / (fair / fm) - 1) * 100, 1) if air and fair else None
        dh = round(((hp_eff / m) / (fhp / fm) - 1) * 100, 1)
        dp = round(((1 + dd / 100) * (1 + dh / 100) - 1) * 100, 1) if dd is not None else None
        pulk = None
        if 'ARTILLERY' in u['cats']:
            w = ws[0]; fw = r['weapons'][0]; rel = fa_reload(fw['rof']); fs = round(fw['dps'] * rel / fw['dmg'])
            tg = lambda s: math.pi * (s + 0.5) ** 2 / 4
            ours = w['damage'] * w['salvo'] * tg(w['splash']) / w['reloadS'] / m
            theirs = fw['dmg'] * fs * tg(fw['splash'] or 0) / rel / fm
            pulk = dict(splash=w['splash'], faSplash=fw['splash'], pulkDpsPerMass=round(ours, 4), faPulkDpsPerMass=round(theirs, 4),
                        devPct=round((ours / theirs - 1) * 100, 1))
        mobile = u['group'] in ('land', 'air')
        parts = u['parts']
        tris = sum(TRIS[p['part']] for p in parts) * T4_BUDGET['segmentFactor']
        anim = sum(1 for p in parts if p.get('anim'))
        eco = dict(mass=m, energy=u['energy'], buildTime=u['bt'])
        if u.get('bp'): eco['buildPower'] = u['bp']
        if u.get('eco'): eco.update(u['eco'])
        if u.get('shield'): eco['upkeepEnergyPerSec'] = u['shield']['upkeepEnergyPerSec']
        e = dict(
            id=u['id'], name=dict(de=u['de'], en=u['en']), role=dict(de=u['roleDe'], en=u['roleEn']),
            tier='T4', tech=4, postMvp=True, feature=u['feature'], group=u['group'], visual='v_' + u['id'].split(':')[1],
            ms9Core=False, msFirst='post-MVP', msNote=f"T4 ist Post-MVP (features.json {u['feature']}); keine Sim-Wirkung vor den genannten Features.",
            needs=sorted({pm['feature'] for pm in u['postMvp']} | ({'K1-Erweiterung'} if u.get('needsBeam') else set())),
            faReference=dict(devOnly=True, role=u['faRole'], bp=u['faRef'], kind=r['kind']),
            categories=u['cats'], buildableBy=T4_ENG,
            economy=eco, health={k: v for k, v in dict(max=u['hp'], regenPerSec=u.get('regen')).items() if v},
            shield=u.get('shield'), weapons=ws,
            motion=(dict(layer=u['layer'], speed=u['speed'], turnRateDeg=u['turn'], accel=u.get('accel'), sizeClass=u['sizeClass'],
                         footprint=u['footprint']) if mobile else dict(layer='land', speed=0, footprint=u['footprint'], structure=True)),
            intel=dict(vision=u['vision']),
            special=dict(missile=u.get('missile'), deathWeapon=u.get('death'), notes=u['special'], postMvp=u['postMvp'],
                         needsBeam=bool(u.get('needsBeam'))),
            hotbuild=dict(menu=T4_MENU, slot=u['slot']), icon=u['icon'],
            iconMarker='eckige Klammer um die Grundform statt Tech-Kerben, Größenfaktor 1,5 (Varkan faction.md §6.4)',
            kitbash=dict(parts=parts, partCount=len(parts), animatedParts=anim, trisEstimate=tris,
                         trisBudget=dict(L0=T4_BUDGET['lod0'], L1=T4_BUDGET['lod1'], L2=T4_BUDGET['lod2']),
                         techStripes=0, techMark='Klammer im Icon, am Modell keine Tonpunkte', description=u['kitbash']),
            silhouettePairs=[f"{u['id'].split(':')[0]}:{p}" for p in u['pairs']],
            balance=dict(dpsGround=round(gnd, 2) or None, dpsAir=round(air, 2) or None,
                         dpsPerMass=round(gnd / m, 5) if gnd else None, hpPerMass=round(hp_eff / m, 5),
                         hpBasis='HP+Schild' if (sh or r['shield']) else 'HP',
                         fa=dict(bp=u['faRef'], mass=fm, energy=r['energy'], buildTime=r['bt'], hp=r['hp'], shieldHp=r['shield'],
                                 dpsGround=round(fgnd, 2) or None, dpsAir=round(fair, 2) or None, speed=r['speed'],
                                 range=max([w['range'] or 0 for w in r['weapons'] if w['cat'] not in ('Death', 'Missile')] or [0]) or None),
                         devMassPct=round((m / fm - 1) * 100, 1), devDpsPerMassPct=dd, devAirDpsPerMassPct=da, devHpPerMassPct=dh,
                         devProductPct=dp, pulk=pulk,
                         withinBand25=all(abs(x) <= 25 for x in (dd, dh, da) if x is not None),
                         withinTarget15=all(abs(x) <= 15 for x in (dd, dh, dp) if x is not None)),
        )
        if u['layer'] == 'land' and mobile:
            outer = max(u['outer'], u['footprint'][0])
            e['motion']['bridge'] = dict(minBridgeWU=BRIDGE_MIN_WU, setonsBridgeWU=SETONS_BRIDGE_WU, outerWidthWU=outer,
                                         abreast=int(BRIDGE_MIN_WU // outer), sizeClassRule='sizeClass = ceil(Außenmaß / 2) (Clearance ≥ Radius)',
                                         ok=BRIDGE_MIN_WU // outer >= BRIDGE_ABREAST and u['sizeClass'] == math.ceil(outer / 2) <= SIZE_CLASS_MAX)
        out.append(e)
    return out


FLOW_CATS = {'ECONOMIC', 'FACTORY', 'ENGINEER'}
MONOPOLY = {'crystal': FLOW_CATS, 'sickle': {'ENGINEER'}, 'pipe': {'ANTIAIR'}, 'horn': {'ARTILLERY', 'INDIRECTFIRE'},
            'spindle': {'SILO', 'ANTIAIR'}, 'fork': {'DIRECTFIRE'}, 'shell': {'RADAR', 'FACTORY', 'BOMBER'}}


def check(out, glyphs, all_ids):
    """Harte Gates der T4 (vom Generator erzwungen, validate.py prüft unabhängig nach)."""
    for e in out:
        k, b, cats = e['kitbash'], e['balance'], set(e['categories'])
        assert e['id'].split(':')[1].startswith('exp_'), e['id']
        assert k['partCount'] <= T4_BUDGET['maxParts'], (e['id'], k['partCount'])
        assert k['animatedParts'] <= T4_BUDGET['maxAnimated'], (e['id'], k['animatedParts'])
        assert k['trisEstimate'] <= T4_BUDGET['lod0'], (e['id'], k['trisEstimate'])
        assert b['withinBand25'] and b['withinTarget15'], (e['id'], b)
        if b['pulk']: assert abs(b['pulk']['devPct']) <= 15, (e['id'], b['pulk'])
        assert abs(b['devHpPerMassPct']) <= 15 and abs(b['devMassPct']) <= 15, (e['id'], b['devHpPerMassPct'], b['devMassPct'])
        for p in k['parts']:
            if p.get('mat') == 'glow': assert cats & FLOW_CATS, ('Resonanz-Monopol', e['id'])
            if p['part'] in MONOPOLY: assert cats & MONOPOLY[p['part']], ('Monopol', e['id'], p)
            if p['part'] == 'sickle' or p.get('mat') == 'pearl': assert 'ENGINEER' in cats, ('Perlglas', e['id'])
        assert any(p.get('mat') == 'team' for p in k['parts']), ('Teamfarbe', e['id'])
        # Icon: gemeinsame Grammatik, Stufe t4 = eckige Klammer statt Kerben (Varkan faction.md §6.4, wie f2); keine neue Glyphe
        dom, _, rest = e['icon'].partition('_'); g, _, lvl = rest.rpartition('_')
        assert dom in ('land', 'air', 'struct') and lvl == 't4' and g in glyphs, e['icon']
        if 'bridge' in e['motion']: assert e['motion']['bridge']['ok'], e['motion']['bridge']
        for w in e['weapons']:
            assert abs(w['reloadS'] * 10 - round(w['reloadS'] * 10)) < 1e-9, w['ref']
        for p in e['silhouettePairs']: assert p in all_ids, (e['id'], p)
