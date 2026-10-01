# HomeBox-Lieferung am 1. Oktober 2026

Die Opus-Änderungen sind veröffentlicht und auf der HomeBox ausgeliefert:
[faf.logge.top](https://faf.logge.top/?menu=1). Die bisherige Adresse bleibt als Alias erhalten.

- Quellstand: `7fc3bcf2cc72ef55ba6cfd9bb6b03c8227c7bdb6`.
- Image: `flow-and-fire:7fc3bcf2cc72`, Container: `flow-and-fire-game-1`.
- Sim-Identität: `faf-sim/ms6.3-factory-tiers-radar`, simHash `0x249a86a9`.
- Container gesund, null Neustarts, Benutzer `node`, Root-Dateisystem schreibgeschützt.
- HTTPS und Isolation-Header aktiv; der Spielstart bestätigt `crossOriginIsolated`.
- Das persistente Build-Archiv wurde erhalten, einschließlich des ursprünglichen ms6.2-Builds.

Die öffentliche Chromium-Prüfung verwendet native UI-Aktionen und lesende Test-Hooks.
Spielbefehle werden weder injiziert noch durch Spawns ersetzt. Die neue Aufnahme ist
unverfälscht (`Tainted` nicht gesetzt).

| Ablauf | Ergebnis |
| --- | --- |
| Menü und Setup | Blaue/rote Armee, getrennte Teams, normales KI-Gefecht startet |
| ACU-Ausbau | Starten, pausieren, abbrechen: Pausezustand wird aufgehoben |
| Anschließender Bau | Fabrik vollständig fertiggestellt, Ausbauangebot aktiv |
| Fabrik | Rally über UI gesetzt, Ingenieur vollständig produziert |
| Aufgeben | Aus globaler Pause nach Bestätigung beendet, Statistik zeigt gebaute Einheit und Gebäude |
| Neue Aufnahme | Exportiert, wiedergegeben, erster Vergleich zunächst ausstehend, Tick 100 sauber |
| Alte Aufnahme | Originalbuild `48ecd86e71a1` lädt, Seek vorwärts und rückwärts stimmt mit gespeicherten Hashes überein |

Für die alte Aufnahme stimmen Tick 600 (`2514971037`), Tick 100 (`1262085241`) und
Tick 2500 (`2141547410`) jeweils exakt überein. Die zehn Screens enthalten keine
Seitenfehler oder fehlgeschlagenen HTTP-Antworten. Vor jeder Navigation war die
Audiosperre installiert: null Lautsprecherverbindungen und null blockierte Verbindungsversuche.

Lokale Belege: `test-results/opus-implementation-20261001/deployment/receipt.json`,
die dazugehörigen PNGs und `fresh-public-match.rtsreplay`. Die README-Abbildung stammt
aus diesem öffentlichen Build.

Typprüfung und Lint bestehen. Opus' lokale Suite umfasst 336 Dateien und 3339 Tests;
die Lieferung hat zusätzlich 35 betroffene Tests und acht Archivtests bestanden.
Firefox/WebKit, Performance-Gates und die vollständigen Playwright-Specs wurden für
diese Lieferung nicht erneut ausgeführt. Die bekannten Performance- und Balancegrenzen
stehen weiterhin im [Integrationsabschluss](integration-completion.md) und im
[Opus-Fixbericht](opus-fixes-2026-10-01.md).
