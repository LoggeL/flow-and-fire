/* generiert von tools/gen-data.py aus docs/design/roster.json – nicht von Hand ändern */
window.FF_ROSTER = {
"units": {
"core:cmd_commander": {
"name": {
"de": "Vogt",
"en": "Reeve"
},
"role": {
"de": "Kommandant",
"en": "Commander"
},
"tech": 0,
"group": "cmd",
"icon": "cmd_commander",
"mass": 2000,
"energy": 5000000,
"bt": 6000000,
"bp": 10,
"massPerSec": 1,
"energyPerSec": 20,
"upkeep": null,
"storageMass": 650,
"storageEnergy": 3900,
"hp": 12000,
"regen": 10,
"weapons": [
{
"type": "Direktfeuer-Kanone",
"dps": 100.0,
"range": 22,
"rangeMin": 1,
"layers": [
"land"
]
},
{
"type": "Abstich (Overcharge, manuell/auto)",
"dps": 4545.45,
"range": 22,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 1.7,
"vision": 26,
"radar": null,
"hotbuild": null,
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t1_engineer": {
"name": {
"de": "Lehrling",
"en": "Prentice"
},
"role": {
"de": "Ingenieur",
"en": "Engineer"
},
"tech": 1,
"group": "cmd",
"icon": "eng_build_t1",
"mass": 52,
"energy": 260,
"bt": 260,
"bp": 5,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 160,
"regen": null,
"weapons": [],
"speed": 1.9,
"vision": 18,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "E"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t2_engineer": {
"name": {
"de": "Geselle",
"en": "Journeyman"
},
"role": {
"de": "Ingenieur",
"en": "Engineer"
},
"tech": 2,
"group": "cmd",
"icon": "eng_build_t2",
"mass": 130,
"energy": 650,
"bt": 650,
"bp": 13,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 420,
"regen": null,
"weapons": [],
"speed": 1.9,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "E"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t3_engineer": {
"name": {
"de": "Meister",
"en": "Master"
},
"role": {
"de": "Ingenieur",
"en": "Engineer"
},
"tech": 3,
"group": "cmd",
"icon": "eng_build_t3",
"mass": 310,
"energy": 1550,
"bt": 1550,
"bp": 32,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 840,
"regen": null,
"weapons": [],
"speed": 1.9,
"vision": 26,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "E"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:lnd_t1_scout": {
"name": {
"de": "Funke",
"en": "Spark"
},
"role": {
"de": "Späher",
"en": "Scout"
},
"tech": 1,
"group": "land",
"icon": "land_intel_t1",
"mass": 12,
"energy": 80,
"bt": 60,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 32,
"regen": null,
"weapons": [
{
"type": "Rumpf-MG (fester Bugwinkel 90°)",
"dps": 2.0,
"range": 22,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 4.5,
"vision": 26,
"radar": 40,
"hotbuild": {
"menu": "Landwerk",
"slot": "A"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t1_bot": {
"name": {
"de": "Stichel",
"en": "Graver"
},
"role": {
"de": "Leichter Sturmläufer",
"en": "Light Assault Bot"
},
"tech": 1,
"group": "land",
"icon": "land_bot_t1",
"mass": 32,
"energy": 130,
"bt": 130,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 70,
"regen": null,
"weapons": [
{
"type": "Schnellfeuer-MG",
"dps": 23.33,
"range": 14,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 4.3,
"vision": 18,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "S"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t1_tank": {
"name": {
"de": "Punze",
"en": "Punch"
},
"role": {
"de": "Kampfpanzer",
"en": "Battle Tank"
},
"tech": 1,
"group": "land",
"icon": "land_direct_t1",
"mass": 56,
"energy": 280,
"bt": 300,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 300,
"regen": null,
"weapons": [
{
"type": "Glockenkanone",
"dps": 23.33,
"range": 18,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 3.3,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "Q"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t1_arty": {
"name": {
"de": "Kelle",
"en": "Ladle"
},
"role": {
"de": "Mobile Artillerie",
"en": "Mobile Artillery"
},
"tech": 1,
"group": "land",
"icon": "land_arty_t1",
"mass": 36,
"energy": 180,
"bt": 200,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 210,
"regen": null,
"weapons": [
{
"type": "Schlackenmörser",
"dps": 11.11,
"range": 30,
"rangeMin": 6,
"layers": [
"land"
]
}
],
"speed": 2.7,
"vision": 18,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "W"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t1_aa": {
"name": {
"de": "Sieb",
"en": "Sieve"
},
"role": {
"de": "Mobile Flugabwehr",
"en": "Mobile AA"
},
"tech": 1,
"group": "land",
"icon": "land_aa_t1",
"mass": 55,
"energy": 275,
"bt": 220,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 310,
"regen": null,
"weapons": [
{
"type": "Zwillings-Flugabwehrkanone",
"dps": 28.0,
"range": 30,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 3.3,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "R"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t2_tank": {
"name": {
"de": "Meißel",
"en": "Chisel"
},
"role": {
"de": "Schwerer Panzer",
"en": "Heavy Tank"
},
"tech": 2,
"group": "land",
"icon": "land_direct_t2",
"mass": 200,
"energy": 1000,
"bt": 900,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 1600,
"regen": null,
"weapons": [
{
"type": "Doppel-Glockenkanone",
"dps": 53.85,
"range": 22,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 2.9,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "Q"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t2_mml": {
"name": {
"de": "Rinne",
"en": "Runner"
},
"role": {
"de": "Raketenwerfer",
"en": "Missile Launcher"
},
"tech": 2,
"group": "land",
"icon": "land_mml_t2",
"mass": 180,
"energy": 1300,
"bt": 800,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 780,
"regen": null,
"weapons": [
{
"type": "Glutraketen (2er-Salve)",
"dps": 60.0,
"range": 60,
"rangeMin": 12,
"layers": [
"land"
]
}
],
"speed": 2.8,
"vision": 18,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "W"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t2_aa": {
"name": {
"de": "Rüttelsieb",
"en": "Riddle"
},
"role": {
"de": "Flak",
"en": "Flak"
},
"tech": 2,
"group": "land",
"icon": "land_aa_t2",
"mass": 160,
"energy": 800,
"bt": 800,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 1050,
"regen": null,
"weapons": [
{
"type": "Splitterflak",
"dps": 140.0,
"range": 38,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 3.0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "R"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:lnd_t2_shield": {
"name": {
"de": "Schürze",
"en": "Apron"
},
"role": {
"de": "Mobiler Schild",
"en": "Mobile Shield"
},
"tech": 2,
"group": "land",
"icon": "land_shield_t2",
"mass": 220,
"energy": 950,
"bt": 700,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 160,
"regen": null,
"weapons": [],
"speed": 3.4,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "D"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:lnd_t2_bot": {
"name": {
"de": "Zange",
"en": "Tongs"
},
"role": {
"de": "Sturmläufer",
"en": "Assault Bot"
},
"tech": 2,
"group": "land",
"icon": "land_bot_t2",
"mass": 190,
"energy": 950,
"bt": 950,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 650,
"regen": null,
"weapons": [
{
"type": "Glut-Gatling",
"dps": 66.67,
"range": 30,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 3.2,
"vision": 24,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "S"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:lnd_t3_bot": {
"name": {
"de": "Fallhammer",
"en": "Drophammer"
},
"role": {
"de": "Belagerungsläufer",
"en": "Siege Bot"
},
"tech": 3,
"group": "land",
"icon": "land_bot_t3",
"mass": 500,
"energy": 5000,
"bt": 2500,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 3200,
"regen": null,
"weapons": [
{
"type": "Doppel-Glocke, schwer",
"dps": 150.0,
"range": 24,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 3.3,
"vision": 22,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "S"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:lnd_t3_arty": {
"name": {
"de": "Pfanne",
"en": "Pour Pan"
},
"role": {
"de": "Schwere Artillerie",
"en": "Heavy Artillery"
},
"tech": 3,
"group": "land",
"icon": "land_arty_t3",
"mass": 800,
"energy": 8000,
"bt": 4300,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 1000,
"regen": null,
"weapons": [
{
"type": "Gießgranate",
"dps": 70.0,
"range": 85,
"rangeMin": 25,
"layers": [
"land"
]
}
],
"speed": 2.2,
"vision": 26,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "W"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:lnd_t3_sniper": {
"name": {
"de": "Reißnadel",
"en": "Scriber"
},
"role": {
"de": "Präzisionsläufer",
"en": "Sniper Bot"
},
"tech": 3,
"group": "land",
"icon": "land_sniper_t3",
"mass": 720,
"energy": 20000,
"bt": 4800,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 560,
"regen": null,
"weapons": [
{
"type": "Langrohr-Präzisionskanone",
"dps": 142.86,
"range": 58,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 2.4,
"vision": 26,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "F"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:lnd_t3_aa": {
"name": {
"de": "Trommelsieb",
"en": "Trommel"
},
"role": {
"de": "Schwere Flugabwehr",
"en": "Heavy AA"
},
"tech": 3,
"group": "land",
"icon": "land_aa_t3",
"mass": 600,
"energy": 7000,
"bt": 3000,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 2000,
"regen": null,
"weapons": [
{
"type": "Trommel-Flugabwehrkanone",
"dps": 210.0,
"range": 55,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 3.3,
"vision": 26,
"radar": null,
"hotbuild": {
"menu": "Landwerk",
"slot": "R"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:air_t1_scout": {
"name": {
"de": "Lerche",
"en": "Lark"
},
"role": {
"de": "Aufklärer",
"en": "Air Scout"
},
"tech": 1,
"group": "air",
"icon": "air_intel_t1",
"mass": 40,
"energy": 560,
"bt": 200,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 40,
"regen": null,
"weapons": [],
"speed": 18,
"vision": 40,
"radar": 60,
"hotbuild": {
"menu": "Luftwerk",
"slot": "A"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:air_t1_fighter": {
"name": {
"de": "Turmfalke",
"en": "Kestrel"
},
"role": {
"de": "Abfangjäger",
"en": "Interceptor"
},
"tech": 1,
"group": "air",
"icon": "air_aa_t1",
"mass": 50,
"energy": 2200,
"bt": 500,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 280,
"regen": null,
"weapons": [
{
"type": "Zwillings-Luftkanone",
"dps": 50.0,
"range": 25,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 15,
"vision": 28,
"radar": null,
"hotbuild": {
"menu": "Luftwerk",
"slot": "Q"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:air_t1_bomber": {
"name": {
"de": "Dohle",
"en": "Jackdaw"
},
"role": {
"de": "Bomber",
"en": "Bomber"
},
"tech": 1,
"group": "air",
"icon": "air_bomb_t1",
"mass": 90,
"energy": 2000,
"bt": 500,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 230,
"regen": null,
"weapons": [
{
"type": "Schlackenbomben (4er-Reihe)",
"dps": 68.0,
"range": 40,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 10,
"vision": 32,
"radar": 40,
"hotbuild": {
"menu": "Luftwerk",
"slot": "W"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:air_t2_gunship": {
"name": {
"de": "Krähe",
"en": "Crow"
},
"role": {
"de": "Kampfschweber",
"en": "Gunship"
},
"tech": 2,
"group": "air",
"icon": "air_direct_t2",
"mass": 200,
"energy": 3800,
"bt": 1300,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 760,
"regen": null,
"weapons": [
{
"type": "Bauch-Glocke",
"dps": 53.33,
"range": 22,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 12,
"vision": 32,
"radar": null,
"hotbuild": {
"menu": "Luftwerk",
"slot": "E"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:air_t2_fbomber": {
"name": {
"de": "Elster",
"en": "Magpie"
},
"role": {
"de": "Jagdbomber",
"en": "Fighter-Bomber"
},
"tech": 2,
"group": "air",
"icon": "air_fbomb_t2",
"mass": 340,
"energy": 11000,
"bt": 2600,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 1150,
"regen": null,
"weapons": [
{
"type": "Luftkanone",
"dps": 70.0,
"range": 30,
"rangeMin": null,
"layers": [
"air"
]
},
{
"type": "Schlackenbomben (2er)",
"dps": 144.0,
"range": 50,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 15,
"vision": 32,
"radar": 60,
"hotbuild": {
"menu": "Luftwerk",
"slot": "R"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:str_t1_mex": {
"name": {
"de": "Zapfstelle I",
"en": "Tap I"
},
"role": {
"de": "Massebohrung",
"en": "Mass Extractor"
},
"tech": 1,
"group": "eco",
"icon": "struct_mass_t1",
"mass": 36,
"energy": 360,
"bt": 60,
"bp": 10,
"massPerSec": 2,
"energyPerSec": null,
"upkeep": 2,
"storageMass": null,
"storageEnergy": null,
"hp": 420,
"regen": null,
"weapons": [],
"speed": 0,
"vision": null,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Q"
},
"adjacency": "Gibt Fabriken −7,5 % Mass-Verbrauch (8×8); erhält +12,5 % je angrenzendem Erzspeicher.",
"upgradesTo": "core:str_t2_mex",
"upgradeFrom": null,
"ms9": true
},
"core:str_t2_mex": {
"name": {
"de": "Zapfstelle II",
"en": "Tap II"
},
"role": {
"de": "Massebohrung",
"en": "Mass Extractor"
},
"tech": 2,
"group": "eco",
"icon": "struct_mass_t2",
"mass": 900,
"energy": 5400,
"bt": 900,
"bp": 15,
"massPerSec": 6,
"energyPerSec": null,
"upkeep": 9,
"storageMass": null,
"storageEnergy": null,
"hp": 2100,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Q (Upgrade: Command Card)"
},
"adjacency": "Fabriken −10 % Mass-Verbrauch; +12,5 % je Erzspeicher.",
"upgradesTo": "core:str_t3_mex",
"upgradeFrom": "core:str_t1_mex",
"ms9": true
},
"core:str_t3_mex": {
"name": {
"de": "Zapfstelle III",
"en": "Tap III"
},
"role": {
"de": "Massebohrung",
"en": "Mass Extractor"
},
"tech": 3,
"group": "eco",
"icon": "struct_mass_t3",
"mass": 4500,
"energy": 31000,
"bt": 2900,
"bp": null,
"massPerSec": 18,
"energyPerSec": null,
"upkeep": 54,
"storageMass": null,
"storageEnergy": null,
"hp": 7000,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Q (Upgrade: Command Card)"
},
"adjacency": "Fabriken −12,5 % Mass-Verbrauch; +12,5 % je Erzspeicher.",
"upgradesTo": null,
"upgradeFrom": "core:str_t2_mex",
"ms9": false
},
"core:str_t1_pgen": {
"name": {
"de": "Glutkessel I",
"en": "Ember Boiler I"
},
"role": {
"de": "Kraftwerk",
"en": "Power Generator"
},
"tech": 1,
"group": "eco",
"icon": "struct_energy_t1",
"mass": 75,
"energy": 750,
"bt": 125,
"bp": null,
"massPerSec": null,
"energyPerSec": 20,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 620,
"regen": null,
"weapons": [],
"speed": 0,
"vision": null,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "W"
},
"adjacency": "Fabriken (8×8) −1,56 % Energy-Verbrauch, 2×2-Verbraucher −6,25 %; erhält +25 % Produktion je angrenzendem Glutspeicher (SIZE4).",
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t2_pgen": {
"name": {
"de": "Glutkessel II",
"en": "Ember Boiler II"
},
"role": {
"de": "Kraftwerk",
"en": "Power Generator"
},
"tech": 2,
"group": "eco",
"icon": "struct_energy_t2",
"mass": 1200,
"energy": 12000,
"bt": 2200,
"bp": null,
"massPerSec": null,
"energyPerSec": 500,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 2600,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "W"
},
"adjacency": "Fabriken −12,5 % Energy-Verbrauch; erhält +8,3 % Produktion je angrenzendem Glutspeicher (SIZE12).",
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t3_pgen": {
"name": {
"de": "Glutkessel III",
"en": "Ember Boiler III"
},
"role": {
"de": "Kraftwerk",
"en": "Power Generator"
},
"tech": 3,
"group": "eco",
"icon": "struct_energy_t3",
"mass": 3200,
"energy": 57000,
"bt": 6800,
"bp": null,
"massPerSec": null,
"energyPerSec": 2500,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 9000,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "W"
},
"adjacency": "Fabriken −15,6 % Energy-Verbrauch; erhält +6,25 % Produktion je angrenzendem Glutspeicher (SIZE16).",
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:str_t1_hydro": {
"name": {
"de": "Dampfquelle",
"en": "Vent Cap"
},
"role": {
"de": "Dampfkraftwerk",
"en": "Geothermal Plant"
},
"tech": 1,
"group": "eco",
"icon": "struct_hydro_t1",
"mass": 160,
"energy": 800,
"bt": 400,
"bp": null,
"massPerSec": null,
"energyPerSec": 100,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 1800,
"regen": null,
"weapons": [],
"speed": 0,
"vision": null,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "E"
},
"adjacency": "Wie Glutkessel II (Fabriken −12,5 % Energy); erhält +8,3 % je angrenzendem Glutspeicher (SIZE12).",
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t1_mstore": {
"name": {
"de": "Erzspeicher",
"en": "Ore Silo"
},
"role": {
"de": "Massespeicher",
"en": "Mass Storage"
},
"tech": 1,
"group": "eco",
"icon": "struct_mstore_t1",
"mass": 200,
"energy": 1500,
"bt": 250,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": 500,
"storageEnergy": null,
"hp": 850,
"regen": null,
"weapons": [],
"speed": 0,
"vision": null,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "R"
},
"adjacency": "+12,5 % Produktion je angrenzender Zapfstelle (FA-Relation, max. 4 Seiten = +50 %).",
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t1_estore": {
"name": {
"de": "Glutspeicher",
"en": "Heat Bank"
},
"role": {
"de": "Energiespeicher",
"en": "Energy Storage"
},
"tech": 1,
"group": "eco",
"icon": "struct_estore_t1",
"mass": 250,
"energy": 1200,
"bt": 200,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": 10000,
"hp": 520,
"regen": null,
"weapons": [],
"speed": 0,
"vision": null,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "T"
},
"adjacency": "Bufft alle angrenzenden Energieproduzenten (FA-Relation): Glutkessel I +25 % (SIZE4), Glutkessel II und Dampfquelle +8,3 % (SIZE12), Glutkessel III +6,25 % (SIZE16).",
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t1_fac_land": {
"name": {
"de": "Landwerk I",
"en": "Land Works I"
},
"role": {
"de": "Landfabrik",
"en": "Land Factory"
},
"tech": 1,
"group": "fac",
"icon": "struct_fac_land_t1",
"mass": 240,
"energy": 2100,
"bt": 300,
"bp": 20,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": 80,
"storageEnergy": null,
"hp": 4200,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "A"
},
"adjacency": "Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).",
"upgradesTo": "core:str_t2_fac_land",
"upgradeFrom": null,
"ms9": true
},
"core:str_t2_fac_land": {
"name": {
"de": "Landwerk II",
"en": "Land Works II"
},
"role": {
"de": "Landfabrik",
"en": "Land Factory"
},
"tech": 2,
"group": "fac",
"icon": "struct_fac_land_t2",
"mass": 1400,
"energy": 11000,
"bt": 2300,
"bp": 40,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": 160,
"storageEnergy": null,
"hp": 8200,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Upgrade (Command Card)"
},
"adjacency": "Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).",
"upgradesTo": "core:str_t3_fac_land",
"upgradeFrom": "core:str_t1_fac_land",
"ms9": true
},
"core:str_t3_fac_land": {
"name": {
"de": "Landwerk III",
"en": "Land Works III"
},
"role": {
"de": "Landfabrik",
"en": "Land Factory"
},
"tech": 3,
"group": "fac",
"icon": "struct_fac_land_t3",
"mass": 5200,
"energy": 47000,
"bt": 12000,
"bp": 90,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": 320,
"storageEnergy": null,
"hp": 16000,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Upgrade (Command Card)"
},
"adjacency": "Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).",
"upgradesTo": null,
"upgradeFrom": "core:str_t2_fac_land",
"ms9": false
},
"core:str_t1_fac_air": {
"name": {
"de": "Luftwerk I",
"en": "Air Works I"
},
"role": {
"de": "Luftfabrik",
"en": "Air Factory"
},
"tech": 1,
"group": "fac",
"icon": "struct_fac_air_t1",
"mass": 210,
"energy": 2400,
"bt": 300,
"bp": 20,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": 80,
"storageEnergy": null,
"hp": 4200,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "S"
},
"adjacency": "Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).",
"upgradesTo": "core:str_t2_fac_air",
"upgradeFrom": null,
"ms9": false
},
"core:str_t2_fac_air": {
"name": {
"de": "Luftwerk II",
"en": "Air Works II"
},
"role": {
"de": "Luftfabrik",
"en": "Air Factory"
},
"tech": 2,
"group": "fac",
"icon": "struct_fac_air_t2",
"mass": 920,
"energy": 17500,
"bt": 2300,
"bp": 40,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": 160,
"storageEnergy": null,
"hp": 8200,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Upgrade (Command Card)"
},
"adjacency": "Empfängt Adjacency von Zapfstellen (Mass) und Kraftwerken (Energy).",
"upgradesTo": null,
"upgradeFrom": "core:str_t1_fac_air",
"ms9": false
},
"core:str_t1_pd": {
"name": {
"de": "Riegel I",
"en": "Bolt I"
},
"role": {
"de": "Punktverteidigung",
"en": "Point Defense"
},
"tech": 1,
"group": "def",
"icon": "struct_direct_t1",
"mass": 240,
"energy": 2000,
"bt": 250,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 1350,
"regen": null,
"weapons": [
{
"type": "Glockenkanone (Turm)",
"dps": 166.67,
"range": 26,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 0,
"vision": 24,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Z"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t2_pd": {
"name": {
"de": "Riegel II",
"en": "Bolt II"
},
"role": {
"de": "Punktverteidigung",
"en": "Point Defense"
},
"tech": 2,
"group": "def",
"icon": "struct_direct_t2",
"mass": 520,
"energy": 3700,
"bt": 700,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 2400,
"regen": null,
"weapons": [
{
"type": "Doppel-Glockenkanone (Turm)",
"dps": 125.0,
"range": 48,
"rangeMin": null,
"layers": [
"land"
]
}
],
"speed": 0,
"vision": 28,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Z"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t1_aa": {
"name": {
"de": "Rost I",
"en": "Grate I"
},
"role": {
"de": "Flugabwehrturm",
"en": "AA Tower"
},
"tech": 1,
"group": "def",
"icon": "struct_aa_t1",
"mass": 150,
"energy": 1500,
"bt": 190,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 820,
"regen": null,
"weapons": [
{
"type": "Zwillings-Flugabwehr",
"dps": 66.67,
"range": 42,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 0,
"vision": 24,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "X"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t2_aa": {
"name": {
"de": "Rost II",
"en": "Grate II"
},
"role": {
"de": "Flakturm",
"en": "Flak Tower"
},
"tech": 2,
"group": "def",
"icon": "struct_aa_t2",
"mass": 400,
"energy": 4000,
"bt": 550,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 2600,
"regen": null,
"weapons": [
{
"type": "Splitterflak (Turm)",
"dps": 180.0,
"range": 48,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 0,
"vision": 24,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "X"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t3_sam": {
"name": {
"de": "Hochrost",
"en": "High Grate"
},
"role": {
"de": "Raketenabwehr",
"en": "SAM Site"
},
"tech": 3,
"group": "def",
"icon": "struct_sam_t3",
"mass": 800,
"energy": 8000,
"bt": 1400,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 5000,
"regen": null,
"weapons": [
{
"type": "Glutraketen-Flugabwehr",
"dps": 342.86,
"range": 58,
"rangeMin": null,
"layers": [
"air"
]
}
],
"speed": 0,
"vision": 28,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "X"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t1_wall": {
"name": {
"de": "Mauer",
"en": "Wall"
},
"role": {
"de": "Mauer",
"en": "Wall"
},
"tech": 1,
"group": "def",
"icon": "wall",
"mass": 3,
"energy": 20,
"bt": 15,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 550,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 0,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "C"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": true
},
"core:str_t1_radar": {
"name": {
"de": "Horcher I",
"en": "Listener I"
},
"role": {
"de": "Radar",
"en": "Radar"
},
"tech": 1,
"group": "intel",
"icon": "struct_intel_t1",
"mass": 80,
"energy": 720,
"bt": 80,
"bp": 13,
"massPerSec": null,
"energyPerSec": null,
"upkeep": 20,
"storageMass": null,
"storageEnergy": null,
"hp": 11,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": 116,
"hotbuild": {
"menu": "Bau",
"slot": "D"
},
"adjacency": null,
"upgradesTo": "core:str_t2_radar",
"upgradeFrom": null,
"ms9": false
},
"core:str_t2_radar": {
"name": {
"de": "Horcher II",
"en": "Listener II"
},
"role": {
"de": "Radar",
"en": "Radar"
},
"tech": 2,
"group": "intel",
"icon": "struct_intel_t2",
"mass": 180,
"energy": 3600,
"bt": 780,
"bp": 20,
"massPerSec": null,
"energyPerSec": null,
"upkeep": 150,
"storageMass": null,
"storageEnergy": null,
"hp": 55,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 24,
"radar": 200,
"hotbuild": {
"menu": "Bau",
"slot": "Upgrade (Command Card)"
},
"adjacency": null,
"upgradesTo": "core:str_t3_radar",
"upgradeFrom": "core:str_t1_radar",
"ms9": false
},
"core:str_t3_radar": {
"name": {
"de": "Horcher III",
"en": "Listener III"
},
"role": {
"de": "Radar",
"en": "Radar"
},
"tech": 3,
"group": "intel",
"icon": "struct_intel_t3",
"mass": 1200,
"energy": 16000,
"bt": 1500,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": 400,
"storageMass": null,
"storageEnergy": null,
"hp": 55,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 30,
"radar": 350,
"hotbuild": {
"menu": "Bau",
"slot": "Upgrade (Command Card)"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": "core:str_t2_radar",
"ms9": false
},
"core:str_t2_shield": {
"name": {
"de": "Schirm II",
"en": "Canopy II"
},
"role": {
"de": "Schildgenerator",
"en": "Shield Generator"
},
"tech": 2,
"group": "intel",
"icon": "struct_shield_t2",
"mass": 600,
"energy": 6000,
"bt": 1150,
"bp": 20,
"massPerSec": null,
"energyPerSec": null,
"upkeep": 200,
"storageMass": null,
"storageEnergy": null,
"hp": 280,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "F"
},
"adjacency": null,
"upgradesTo": "core:str_t3_shield",
"upgradeFrom": null,
"ms9": false
},
"core:str_t3_shield": {
"name": {
"de": "Schirm III",
"en": "Canopy III"
},
"role": {
"de": "Schildgenerator",
"en": "Shield Generator"
},
"tech": 3,
"group": "intel",
"icon": "struct_shield_t3",
"mass": 3200,
"energy": 52000,
"bt": 5000,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": 400,
"storageMass": null,
"storageEnergy": null,
"hp": 520,
"regen": null,
"weapons": [],
"speed": 0,
"vision": 20,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "Upgrade (Command Card)"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": "core:str_t2_shield",
"ms9": false
},
"core:str_t2_arty": {
"name": {
"de": "Tiegel",
"en": "Crucible"
},
"role": {
"de": "Artilleriestellung",
"en": "Artillery Emplacement"
},
"tech": 2,
"group": "arty",
"icon": "struct_arty_t2",
"mass": 1800,
"energy": 13000,
"bt": 1600,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 3600,
"regen": null,
"weapons": [
{
"type": "Tiegelgranate",
"dps": 100.0,
"range": 110,
"rangeMin": 50,
"layers": [
"land"
]
}
],
"speed": 0,
"vision": 28,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "V"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
},
"core:str_t3_arty": {
"name": {
"de": "Hochofen",
"en": "Blast Furnace"
},
"role": {
"de": "Schwere Artilleriestellung",
"en": "Heavy Artillery Emplacement"
},
"tech": 3,
"group": "arty",
"icon": "struct_arty_t3",
"mass": 48000,
"energy": 900000,
"bt": 76700,
"bp": null,
"massPerSec": null,
"energyPerSec": null,
"upkeep": null,
"storageMass": null,
"storageEnergy": null,
"hp": 10000,
"regen": null,
"weapons": [
{
"type": "Hochofengranate",
"dps": 366.67,
"range": 200,
"rangeMin": 60,
"layers": [
"land"
]
}
],
"speed": 0,
"vision": 28,
"radar": null,
"hotbuild": {
"menu": "Bau",
"slot": "V"
},
"adjacency": null,
"upgradesTo": null,
"upgradeFrom": null,
"ms9": false
}
},
"hotbuildGrid": {
"Landwerk": {
"Q": "Panzer (Punze/Meißel)",
"W": "Artillerie (Kelle/Rinne/Pfanne)",
"E": "Engineer (Lehrling/Geselle/Meister)",
"R": "Flugabwehr (Sieb/Rüttelsieb/Trommelsieb)",
"A": "Späher (Funke)",
"S": "Bots (Stichel/Zange/Fallhammer)",
"D": "Support (Schürze)",
"F": "Präzision (Reißnadel)"
},
"Luftwerk": {
"Q": "Abfangjäger (Turmfalke)",
"W": "Bomber (Dohle)",
"E": "Gunship (Krähe)",
"R": "Jagdbomber (Elster)",
"A": "Aufklärer (Lerche)"
},
"Bau": {
"Q": "Zapfstelle",
"W": "Glutkessel",
"E": "Dampfquelle",
"R": "Erzspeicher",
"T": "Glutspeicher",
"A": "Landwerk",
"S": "Luftwerk",
"D": "Horcher",
"F": "Schirm",
"Z": "Riegel",
"X": "Rost/Hochrost",
"C": "Mauer",
"V": "Tiegel/Hochofen"
},
"rule": "Gleiche Taste = gleiche Rolle über alle Tech-Stufen; mehrfaches Drücken wechselt nur die Tech-Stufe (höchste baubare zuerst). Upgrade-Stufen über das Upgrade-Kommando der Command Card. Das Bau-Menü nutzt die 5. Spalte (T), weil 13 Rollen nicht auf 12 Tasten passen."
}
};
