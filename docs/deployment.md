# Deployment mit Docker und auf HomeBox

Flow & Fire wird als statische Browseranwendung ausgeliefert. Der Server liefert HTML, JavaScript, Modelle, Karten und Audio aus. Die Spielsimulation und das Rendering laufen im Browser; der Container benötigt keine GPU und ist kein Multiplayer-Spielserver.

## Voraussetzungen

- Docker Engine mit Compose-Plugin auf dem Zielhost.
- Ein Checkout dieses Repositorys und ein freier TCP-Port, standardmäßig 8080.
- Auf dem Spielerrechner ein Browser mit WebGL2.

Node und pnpm werden für den Docker-Build im Image bereitgestellt. Eine zusätzliche lokale Node-Installation auf HomeBox ist dafür nicht nötig.

## Starten

Im Repository-Root auf dem Zielhost:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

Lokal ist das Spiel unter `http://localhost:8080` erreichbar. Von einem anderen Rechner öffnest du die Adresse des Zielhosts mit diesem Port. Die erste Erstellung des Images benötigt Netzwerkzugriff für die Build-Abhängigkeiten.

Der Host-Port wird über `FLOW_FIRE_PORT` gesetzt. Für eine dauerhafte Konfiguration eine `.env` im Repository-Root anlegen:

```dotenv
FLOW_FIRE_PORT=8080
```

Alternativ für einen einzelnen Aufruf:

```sh
FLOW_FIRE_PORT=8090 docker compose up -d --build
```

Die `.env` wird von Compose gelesen und gehört zur lokalen Deployment-Konfiguration. Sie enthält für dieses Setup keine Spielzugangsdaten.

## Auf HomeBox bereitstellen

Das Spiel läuft unter [flow-and-fire.logge.top](https://flow-and-fire.logge.top/?menu=1), erreichbar über den vorhandenen Traefik-Proxy. Der öffentliche Browserstart ist geprüft: Gefecht gegen Normal-KI, Commander-Auswahl und Bewegung, Fabrik-Baumodus und Ressourcen-HUD ohne Lade- oder Laufzeitfehler. Die Audioausgabe blieb dabei strikt ohne Lautsprecherverbindung. Das öffentliche Repository liegt unter [LoggeL/flow-and-fire](https://github.com/LoggeL/flow-and-fire).

Für einen neuen Checkout auf HomeBox:

```sh
ssh logge@192.168.178.46
git clone https://github.com/LoggeL/flow-and-fire.git
cd flow-and-fire
FLOW_FIRE_PORT=8188 SOURCE_REVISION=$(git rev-parse --short=12 HEAD) docker compose -f compose.yaml -f compose.homebox.yaml up -d --build
docker compose -f compose.yaml -f compose.homebox.yaml ps
docker compose -f compose.yaml -f compose.homebox.yaml logs --tail=100
```

Bei einem bestehenden Deployment dessen vorhandenes Projektverzeichnis verwenden. `compose.homebox.yaml` verbindet das Spiel mit dem bereits vorhandenen externen Netzwerk `dokploy-network` und setzt die Traefik-Route für die Domain. Das Netzwerk und der HTTPS-Proxy müssen auf dem Host existieren. Die interne Anwendung hört weiterhin auf Port 8080; der zusätzliche HomeBox-Port ist 8188.

Danach den Spielstart im Browser prüfen: Karte, HUD und Einheiten müssen erscheinen, Karten-, Modell- und Audioassets ohne Ladefehler ankommen. Automatisierte Browserprüfungen installieren die stumme Ausgabe vor der Navigation und verbinden keinen Lautsprecherausgang. Für die Deployment-Prüfung ist kein Anhören von Audio erforderlich.

Das Build liefert versionierte Dateien unter `/b/<buildHash>/`. `/build.json` enthält die aktuelle Build-Kennung. Zur HTTP-Prüfung auf dem Host:

```sh
curl --fail http://localhost:8080/build.json
curl --head http://localhost:8080/
```

Bei anderem Host-Port die URLs entsprechend ändern. Ein erreichbares `/build.json` belegt die ausgelieferte Build-Kennung; es ersetzt keinen Starttest im Browser.

Für das HomeBox-Setup:

```sh
curl --fail http://localhost:8188/build.json
curl --fail https://flow-and-fire.logge.top/build.json
curl --head https://flow-and-fire.logge.top/
```

## HTTPS und Reverse Proxy

Für einen öffentlichen Zugriff eine eigene HTTPS-Adresse vor den Container setzen und den Proxy auf den konfigurierten Host-Port weiterleiten. Die Domain und Zertifikate werden außerhalb des Spielcontainers verwaltet.

Der statische Server setzt folgende Header, die der Reverse Proxy unverändert weitergeben muss:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

HTTPS ist für einen sicheren Browserkontext außerhalb von `localhost` erforderlich. Zusammen mit den Headern ermöglicht es Cross-Origin Isolation und damit den SharedArrayBuffer-Transport. Ohne diese Voraussetzungen nutzt das Spiel den Transfer-Fallback; lokale Replay-Speicherfunktionen können ebenfalls eingeschränkt sein.

Root-Einstieg und `/build.json` müssen auf Aktualität geprüft werden. Die Dateien eines konkreten `/b/<buildHash>/`-Builds dürfen langfristig gecacht werden. Der Proxy darf neue Builds nicht mit einer alten Build-Kennung oder alten HTML-Dateien mischen.

## Aktualisieren und zurücksetzen

Im bestehenden Checkout, nach Sicherung eigener Deployment-Änderungen:

```sh
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Anschließend `/build.json` und einen echten Spielstart prüfen. Ein Browser-Reload lädt den neuen Einstieg; laufende Partien behalten bereits geladene Dateien. Replays liegen auf dem Spielerrechner im Browserspeicher oder als exportierte Dateien, nicht in einem Container-Datenvolume.

Auf HomeBox bei jedem Update beide Compose-Dateien beibehalten, damit Netzwerk und Proxy-Labels erhalten bleiben:

```sh
git pull --ff-only
FLOW_FIRE_PORT=8188 SOURCE_REVISION=$(git rev-parse --short=12 HEAD) docker compose -f compose.yaml -f compose.homebox.yaml up -d --build
docker compose -f compose.yaml -f compose.homebox.yaml ps
```

Für einen Rücksprung einen bekannten Commit in einem separaten Checkout bereitstellen oder das zuvor gesicherte Image verwenden. Dazu dessen Commit und Build-Kennung vor dem Update festhalten. Keine ungesicherten lokalen Änderungen durch einen Reset überschreiben.

## Persistentes Build-Archiv für Replays

Das Image enthält seinen unveränderlichen Build unter `/app/payload`. Der Container startet weiterhin als Nutzer `node` mit schreibgeschütztem Root-Dateisystem. Nur das benannte Volume `flow-and-fire-releases` unter `/app/releases` ist für das Release-Archiv beschreibbar. Bei einem neuen Volume übernimmt Docker die im Image vorbereitete Verzeichniszuordnung zu UID/GID 1000.

Vor dem Serverstart prüft der Archiver den aktuellen Build und die SHA-256-Identitäten aller bereits archivierten Releases. Er kopiert einen neuen Build zunächst in ein Staging-Verzeichnis und installiert das vollständige `/b/<buildHash>/`-Verzeichnis durch Umbenennen. Identitätsdateien liegen separat unter `.identities`; die ursprünglichen Asset-Bäume bleiben unverändert. Ein einzelner atomarer `current`-Zeiger veröffentlicht danach `index.html` und `build.json`. Der Server liefert weiterhin `/`, `/build.json` und alle alten `/b/<buildHash>/`-Routen mit den vorhandenen Cache- und Isolation-Headern aus.

Ein bereits vorhandener Build-Hash mit anderen Asset- oder Einstiegsbytes wird abgelehnt. Auch beschädigte oder nicht registrierte ältere Releases verhindern den Start. Der Archiver überschreibt keinen alten Build und übernimmt keine unvollständigen Staging-Verzeichnisse. Abgebrochene Vorbereitungen können private Staging- oder Zeigerdateien hinterlassen; diese werden nicht automatisch bereinigt. Es darf nur ein Archiver gleichzeitig auf das Volume schreiben.

Normales `docker compose up`, Image-Neubau und `docker compose down` erhalten das Volume. **`docker compose down -v` oder `docker volume rm flow-and-fire-releases` löschen das Archiv absichtlich.** Es gibt keine automatische Aufbewahrungsfrist und keine automatische Löschung alter Releases. Für langfristige Verfügbarkeit das vollständige Volume einschließlich Identitäten und Zeigern sichern. Browseraufnahmen bleiben weiterhin getrennt auf dem Spielerrechner.

### Bestehendes Image vor dem ersten Umstieg importieren

Ein früherer Build muss einmal aus seinem tatsächlichen Image importiert werden, bevor dieses durch den neuen Container ersetzt wird. Das folgende Beispiel verwendet das bereits ausgelieferte Image `flow-and-fire:af8a6a3f88d6` und die neuen Archiver-Dateien aus dem Repository-Root. Es baut kein Image und startet keinen Webserver.

Nur für das neue, leere Archiv-Volume zunächst die Eigentümerschaft vorbereiten. Dieser einmalige Hilfscontainer darf ausschließlich die Volume-Wurzel auf UID/GID 1000 setzen; der Spielcontainer selbst läuft weiterhin ohne Root-Rechte:

```sh
docker volume create flow-and-fire-releases
docker run --rm --read-only --user 0:0 --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges:true --mount type=volume,src=flow-and-fire-releases,dst=/app/releases --entrypoint node flow-and-fire:af8a6a3f88d6 -e "require('node:fs').chownSync('/app/releases',1000,1000)"
docker run --rm --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true --mount type=volume,src=flow-and-fire-releases,dst=/app/releases --mount type=bind,src="$PWD/deploy",dst=/archive-tools,readonly --entrypoint node flow-and-fire:af8a6a3f88d6 /archive-tools/start.mjs --archive-only --payload /app/dist --releases /app/releases
```

Der letzte Befehl liest die alten Originalbytes aus `/app/dist` und protokolliert Build-Kennung und Identitätsdigest. Ein Fehler muss vor dem Rollout geklärt werden. Keine alten Verzeichnisse durch einfaches Kopieren nach `/b/` einschleusen, weil dabei die geprüfte Identitätsregistrierung fehlt. Nach erfolgreichem Import das neue Image mit den oben beschriebenen Compose-Befehlen bauen und starten. Die tatsächliche Archivmigration und historische Replay-Wiedergabe werden getrennt vom bisherigen öffentlichen Spielstart geprüft.

Für ein bereits gebautes Image mit Archiver ist derselbe Import ohne gemountete Skripte möglich: `node /app/start.mjs --archive-only --payload <geprüftes-altes-dist> --releases /app/releases`. Der alte Payload muss dafür lesbar und das Archiv-Volume schreibbar im Hilfscontainer gemountet sein.

Die kleinen Dateisystemverträge lassen sich lokal prüfen:

```sh
node --test deploy/release-archive.test.mjs
```

Sie ersetzen nicht die Docker-Ownership-/HTTP-Prüfung und die Wiedergabe eines echten historischen Replays im Browser.

## Stoppen

```sh
docker compose down
```

Auf HomeBox entsprechend `docker compose -f compose.yaml -f compose.homebox.yaml down` verwenden.

## Betrieb prüfen

| Symptom | Prüfung |
| --- | --- |
| Seite nicht erreichbar | `docker compose ps`, Logs, gewählten Host-Port und Weiterleitung prüfen |
| Assets oder Worker laden nicht | Browser-Netzwerkansicht auf 404, MIME-Typen und gemischte Build-Kennungen prüfen |
| SharedArrayBuffer nicht aktiv | HTTPS und COOP/COEP-Header am tatsächlich aufgerufenen Einstieg prüfen |
| Replay-Bibliothek leer | Browserprofil und Website-Origin prüfen; Aufnahmen sind lokal und originspezifisch |
| Bildrate niedrig | Grafikpreset im Spiel reduzieren; die GPU des Spielerrechners rendert das Spiel |

Die noch offenen ursprünglichen Performance-Gates sind im [Integrationsstatus](status/integration-goal.md) dokumentiert. Docker oder ein schnellerer Webserver qualifizieren diese Browser-/Sim-/GPU-Zeitziele nicht. Eine erfolgreiche Bereitstellung wird erst durch die tatsächliche Host- und Browserprüfung belegt.
