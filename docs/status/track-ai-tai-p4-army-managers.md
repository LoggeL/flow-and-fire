# TRACK-AI tai-p4: Armee-Manager

Intel berechnet ein 16-WU-Threat-Grid aus bekannten Kontakten, Sicht und letzter Beobachtung. Mobile Threat verfällt mit der deterministischen 0,95-LUT; Ghost-Strukturen bleiben erhalten. Der eigene Scout fährt zur Gegnerbasis und später zu alten gegnerischen/umkämpften Spots.

Platoon bildet Wellen, sammelt am Rally-/Staging-Punkt, bewertet bekannte Ziele und erzwingt den ersten Angriff bei `waves.maxS`. Zwei schwache Thinks lösen Rückzug aus; Wiedereinstieg erfordert R >= 1 und mittlere HP >= 60 %. Neue Kontakte während der Reaktionsverzögerung verhindern einen voreiligen Wiedereinstieg. Die Vogt-Leine beendet auch bereits laufende Verfolgungsaufträge, sobald das Ziel die Fabrik-Leine verlässt. Überlebenszeit und HP lösen Notrückzug aus.

Defense setzt höchstens einen Riegel je beschädigtem Mex-Cluster und begrenzt Ausgaben. Ein vorbeilaufender Scout löst keinen Bau aus.

Belege: AI-PLT-01 a/b/c (7:11, 7:10, 8:10), AI-PLT-04 als enger Unit-Test des Verfolgungsabbruchs, AI-PLT-05 Pflichtangriff, AI-INT-02 LUT-Verfall, AI-DEF-01/03 Schaden statt bloßer Präsenz. AI-PLT-02 läuft in der Arena mit mindestens acht Einheiten vor acht Minuten. Der volle 180-s-Köder ist zusätzlich in der Arena geprüft: drei Stichel verursachen Schaden und ziehen sich zu zwölf Panzern bei 90 WU zurück, der Vogt bleibt innerhalb 60 WU und überlebt. Die komplette defensive Allokation beim Pflichtangriff ist durch diese Tests nicht abgenommen. Micro ist eine spätere MS14-Erweiterung und gehört nicht zu den acht Managern dieses Tracks.
