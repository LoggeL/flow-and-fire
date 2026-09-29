import re
S = open('gen.py').read()
def R(old, new, n=1):
    global S
    c = S.count(old)
    assert c == n, (c, old[:80])
    S = S.replace(old, new)

# --- Vogt
R("buildableBy=None, mass=2000, energy=5000000, bt=6000000, bp=10, hp=11000, regen=10,",
  "buildableBy=None, mass=2000, energy=5000000, bt=6000000, bp=10, hp=12000, regen=10,")
R("""             extra='Schaden = min(15000, f(0,9 x gespeicherte Energie)), mind. 1250; gegen Strukturen fix 800, gegen Vogt fix 400; '
                   'Mindestvorrat 7500 E (> Grundspeicher 3900 E => braucht Glutspeicher). Nicht in DPS/Mass gewertet.')],""",
  """             extra='FAF-Formel (OverchargeProjectile/OverchargeShared): Schaden = clamp(max. HP der mobilen Nicht-Vogt-Einheiten im Umkreis 2,7 WU '
                   '[ohne Ziel: 1250], 1250, min(15000, 0,9 x Vorrat / 6)); Drain = 6 x tatsächlicher Schaden. Unter 7500 E Vorrat: Schaden = 0,9 x Vorrat / 6. '
                   'Gegen Strukturen fix 800, gegen Vogt fix 400. Feuern erst ab 7500 E Vorrat (> Grundspeicher 3900 E => braucht Glutspeicher). '
                   'Kosten: gegen Punze 7500 E, gegen Meißel 9600 E; mit 1 Glutspeicher und +120 E/s ≈ 1 Abstich pro 60 s (FA-Relation). Nicht in DPS/Mass gewertet.')],""")
R("parts=P('legs hull*yaw@torso plumb:team@kopf stack:glow@rueckenschlot bell:team@rechter_arm barrel*pitch boom:ceramic@linker_ausleger'),\n  kitbash='Lot-Kopf auf Bot-Beinen, Torso-Wanne mit Schulterplatten (Team), Rücken-Schlot als stärkster Glutpunkt; rechts Glocken-Arm mit Rohr, links Keramik-Ausleger.')",
  "parts=P('legs hull*yaw@torso plumb:team@kopf stack:glow@rueckenschlot bell:team@rechte_schulter barrel*pitch boom:ceramic@rueckenkran'),\n  kitbash='Lot-Kopf auf Bot-Beinen, Torso-Wanne mit Schulterplatten (Team), Rücken-Schlot als stärkster Glutpunkt; Glocke mit Rohr auf der rechten Schulter, Keramik-Rückenkran über die linke Schulter (kein Waffen-/Bauarm-Schema). Höhe ≥ 2,4 WU, Schulterbreite ≥ 2,0 WU.')")

# --- Engineers (B2)
R("parts=P('hull:ceramic tracks boiler:copper boom*yaw ring:glow*pitch@emitter'),\n  kitbash='Kurze breite Wanne mit Keramik-Deck, ein diagonaler Kranarm mit Glut-Emitter, liegender Kupferkessel.')",
  "parts=P('hull:ceramic tracks boiler:team@kessel_bauchband boom:copper*yaw ring:glow*pitch@emitter'),\n  kitbash='Kurze breite Wanne mit Keramik-Deck, ein diagonaler Kupfer-Kranarm mit Glut-Emitter, liegender Kessel mit teamfarbenem Bauchband; 1 Tech-Streifen graphit auf dem Keramik-Deck.')")
R("parts=P('hull:ceramic tracks boiler:copper boom*yaw boom*yaw@kurzer_arm ring:glow@emitter'),\n  kitbash='Wie Lehrling, Maßstab 1,3, zwei Kranarme verschiedener Länge, 2 Tech-Streifen.')",
  "parts=P('hull:ceramic tracks boiler:team@kessel_bauchband boom:copper*yaw boom:copper*yaw@kurzer_arm ring:glow@emitter'),\n  kitbash='Wie Lehrling, Maßstab 1,3, zwei Kupfer-Kranarme verschiedener Länge, 2 Tech-Streifen graphit.')")
R("parts=P('hull:ceramic tracks boiler:copper boom*yaw boom*yaw boom@dritter_arm ring:glow@emitter'),\n  kitbash='Maßstab 1,7, drei Kranarme (Anzahl = Tech), 3 Tech-Streifen; dritter Arm statisch (Anim-Limit 2).')",
  "parts=P('hull:ceramic tracks boiler:team@kessel_bauchband boom:copper*yaw boom:copper*yaw boom:copper@dritter_arm ring:glow@emitter'),\n  kitbash='Maßstab 1,4 (Deckel für 1×1-Footprint), drei Kupfer-Kranarme (Anzahl = Tech), 3 Tech-Streifen graphit; dritter Arm statisch (Anim-Limit 2).')")

# --- Funke
R("parts=P('hull tracks mast:copper'),\n  kitbash='Kleinster Rumpf, hoher dünner Mast (≥ Rumpfhöhe) mit Glutnaht an der Spitze.')",
  "parts=P('hull:team tracks mast:copper'),\n  kitbash='Kleinster Rumpf (Deck teamfarben), hoher dünner Mast ≥ 1,0 × Rumpflänge ohne Kopfteil, Glutnaht an der Spitze.')")
# --- Stichel icon
R("hotbuild=('Landwerk', 'S'), icon='land_direct_t1',\n  parts=P('legs hull bell:team*yaw barrel*pitch'),",
  "hotbuild=('Landwerk', 'S'), icon='land_bot_t1',\n  parts=P('legs hull bell:team*yaw barrel*pitch'),")
# --- Punze
R("mass=56, energy=280, bt=280, hp=330, speed=3.1, turn=90,", "mass=56, energy=280, bt=300, hp=300, speed=3.3, turn=90,")
R("special='Linienhalter: etwas mehr HP, etwas langsamer als die FA-Referenz (Gusseisen-Identität).',",
  "special='Linienhalter nach FA-Relation. HP 300 hält die Breakpoints: 3 Vogt-Treffer, 6 Riegel-I-Treffer, 5 Meißel-Salven.',")
# --- Kelle
R("mass=40, energy=200, bt=200, hp=210, speed=2.7, turn=90, accel=2.2, sizeClass=1, footprint=[1, 1], vision=18,\n  weapons=[W('core:wpn_slag_mortar_t1', 'Schlackenmörser', 110, 8.0, 30, 'ballistisch', minr=6, splash=1.5, mv=14)],\n  special='Splash 1,5 statt 1 (FA), dafür etwas weniger Einzelschaden. Glüht nur beim Schuss (0,5 s).',",
  "mass=36, energy=180, bt=200, hp=210, speed=2.7, turn=90, accel=2.2, sizeClass=1, footprint=[1, 1], vision=18,\n  weapons=[W('core:wpn_slag_mortar_t1', 'Schlackenmörser', 100, 9.0, 30, 'ballistisch', minr=6, splash=1.1, mv=14)],\n  special='Splash 1,1 statt 1 (FA), dafür langsamer (9,0 s statt 8,3 s). Schaden 100 wie FA: 1 Treffer Stichel, 2 Lehrling, 3 Punze. Glüht nur beim Schuss (0,5 s).',")
# --- Sieb
R("mass=55, energy=275, bt=220, hp=300, speed=3.3, turn=80,", "mass=55, energy=275, bt=220, hp=310, speed=3.3, turn=80,")
R("kitbash='Wanne mit Rost-Platte, darauf 2 dünne senkrechte Rohre als Kamm quer zur Fahrtrichtung.')",
  "kitbash='Wanne mit Rost-Platte, darauf 2 dünne senkrechte Rohre (≥ 75°) als Kamm quer zur Fahrtrichtung.')")
# --- Meißel
R("weapons=[W('core:wpn_cannon_t2', 'Doppel-Glockenkanone', 32, 1.2, 22, 'linear', salvo=2, mv=30)],",
  "weapons=[W('core:wpn_cannon_t2', 'Doppel-Glockenkanone', 35, 1.3, 22, 'linear', salvo=2, mv=30)],")
# --- Rinne
R("weapons=[W('core:wpn_runner_missile_t2', 'Glutraketen (2er-Salve)', 280, 10.0, 60, 'homing (Wenderate, K11)', salvo=2,\n             minr=12, splash=1.5, mv=3)],",
  "weapons=[W('core:wpn_runner_missile_t2', 'Glutraketen (2er-Salve)', 300, 10.0, 60, 'homing (Wenderate, K11)', salvo=2,\n             minr=12, splash=1.0, mv=3)],")
R("parts=P('hull:team tracks boiler boom*yaw barrel*pitch@rinne barrel@zweite_rinne'),\n  kitbash='Wanne mit liegendem Kessel, schräge Doppelrinne ≥ 45° auf Schwenkarm; kein waagerechtes Rohr.')",
  "parts=P('hull:team tracks boiler boom*yaw hull*pitch@raketenkasten'),\n  kitbash='Wanne mit liegendem Kessel, ein breiter Raketenkasten 0,5 × 0,25 × 1,1 WU auf Schwenkarm, 50° geneigt (≥ 25° flacher als AA-Rohre, Breite ≥ 2 × AA-Rohr-Ø); kein Rohr.')")
# --- Rüttelsieb
R("kitbash='Sieb ×1,3 mit 3 senkrechten Rohren und Schürzenplatte, 2 Tech-Streifen.')",
  "kitbash='Sieb ×1,3 mit 3 senkrechten Rohren (≥ 75°) und Schürzenplatte, 2 Tech-Streifen.')")
# --- Schürze
R("shield=dict(hp=3200, radius=16, regenPerSec=50, rechargeS=25, upkeepEnergyPerSec=80),",
  "shield=dict(hp=3200, radius=16, regenPerSec=50, regenStartS=3, rechargeS=25, upkeepEnergyPerSec=80),")
R("kitbash='Wanne mit Mast, waagerechter Ring als höchster Punkt; kein Rohr, keine Glocke.')",
  "kitbash='Wanne mit Mast, waagerechter Ring (Ø ≥ 1,2 × Rumpfbreite) als höchster Punkt; kein Rohr, keine Glocke.')")
# --- Zange
R("mass=190, energy=950, bt=950, hp=700, speed=3.2, turn=80, accel=3.2, sizeClass=1, footprint=[1, 1], vision=24,\n  weapons=[W('core:wpn_gatling_t2', 'Glut-Gatling', 20, 0.3, 26, 'linear', mv=28)],\n  special='Schneller Nahkampf-Bot; kürzere Reichweite als die FA-Referenz (34), dafür 1 Waffe statt 2.',\n  hotbuild=('Landwerk', 'S'), icon='land_direct_t2',",
  "mass=190, energy=950, bt=950, hp=650, speed=3.2, turn=80, accel=3.2, sizeClass=1, footprint=[1, 1], vision=24,\n  weapons=[W('core:wpn_gatling_t2', 'Glut-Gatling', 20, 0.3, 30, 'linear', mv=28)],\n  special='Sturm-Bot, der Riegel I (RW 26) überreicht; RW 30 statt 34 (FA), 1 Waffe statt 2.',\n  hotbuild=('Landwerk', 'S'), icon='land_bot_t2',")
# --- Fallhammer
R("  hotbuild=('Landwerk', 'Q'), icon='land_direct_t3',\n  parts=P('legs hull:team bell:team*yaw barrel bell:team*yaw barrel stack@heckschlot'),\n  kitbash='Überlange Wanne auf Beinen, Doppelaufbau aus zwei Glocken, Heckschlot, 3 Tech-Streifen.')",
  "  hotbuild=('Landwerk', 'S'), icon='land_bot_t3',\n  parts=P('legs hull:team bell:team*yaw barrel bell:team*yaw barrel'),\n  kitbash='Überlange Wanne auf Beinen, Doppelaufbau aus zwei Glocken, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')")
# --- Pfanne
R("weapons=[W('core:wpn_pour_shell_t3', 'Gießgranate', 700, 9.0, 85, 'ballistisch', minr=25, splash=5, mv=24)],",
  "weapons=[W('core:wpn_pour_shell_t3', 'Gießgranate', 700, 10.0, 85, 'ballistisch', minr=25, splash=4.4, mv=24)],")
R("parts=P('hull:team tracks boom*yaw ladle:team*pitch hull@gegengewicht stack@heckschlot'),\n  kitbash='Kelle ×1,7 auf überlanger Wanne, Heckschlot, 3 Tech-Streifen.')",
  "parts=P('hull:team tracks boom*yaw ladle:team*pitch hull@gegengewicht'),\n  kitbash='Kelle ×1,7 auf überlanger Wanne, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')")
# --- Reißnadel
R("  hotbuild=('Landwerk', 'S'), icon='land_sniper_t3',\n  parts=P('legs hull:team bell:team*yaw barrel*pitch@langrohr stack@heckschlot'),\n  kitbash='Schlanke Beine, Glocke mit extrem langem waagerechtem Rohr (≥ 1,2 × Rumpflänge), kein zweites Rohr.')",
  "  hotbuild=('Landwerk', 'F'), icon='land_sniper_t3',\n  parts=P('legs hull:team bell:team*yaw barrel*pitch@langrohr'),\n  kitbash='Schlanke Beine, Glocke mit extrem langem waagerechtem Rohr (≥ 1,2 × Rumpflänge), kein zweites Rohr; Maßstab 1,4 (1×1-Deckel).')")
# --- Trommelsieb
R("special='Nur Luftziele. Heckschlot entfällt (7-Part-Limit).', hotbuild=('Landwerk', 'R'), icon='land_aa_t3',",
  "special='Nur Luftziele.', hotbuild=('Landwerk', 'R'), icon='land_aa_t3',")
R("kitbash='Sieb ×1,7 mit 4 senkrechten Rohren, 3 Tech-Streifen.')",
  "kitbash='Sieb ×1,4 (1×1-Deckel) mit 4 senkrechten Rohren, 3 Tech-Streifen.')")
# --- Turmfalke
R("weapons=[W('core:wpn_kestrel_gun_t1', 'Zwillings-Luftkanone', 23, 1.0, 25,", "weapons=[W('core:wpn_kestrel_gun_t1', 'Zwillings-Luftkanone', 25, 1.0, 25,")
# --- Dohle
R("kitbash='Gerader Breitflügel (breit ≥ lang) mit Bauch-Kessel, T-Form von oben.')",
  "kitbash='Gerader Breitflügel (breit ≥ lang) mit Bauch-Kessel, T-Form von oben; Kessellänge ≥ 1,4 × Flügeltiefe, ragt vorn und hinten sichtbar über.')")
# --- Krähe
R("roleDe='Kampfschwebeträger', roleEn='Gunship'", "roleDe='Kampfschweber', roleEn='Gunship'")
R("weapons=[W('core:wpn_crow_gun_t2', 'Bauch-Glocke', 18, 0.3, 22, 'linear', mv=80)],", "weapons=[W('core:wpn_crow_gun_t2', 'Bauch-Glocke', 16, 0.3, 22, 'linear', mv=80)],")
# --- Elster
R("parts=P('hull wing:team@delta boiler@bombenbauch wing@leitwerk'),\n  kitbash='Delta mit Bauch-Kessel; keine Ringdüse.')",
  "parts=P('hull wing:team@delta boiler@gondel_l boiler@gondel_r wing@leitwerk'),\n  kitbash='Delta mit zwei Kessel-Gondeln an den Flügelspitzen, Spannweite +30 % gegenüber Turmfalke; keine Ringdüse.')")
# --- Mex
R("mass=36, energy=360, bt=60, hp=420, footprint=[2, 2], vision=None,", "mass=36, energy=360, bt=60, bp=10, hp=420, footprint=[2, 2], vision=None,")
R("mass=900, energy=5400, bt=900, hp=2100, footprint=[2, 2], vision=20,", "mass=900, energy=5400, bt=900, bp=15, hp=2100, footprint=[2, 2], vision=20,")
R("parts=P('hull@sockel ring:team@kranz ring@zweiter_kranz stack:glow*tilt@pumpenkopf hull@schuerze_l hull@schuerze_r stack@heckschlot'),\n  kitbash='Zapfstelle ×1,7, doppelter Kranz, Schlot, 3 Tech-Streifen.')",
  "parts=P('hull@sockel ring:team@kranz ring@zweiter_kranz stack:glow*tilt@pumpenkopf hull@schuerze_l hull@schuerze_r'),\n  kitbash='Zapfstelle auf 2×2 (Höhe ×1,4), doppelter Kranz, 3 Tech-Streifen; kein Heckschlot (unterscheidet sich so von der Dampfquelle).')")
R("kitbash='Zapfstelle ×1,3 mit Schürzenplatten, 2 Tech-Streifen.')", "kitbash='Zapfstelle auf 2×2 (Höhe ×1,2) mit Schürzenplatten, 2 Tech-Streifen.')")
# --- Pgen
R("adjacency='Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % je angrenzendem Glutspeicher.',",
  "adjacency='Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Glutspeicher (SIZE4).',")
R("kitbash='Liegender Kessel mit einem Schlot (Zahl der Schlote = Tech), glühende Krone, Ruß-Gradient.')",
  "kitbash='Liegender Kessel mit einem Schlot (Zahl der Schlote = Tech, Schlothöhe ≥ 1,5 × Kessel-Ø), glühende Krone, Ruß-Gradient.')")
R("adjacency='Fabriken −12,5 % Energy-Verbrauch.', special='—', hotbuild=('Bau', 'W'), icon='struct_energy_t2',",
  "adjacency='Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Glutspeicher (SIZE12).', special='—', hotbuild=('Bau', 'W'), icon='struct_energy_t2',")
R("kitbash='Kessel ×1,3 mit 2 Schloten, 2 Tech-Streifen.')", "kitbash='Kessel auf 6×6 (Maßstab 3,0, Höhe ×1,2) mit 2 Schloten, 2 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.')")
R("adjacency='Fabriken −15,6 % Energy-Verbrauch.', special='—', hotbuild=('Bau', 'W'), icon='struct_energy_t3',",
  "adjacency='Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Glutspeicher (SIZE16).', special='—', hotbuild=('Bau', 'W'), icon='struct_energy_t3',")
R("kitbash='Kessel ×1,7 mit 3 Schloten, 3 Tech-Streifen.')", "kitbash='Kessel auf 8×8 (Maßstab 4,0, Höhe ×1,4) mit 3 Schloten, 3 Tech-Streifen; füllt ≥ 70 % der Footprint-Kante.')")
# --- Hydro
R("roleDe='Hydro-Kraftwerk', roleEn='Hydrocarbon Plant'", "roleDe='Dampfkraftwerk', roleEn='Geothermal Plant'")
R("adjacency='Wie Glutkessel II (Fabriken −12,5 % Energy).',", "adjacency='Wie Glutkessel II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Glutspeicher (SIZE12).',")
# --- Storage
R("special='Keine Death-Weapon.', hotbuild=('Bau', 'R (1×)'), icon='struct_mstore_t1',", "special='Keine Death-Weapon.', hotbuild=('Bau', 'R'), icon='struct_mstore_t1',")
R("adjacency='+25 % Produktion je angrenzendem Glutkessel I (FA-Relation 2×2).',\n  special='—', hotbuild=('Bau', 'R (2×)'), icon='struct_estore_t1',\n  parts=P('hull@sockel boiler:team boiler'),\n  kitbash='Zwei gestapelte runde Kessel (Energy = rund), flach, kein Schlot.')",
  "adjacency='Bufft alle angrenzenden Energieproduzenten (FA-Relation): Glutkessel I +25 % (SIZE4), Glutkessel II und Dampfquelle +8,3 % (SIZE12), Glutkessel III +6,25 % (SIZE16).',\n  special='—', hotbuild=('Bau', 'T'), icon='struct_estore_t1',\n  parts=P('hull@sockel boiler:team@trommel_stehend boiler@trommel_stehend'),\n  kitbash='Zwei stehende, flache Trommeln (Ø 0,8 × Kante, Höhe ≤ 0,3 × Kante; Energy = rund), kein liegender Kessel, kein Schlot.')")
# --- PD
R("weapons=[W('core:wpn_bolt_cannon_t1', 'Glockenkanone (Turm)', 45, 0.3, 26, 'linear', mv=35)],",
  "weapons=[W('core:wpn_bolt_cannon_t1', 'Glockenkanone (Turm)', 50, 0.3, 26, 'linear', mv=35)],")
# --- AA
R("U(id='core:str_t1_aa', de='Rost I', en='Grate I', roleDe='Flakturm', roleEn='AA Tower',",
  "U(id='core:str_t1_aa', de='Rost I', en='Grate I', roleDe='Flugabwehrturm', roleEn='AA Tower',")
R("weapons=[W('core:wpn_grate_aa_t1', 'Zwillings-Flugabwehr', 16, 0.5, 42,", "weapons=[W('core:wpn_grate_aa_t1', 'Zwillings-Flugabwehr', 20, 0.6, 42,")
R("parts=P('hull@sockel grate*yaw barrel barrel'),", "parts=P('hull@sockel grate:team*yaw barrel barrel'),")
R("parts=P('hull@sockel grate*yaw barrel barrel barrel hull@schuerze'),", "parts=P('hull@sockel grate:team*yaw barrel barrel barrel hull@schuerze'),")
R("visual='v_aa_struct', ms='MS8', msNote='Mechanik (homing, K11) + Test-Szenario in MS8 laut B5; baubar erst mit Meister (MS13)',\n  ms9=False,",
  "visual='v_aa_struct', ms='MS8', msNote='MS8 per Konsole/Test-Szenario gespawnt (B5: homing, K11), baubar ab MS13 (Meister)',\n  ms9=True,")
R("weapons=[W('core:wpn_high_grate_sam_t3', 'Glutraketen-Flugabwehr', 170, 1.0, 58, 'homing + Näherungszünder', salvo=2,",
  "weapons=[W('core:wpn_high_grate_sam_t3', 'Glutraketen-Flugabwehr', 200, 3.5, 58, 'homing + Näherungszünder', salvo=6,")
R("parts=P('hull@sockel grate*yaw barrel barrel barrel barrel stack'),\n  kitbash='Rost ×1,7 mit doppelt so vielen, dickeren Rohren (4), Schlot, 3 Tech-Streifen.')",
  "parts=P('hull@sockel grate:team*yaw barrel barrel barrel barrel'),\n  kitbash='Rost auf 2×2 mit doppelt so vielen, dickeren Rohren (4), 3 Tech-Streifen; kein Schlot (Glut-Monopol).')")
# --- Radar
R("mass=80, energy=720, bt=80, hp=11, footprint=[2, 2], vision=20, radar=116,", "mass=80, energy=720, bt=80, bp=13, hp=11, footprint=[2, 2], vision=20, radar=116,")
R("parts=P('hull@sockel mast ring:team*yaw@gekippte_scheibe'),\n  kitbash='Hoher dünner Mast mit gekippter Scheibe (Ring), rotierend.')",
  "parts=P('hull@sockel mast wing:team*yaw@radarplatte'),\n  kitbash='Hoher dünner Mast mit rechteckiger Radarplatte (wing-Prisma 1,6 × 0,8 × 0,1 WU, 35° gekippt), rotierend; kein Ring (Ring = Flow/Schild).')")
R("mass=180, energy=3600, bt=780, hp=55, footprint=[2, 2], vision=24, radar=200,", "mass=180, energy=3600, bt=780, bp=20, hp=55, footprint=[2, 2], vision=24, radar=200,")
R("parts=P('hull@sockel mast mast ring:team*yaw@gekippte_scheibe'),\n  kitbash='Horcher ×1,3 mit Doppelmast, 2 Tech-Streifen.')",
  "parts=P('hull@sockel mast mast wing:team*yaw@radarplatte'),\n  kitbash='Horcher auf 2×2 (Höhe ×1,2) mit Doppelmast, 2 Tech-Streifen.')")
R("eco=dict(upkeepEnergyPerSec=1000), weapons=[], toggles=['radar (MS10, C17)'], upgradeFrom='core:str_t2_radar',\n  special='Kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation.',",
  "eco=dict(upkeepEnergyPerSec=400), weapons=[], toggles=['radar (MS10, C17)'], upgradeFrom='core:str_t2_radar',\n  special='Kein Omni (I4/I5 Post-MVP) ⇒ Kosten und Reichweite gegenüber FA halbiert, HP/Mass in Relation. Unterhalt 400 E/s (FA 2.000 mit Omni): r350 bringt auf 256–512-WU-Karten nur begrenzt mehr als Horcher II.',")
R("parts=P('hull@sockel mast mast ring:team*yaw@gekippte_scheibe ring@zweite_scheibe stack'),\n  kitbash='Horcher ×1,7 mit zweiter Scheibe und Schlot, 3 Tech-Streifen.')",
  "parts=P('hull@sockel mast mast wing:team*yaw@radarplatte wing@zweite_platte'),\n  kitbash='Horcher auf 2×2 (Höhe ×1,4) mit zweiter Radarplatte, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')")
R("msNote='Rest I3 (T3-Radar) in MS13 – in faction.md noch nicht enthalten'", "msNote='Rest I3 (T3-Radar) in MS13'")
# --- Shields
R("mass=600, energy=6000, bt=1150, hp=280, footprint=[6, 6], vision=20,\n  shield=dict(hp=9000, radius=24, regenPerSec=110, rechargeS=25, upkeepEnergyPerSec=200),",
  "mass=600, energy=6000, bt=1150, bp=20, hp=280, footprint=[6, 6], vision=20,\n  shield=dict(hp=9000, radius=24, regenPerSec=110, regenStartS=3, rechargeS=25, upkeepEnergyPerSec=200),")
R("kitbash='Mast mit waagerechtem Ring, Generator-Kessel am Fuß.')", "kitbash='Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), Generator-Kessel am Fuß.')")
R("shield=dict(hp=17000, radius=40, regenPerSec=130, rechargeS=25, upkeepEnergyPerSec=400),",
  "shield=dict(hp=17000, radius=40, regenPerSec=130, regenStartS=1, rechargeS=25, upkeepEnergyPerSec=400),")
R("parts=P('hull@sockel boiler mast ring:team*yaw@waagerecht ring@zweiter_ring stack hull@schuerze'),\n  kitbash='Schirm ×1,7 mit zweitem Ring und Schlot, 3 Tech-Streifen.')",
  "parts=P('hull@sockel boiler mast ring:team*yaw@waagerecht ring@zweiter_ring hull@schuerze'),\n  kitbash='Schirm auf 6×6 (Höhe ×1,4/1,2) mit zweitem Ring und Schürze, 3 Tech-Streifen; kein Schlot (Glut-Monopol).')")
# --- Tiegel
R("weapons=[W('core:wpn_crucible_shell_t2', 'Tiegelgranate', 1800, 19.0, 110, 'ballistisch', minr=50, splash=3.5, mv=26)],",
  "weapons=[W('core:wpn_crucible_shell_t2', 'Tiegelgranate', 2100, 22.0, 110, 'ballistisch', minr=50, splash=3, mv=26)],")
# --- Hochofen
R("tech=3, group='arty', visual='v_arty_struct3',", "tech=3, group='arty', visual='v_arty_struct',")
R("mass=20000, energy=320000, bt=30000, hp=4200, footprint=[8, 8], vision=28,\n  weapons=[W('core:wpn_furnace_shell_t3', 'Hochofengranate', 1600, 10.0, 200, 'ballistisch', minr=60, splash=5, mv=55)],\n  special='FA-Referenz: Reichweite 825, 72.000 Mass. Hier Reichweite 200 (Gate ≤ 40 % der kleinsten Kartendiagonale ⇒ '\n          'Kartenpool ≥ 354 WU) und Kosten ≈ 28 %; DPS/Mass und HP/Mass bleiben in Relation.',",
  "mass=48000, energy=900000, bt=76700, hp=10000, footprint=[8, 8], vision=28,\n  weapons=[W('core:wpn_furnace_shell_t3', 'Hochofengranate', 5500, 15.0, 200, 'ballistisch', minr=60, splash=6, mv=55)],\n  special='FA-Referenz: Reichweite 825, 72.000 Mass, 5.500 Schaden alle 10 s. Hier Reichweite 200 (Gate ≤ 40 % der kleinsten Kartendiagonale ⇒ '\n          'Kartenpool ≥ 354 WU), Kosten ≈ 67 %, gleicher Einzelschuss (Burst gegen Schilde: Schirm III fällt nach 5 Schüssen/60 s), Feuerrate ×2/3; '\n          'DPS/Mass und HP/Mass bleiben in Relation.',")
R("parts=P('hull@sockel stack:team@hochofen barrel*pitch@steilrohr boom*yaw@lafette hull@gegengewicht stack stack'),\n  kitbash='Großer Schlot (Hochofen) mit steilem Langrohr, zwei Nebenschlote, 3 Tech-Streifen.')",
  "parts=P('hull@sockel boom*yaw@lafette ladle:team*pitch@kelle barrel@steilrohr hull@gegengewicht'),\n  kitbash='Tiegel-Silhouette auf 8×8: Lafette, Kelle Ø 3,0 WU (Team), Steilrohr 7 WU × Ø 0,6 aus der Kelle (an die Kelle geparentet), Gegengewicht; kein Schlot, 3 Tech-Streifen.')")
open('gen.py', 'w').write(S)
print('ok')
