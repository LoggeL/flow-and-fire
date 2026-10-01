# TRACK-AI tai-p5: Integration und Szenarien

`createDefaultBrain` setzt acht Manager in MANAGER_ORDER zusammen. Szenario-DSL und `createScenario`/`runScenario` kombinieren Karte, Seed, Profile, optionale Brains oder gescriptete CommandSources, Spawns, Cheats und Assertions. `budgetScale` ermöglicht AI-DET-02.

Die aktuellen Tests decken byteidentischen Fog, keine fremde Eco, halbiertes Budget ohne doppelte Sequenzen, Hash-Replay, Wellen, Poke-/Scout-Denial und abgelehnte Platzierung ab. Die vollständigen Timing-Messungen für drei Eröffnungen auf zwei Karten stehen in [track-ai-openings.md](track-ai-openings.md). `scripts/openings.ts` reproduziert sie, ohne `expect` zu ändern.

Abweichungen über zehn Sekunden bleiben sichtbar: besonders Mex8 bei tech_greed auf Hollow Ridge (-64,7 s). Die Modelle haben unterschiedliche Engineer-Policy nach dem Skript, andere Platzierung und Pfadbewegung sowie unterschiedliche Roll-off-Semantik. Die Arena spawnt ein fertiges Produkt sofort und pausiert die nächste Produktion zwei Sekunden; ecosim verzögert den Spawn zwei Sekunden. Factory1/Engineer1 sind in der Arena um 1,5/3,0 s früher. Für die größeren Mex-/T2-Abweichungen ist keine einzelne Ursache isoliert; die genannten Codeunterschiede sind belegte Einflussfaktoren, keine vollständig bewiesene Erklärung der Deltas. Das ±10-s-Ziel ist deshalb nicht pauschal erfüllt.
