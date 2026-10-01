# TRACK-AI tai-p3: Bau-Manager

Opening, Economy, Tech, Engineer und Factory sind in `packages/ai/src/managers` ausführbar. Opening expandiert die drei erlaubten Skripte, reserviert die vier Ring-Mex und hält Engineers bis zum individuellen Handoff unter eigener Ownership. Das verhindert konkurrierende Idle-Aufträge vom EngineerManager.

Economy plant Kraftwerke aus tatsächlichem Flow-Bedarf und reserviert Energie für Mass-Senken. Mex-Upgrades sind auf eigene, sichere Spots beschränkt; neben laufender Tech-Aufrüstung startet höchstens eines. Tech rüstet eine Landfabrik bis T2 auf und fordert T2-Engineers an. Auf kleinen Karten begrenzt der Code den erforderlichen Mass-Income auf 80 % des nur mit eigenen Spots erreichbaren Einkommens. Das ist eine dokumentierte Kalibrierung, kein geänderter Roster-/expect-Wert.

Engineer bedient das TaskBoard, prüft bekannte Belegung und ersetzt abgelehnte Bauplätze deterministisch durch Spiralsuche. Land-Scouts erzeugen Jagdaufträge auch vor Ankunft eines Builders, sobald sie als Kontakte in der eigenen Zone bekannt sind. Factory produziert Engineers/Scouts/Anfragen und wiederholbare Kampf-Mixe; Konter beziehen nur reagierte EnemyMemory ein.

Belege: AI-OPEN-03/04, AI-ECO-01/04/05 und AI-FAC-01 auf Manager-Ebene; AI-ENG-02 auf Arena-Ebene bestätigt tatsächliche Placement-Rejection und zweite Fabrik innerhalb von fünf Sekunden zur ungestörten Referenz. AI-ENG-04 prüft drei Land-Scouts und mindestens 90 % der Mex-Anzahl nach fünf Minuten. AI-ECO-02/03 prüfen zusätzlich Mass-Überschuss/Fabrik-Senke und sichere gegen umkämpfte Mex-Upgrades. Die vollständigen Zeitverläufe und alle Prioritätsfälle bleiben zusätzliche Abnahmegrenzen.
