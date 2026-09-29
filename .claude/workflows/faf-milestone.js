export const meta = {
  name: 'faf-milestone',
  description: 'Baut einen Meilenstein von Flow & Fire (FAF): planen, implementieren (max. 2 parallel), verifizieren, reviewen, fixen, committen',
  whenToUse: 'args: {ms, extra?, plan?, skip?: [paketIds]}',
  phases: [
    { title: 'Plan', detail: 'Meilenstein in Arbeitspakete/Wellen zerlegen' },
    { title: 'Build', detail: 'Wellen umsetzen, max. 2 Agenten parallel' },
    { title: 'Verify', detail: 'Typecheck, Lint, Tests, Build bis grün' },
    { title: 'Review', detail: 'Abnahme- und Architektur-Review' },
    { title: 'Fix', detail: 'Review-Befunde beheben' },
    { title: 'Commit', detail: 'Abschluss-Report und Commit' },
  ],
}

const REPO = '/Users/logge/Documents/Projects/flow-and-fire'
const MS = args.ms
const EXTRA = args.extra || ''
const COMMON = `Projekt: Flow & Fire (FAF) — Browser-RTS nach Vorbild Supreme Commander: Forged Alliance (eigene Fraktion, keine FA-Namen/Assets).
Repo: ${REPO} (pnpm-Monorepo, Paket-Scope @faf/*). Maßgeblich: docs/PLAN.md (Architektur §2–§3, Meilenstein ${MS} in §5.2, Spikes §4), docs/DECISIONS.md (autonom getroffene Entscheidungen), docs/features.json (Feature-IDs). Falls vorhanden: docs/STATUS.md (Stand früherer Meilensteine, Abweichungen).
Regeln:
- SPEICHER: Mac ohne Swap, 48 GB. Keine speicherhungrigen Prozesse parallel. Vitest mit maxWorkers ≤ 4, Playwright workers=1, keine Dev-Server im Hintergrund liegen lassen (immer beenden).
- Kein git commit/push (macht der Commit-Schritt). Keine Rückfragen an den Nutzer — triff Entscheidungen im Sinne des Plans und dokumentiere Abweichungen in docs/STATUS.md.
- Echter, lauffähiger Code. Keine Stubs/TODO-Platzhalter für Features dieses Meilensteins. Determinismus-Vertrag (§3.1, §3.12) ist heilig: Sim-Pakete ohne Float-Mathe/Math.random/Date/Map-als-State etc.
- Code-Kommentare/Identifier englisch, Doku (docs/*) deutsch.
${EXTRA ? 'Zusatzhinweise für diesen Lauf: ' + EXTRA : ''}`

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    packages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          wave: { type: 'integer' },
          owns: { type: 'array', items: { type: 'string' } },
          task: { type: 'string' },
        },
        required: ['id', 'title', 'wave', 'owns', 'task'],
      },
    },
    acceptance: { type: 'array', items: { type: 'string' } },
    verify_commands: { type: 'array', items: { type: 'string' } },
  },
  required: ['packages', 'acceptance', 'verify_commands'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    green: { type: 'boolean' },
    report: { type: 'string' },
  },
  required: ['green', 'report'],
}
const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['hoch', 'mittel', 'niedrig'] },
          where: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'where', 'problem', 'fix'],
      },
    },
  },
  required: ['findings'],
}

phase('Plan')
const SKIP = new Set(args.skip || [])
const plan = args.plan ? args.plan : await agent(`${COMMON}

Du bist der Tech-Lead. Lies docs/PLAN.md (vollständig relevante Teile: §2, §3, §4, §5.2 ${MS}), docs/DECISIONS.md, ggf. docs/STATUS.md, und den aktuellen Repo-Stand (git log, Dateibaum, package.json-Dateien).
Zerlege ${MS} in 3–8 Arbeitspakete, angeordnet in Wellen (wave 0,1,2,…). Regeln:
- Pakete derselben Welle haben DISJUNKTE owns (Pfade/Globs, die NUR dieses Paket anlegt/ändert). Höchstens 2 Pakete pro Welle.
- Root-Konfiguration (package.json im Root, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.*, vitest.workspace, playwright.config) gehört exklusiv EINEM Paket (typisch Welle 0). Neue Pakete dürfen eigene package.json/tsconfig anlegen. Abhängigkeiten installiert jedes Paket selbst mit pnpm (Root-Lockfile-Konflikte vermeiden: in einer Welle mit 2 Paketen darf nur eines 'pnpm add' ausführen — plane Dependencies möglichst in Welle 0 vor).
- task: sehr konkrete Anweisung (Dateien, Interfaces aus PLAN §3, Tests die geschrieben werden müssen, Abnahmekriterien des Pakets, Befehle zum Selbsttest). Das implementierende Agent kennt NUR diesen Text + Repo + PLAN.md.
- Spikes/Benchmarks aus §4, die zu ${MS} gehören, als echte Benchmarks im Repo (tools/headless o.ä.) mit dokumentierten Messwerten.
- acceptance: prüfbare Abnahmekriterien für ${MS}, aus §5.2 abgeleitet, an lokale Machbarkeit angepasst (siehe DECISIONS.md: keine iGPU-Runner → lokal messen und markieren).
- verify_commands: die Befehle, mit denen am Ende alles geprüft wird (install, typecheck, lint, test, build, ggf. e2e/bench), jeweils speicherschonend.
Schreibe den vollständigen Plan (dasselbe JSON, das du zurückgibst) zusätzlich nach docs/plans/${MS}.json, damit ein abgebrochener Lauf fortgesetzt werden kann.`, { label: `plan:${MS}`, phase: 'Plan', schema: PLAN_SCHEMA })

if (!plan) throw new Error('Planung fehlgeschlagen')
log(`${MS}: ${plan.packages.length} Pakete, ${plan.acceptance.length} Abnahmekriterien`)

phase('Build')
const todo = plan.packages.filter(p => !SKIP.has(p.id))
if (SKIP.size) log(`Übersprungen (bereits fertig): ${[...SKIP].join(', ')}`)
const waves = [...new Set(todo.map(p => p.wave))].sort((a, b) => a - b)
const buildReports = []
for (const w of waves) {
  const pkgs = todo.filter(p => p.wave === w)
  for (let i = 0; i < pkgs.length; i += 2) {
    const chunk = pkgs.slice(i, i + 2)
    const others = chunk.length > 1 ? `Parallel arbeitet ein anderes Agent an: ${chunk.map(c => c.title + ' (owns ' + c.owns.join(', ') + ')').join('; ')}. Ändere NUR deine eigenen owns-Pfade.` : ''
    const res = await parallel(chunk.map(p => () =>
      agent(`${COMMON}

Arbeitspaket ${p.id}: ${p.title} (Meilenstein ${MS}, Welle ${w})
Deine exklusiven Pfade (owns): ${p.owns.join(', ')}
${others}

Aufgabe:
${p.task}

Wenn fertig: Selbsttest ausführen (typecheck + Tests deines Pakets). Antworte mit einem kurzen Bericht: was gebaut, welche Tests, Messwerte, bekannte Lücken.`, { label: `build:${p.id}`, phase: 'Build' })
        .then(r => ({ id: p.id, title: p.title, report: r }))
    ))
    buildReports.push(...res.filter(Boolean))
  }
  log(`Welle ${w} fertig`)
}

async function verifyLoop(tag) {
  let v = null
  for (let round = 1; round <= 4; round++) {
    v = await agent(`${COMMON}

Du bist der Integrations-Engineer für ${MS} (Verify-Runde ${round}, ${tag}). Führe die Verifikation aus:
${plan.verify_commands.map(c => '- ' + c).join('\n')}
Behebe ALLE Fehler (Typfehler, Lint, fehlschlagende Tests, Build-Fehler, Paketgrenzen) direkt im Code — auch Integrationsprobleme zwischen Paketen. Führe danach die Befehle erneut aus. green=true nur wenn alles tatsächlich grün durchläuft. report: was lief, was du gefixt hast, was offen ist.`, { label: `verify:${tag}:${round}`, phase: 'Verify', schema: VERIFY_SCHEMA })
    if (v && v.green) break
  }
  return v
}

phase('Verify')
const v1 = await verifyLoop('build')
log(`Verify nach Build: ${v1 && v1.green ? 'grün' : 'NICHT grün'}`)

phase('Review')
const LENSES = [
  `Lens ABNAHME & KORREKTHEIT: Prüfe jedes Abnahmekriterium einzeln gegen den echten Code und durch Ausführen der relevanten Tests/Benchmarks:\n${plan.acceptance.map(a => '- ' + a).join('\n')}\nFehlt etwas, ist es nur vorgetäuscht (Stub, Test der nichts prüft, hartkodierte Messwerte), oder ist ein Feature-ID von ${MS} nicht wirklich umgesetzt? Finde echte Bugs (Determinismus, Off-by-one, Race Conditions Worker/Main).`,
  `Lens ARCHITEKTUR & VERTRÄGE: Prüfe die Verträge aus PLAN §3.1 und die Abhängigkeitsregeln §3.2, die Determinismus-Regeln §3.12 (inkl. ob der Lint sie wirklich erzwingt), Datenlayout §3.5, Worker-Protokoll §3.6. Suche Sackgassen, die spätere Meilensteine teuer machen, toten Code, Duplikate, fehlende Tests für kritische Pfade.`,
]
const reviews = await parallel(LENSES.map((lens, i) => () =>
  agent(`${COMMON}\n\nDu bist kritischer Reviewer für ${MS}. Ändere KEINEN Code. ${lens}\nMelde nur echte, verifizierte Probleme (kein Stil-Nitpicking). Leere Liste wenn nichts.`, { label: `review:${i + 1}`, phase: 'Review', schema: FINDINGS_SCHEMA })
))
const findings = reviews.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity !== 'niedrig')
const minor = reviews.filter(Boolean).flatMap(r => r.findings).filter(f => f.severity === 'niedrig')
log(`${findings.length} relevante Review-Befunde, ${minor.length} niedrige`)

let v2 = v1
let fixReport = 'keine Befunde'
if (findings.length) {
  phase('Fix')
  fixReport = await agent(`${COMMON}\n\nBehebe diese Review-Befunde für ${MS} (alle hoch/mittel; niedrige nur wenn trivial):\n${JSON.stringify(findings.concat(minor), null, 1)}\nFalls ein Befund falsch ist, begründe es kurz statt ihn umzusetzen. Führe danach typecheck + Tests aus. Bericht: was behoben, was verworfen (mit Grund).`, { label: 'fix', phase: 'Fix' })
  phase('Verify')
  v2 = await verifyLoop('fix')
}

phase('Commit')
const summary = await agent(`${COMMON}

Abschluss von ${MS}. Build-Berichte:\n${buildReports.map(b => '### ' + b.id + ' ' + b.title + '\n' + b.report).join('\n\n')}\n\nVerify: ${v2 ? v2.report : 'kein Ergebnis'}\nFix: ${fixReport}\n\nAufgaben:
1. Aktualisiere docs/STATUS.md: Abschnitt "${MS}" mit Status jedes Abnahmekriteriums (✅/⚠️/❌ + Messwert/Beleg), umgesetzte Feature-IDs, Abweichungen vom Plan, offene Punkte für spätere Meilensteine, wie man es startet (Befehle). Bestehende Abschnitte behalten.
2. Stelle sicher, dass README.md im Root existiert (kurz: was, wie starten, wie testen) und aktuell ist.
3. git add -A && git commit mit Message "feat(${MS.toLowerCase()}): <kurze Zusammenfassung>" und Leerzeile + Zeile "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Kein push.
4. Antworte mit einem deutschen Kurzbericht (max. 25 Zeilen): Ergebnis, Abnahme-Tabelle kompakt, Messwerte, wie man es im Browser startet, offene Punkte.`, { label: 'commit', phase: 'Commit' })
return { ms: MS, green: !!(v2 && v2.green), summary }
