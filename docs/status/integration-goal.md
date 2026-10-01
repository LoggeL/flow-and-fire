# Goal: spielbares Flow & Fire weiterbauen und ausliefern

## Verbindliche Ausrichtung

Flow & Fire wird als spielbare RTS-Entwicklungsversion im gemeinsamen Projektordner
weitergeführt. Fortschritt bedeutet eine nutzbare Verbesserung im laufenden Spiel oder
eine behobene Lücke beim Starten, Speichern und Bereitstellen. Bereits funktionierende
Integrationen werden weiterverwendet.

Die Veröffentlichung ist erfolgt: [Spiel](https://flow-and-fire.logge.top/?menu=1),
[öffentliches Repository](https://github.com/LoggeL/flow-and-fire) und
[Start- und Bedienungsanleitung](../../README.md). Docker läuft auf der HomeBox.
Commit, Push und Updates dieses Projekts sind vom Nutzer beauftragt.

## Jetzt abschließen

1. Historische Spiel-Builds in einem dauerhaften Docker-Volume erhalten, damit bestehende
   Replays nach einem Image-Update ihre ursprüngliche Version öffnen können.
2. Die echte Aufnahme aus dem bisherigen öffentlichen Build nach dem Update importieren,
   zum ursprünglichen Build wechseln und dort Seek, Wiedergabe und Export prüfen.
3. Die neue Version bereitstellen und ihren tatsächlichen Spielstart prüfen.

Dieser Schritt ist abgeschlossen, wenn der neue Container gesund ist, der alte Build
unverändert erreichbar bleibt und die historische Aufnahme auf Chromium, Firefox und
WebKit ohne Hash-Abweichungen läuft. Die automatisierten Prüfungen bleiben stumm.
Danach wird das ausgelieferte Ergebnis mit den noch offenen Einschränkungen gemeldet.

## Arbeitsweise für weitere Schritte

Es gibt jeweils ein aktives Integrationspaket mit einem konkreten Ergebnis. Es wird
vollständig umgesetzt, mit den betroffenen Funktionen geprüft und ausgeliefert, bevor
der nächste Schritt beginnt. Vorhandene Sol-Agents werden mit klaren Dateigrenzen
wiederverwendet; neue Fanout-Runden und wiederholte Inventuren entfallen.

Weitere Aufgaben entstehen aus ausdrücklichen Nutzerwünschen oder reproduzierten
Spielproblemen. Eine alte Fehlermessung startet keine neue Experimentreihe. ImageGen
wird verwendet, wenn eine tatsächlich benötigte Grafik fehlt. Favicon, beide
ACU-Upgradeicons, Einheiten-/Gebäudeglyphen und Cursors sind bereits angeschlossen.

Prüfungen richten sich nach der Änderung. Bereits bestandene gemeinsame Prüfungen
werden nur bei betroffenen Schnittstellen oder einer konkreten Regression wiederholt.
Native Messungen laufen nacheinander und ohne Lautsprecherverbindung.

## Performance-Backlog

Die ursprünglichen strikten Ziele für kaltes Pathing, Klicklatenz, KI-Aufwand und
FX-GPU-Zeit sind noch nicht vollständig bestanden. Ihre Grenzen und Fehlbelege bleiben
erhalten. Sie blockieren die spielbare Entwicklungsversion nicht.

Dieser Backlog bekommt erst wieder Umsetzungsvorrang, wenn ein reproduzierbares Problem
im tatsächlichen Spiel ihn rechtfertigt. Dafür braucht es eine konkrete Korrektur und
eine passende Nachprüfung. Unveränderte Kandidaten werden nicht erneut gemessen.
Externe Referenzhardware und Spielerakzeptanz werden nicht als geprüft ausgegeben.

## Vorhandener Stand

Wirtschaft und Bau, Kampf und Sicht, HUD und Menüs, KI, Audio und FX sowie Replay sind
in die echte Simulation integriert. Shift-Ziehbau, vorab erkundetes Gelände mit
Sichtverdunkelung, artikulierte Modelle, Gehbewegung, Cursors und ACU-Upgrades liegen im
Spielcode. Die bisherigen funktionalen und deterministischen Abnahmen samt jeweiligen
Build-Identitäten stehen in der [Integrationshistorie](integration-history.md).

Die sieben Originalarchive, Karten, historischen Builds und bisherigen Belege bleiben
erhalten. Offene Messziele werden nicht durch eine Planänderung als bestanden markiert.
Der lokale maschinenlesbare Arbeitsstand liegt in `.git/integration-goal/`.
