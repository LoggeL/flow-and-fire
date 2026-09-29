#!/usr/bin/env python3
"""Erzeugt assets/strategic-icons.js (aus content/icons/svg, Quelle grammar.ts via `pnpm models`) und assets/roster-data.js (aus docs/design/roster.json).
Aufruf aus dem Repo-Root: python3 docs/design/ui-mockups/tools/gen-data.py"""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parents[4]
src = root / 'content/icons/svg'
out = {}
for p in sorted((src / 'icons').glob('*.svg')):
    name = p.name[:-4]
    if name.endswith('.selected'):
        continue
    svg = p.read_text().strip()
    svg = re.sub(r'<title>.*?</title>', '', svg)
    out[name] = svg
for p in sorted((src / 'states').glob('*.svg')):
    out[p.name[:-4]] = re.sub(r'<title>.*?</title>', '', p.read_text().strip())
dst = pathlib.Path(__file__).resolve().parents[1] / 'assets/strategic-icons.js'
dst.write_text('/* generiert von tools/gen-data.py aus content/icons/svg – nicht von Hand ändern */\n'
               'window.FF_ICONS = ' + json.dumps(out, ensure_ascii=False, indent=0) + ';\n')
print(len(out), 'Icons ->', dst)

# Roster-Auszug für Tooltips/Command Card (Quelle: docs/design/roster.json)
roster = json.loads((root / 'docs/design/roster.json').read_text())
units = {}
for u in roster['units']:
    e = u['economy']; w = u.get('weapons') or []
    sp = u.get('special') or {}
    units[u['id']] = {
        'name': u['name'], 'role': u['role'], 'tech': u['tech'], 'group': u['group'], 'icon': u['icon'],
        'mass': e.get('mass'), 'energy': e.get('energy'), 'bt': e.get('buildTime'), 'bp': e.get('buildPower'),
        'massPerSec': e.get('massPerSec'), 'energyPerSec': e.get('energyPerSec'),
        'upkeep': e.get('upkeepEnergyPerSec'), 'storageMass': e.get('storageMass'), 'storageEnergy': e.get('storageEnergy'),
        'hp': u['health']['max'], 'regen': u['health'].get('regenPerSec'),
        'weapons': [{'type': x.get('type'), 'dps': x.get('dps'), 'range': x.get('range'), 'rangeMin': x.get('rangeMin'),
                     'layers': x.get('layers')} for x in w],
        'speed': (u.get('motion') or {}).get('speed'), 'vision': (u.get('intel') or {}).get('vision'),
        'radar': (u.get('intel') or {}).get('radar'),
        'hotbuild': u.get('hotbuild'), 'adjacency': sp.get('adjacency'), 'upgradesTo': sp.get('upgradesTo'),
        'upgradeFrom': sp.get('upgradeFrom'), 'ms9': u.get('ms9Core'), 'buildableBy': u.get('buildableBy'),
        'msFirst': u.get('msFirst'),
    }
dst2 = pathlib.Path(__file__).resolve().parents[1] / 'assets/roster-data.js'
dst2.write_text('/* generiert von tools/gen-data.py aus docs/design/roster.json – nicht von Hand ändern */\n'
                'window.FF_ROSTER = ' + json.dumps({'units': units, 'hotbuildGrid': roster['hotbuildGrid']},
                                                  ensure_ascii=False, indent=0) + ';\n')
print(len(units), 'Einheiten ->', dst2)
