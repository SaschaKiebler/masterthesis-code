# Betrieb

## Bauen und starten

Voraussetzung ist ein JDK 21. `protoc` ist nicht nötig, das Protobuf-Plugin
lädt den Compiler selbst und erzeugt die Klassen aus `apis/proto`.

```bash
cd applications/device-management
./gradlew build
./gradlew bootRun
```

Im Repo liegen keine Tests für diesen Service.

## Lokal

`scripts/dev.sh up` startet den Service unter dem Namen `device`, direkt
nach core-platform. Er braucht die Stammdaten-DB mit dem von core migrierten
Schema, Kafka und Mosquitto.

```bash
scripts/dev.sh logs device
curl -s http://localhost:8082/actuator/health
```

Ohne Broker lässt sich der Service mit `MQTT_ENABLED=false` starten. Das
entfernt die Verbindung und den Watcher. Die Discovery-Sitzungen hängen an
derselben Verbindung und müssen dann über
`device-management.discovery.enabled=false` ebenfalls abgeschaltet werden,
sonst scheitert der Start an der fehlenden Bean.

## Container

Das Image wird vom Repo-Root aus gebaut, ein `sed` im Dockerfile biegt den
Proto-Pfad auf das flache Layout um. Zweistufig auf `eclipse-temurin:21`,
Laufzeit als unprivilegierter Nutzer mit `curl` für Healthchecks.

```bash
docker build -f applications/device-management/Dockerfile -t device-management .
```

## Im Cluster

Die Werte stehen in `infrastructure/kubernetes/base/device-management.yaml`.

| Aspekt       | Wert                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| Replikas     | 1                                                                                            |
| Ressourcen   | 250m CPU, 512Mi bis 768Mi Speicher                                                           |
| Readiness    | `/actuator/health`, erste Prüfung nach 20 s                                                  |
| Reihenfolge  | Muss laufen, bevor der ingestion-service bereit wird, der auf `device.configured` wartet     |

## Bekannte Grenzen

- **Eine Instanz.** Feste MQTT-Client-ID, Fingerprints, Drosselung und
  Sitzungen liegen im Speicher. Eine zweite Instanz würde die erste vom
  Broker werfen und eigene Sitzungen halten, die core nicht findet.
- **Bis zu 30 Sekunden Verzögerung.** Konfigurationsänderungen erreichen den
  ingestion-service erst mit dem nächsten Sweep, einen Auslöser aus core gibt
  es nicht.
- **Watcher blind bis zum ersten Sweep.** Nachrichten in den ersten Sekunden
  nach dem Start werden nicht gemeldet.
- **REST ohne Schutz.** Die Discovery-Endpunkte vertrauen dem Aufrufer, auch
  der `tenantId` im Body. Sie dürfen nur über den Proxy in core erreichbar
  sein, im Cluster sind sie ClusterIP.
- **Heuristische Zuordnung.** Eine Nachricht gehört zur Sitzung, sobald die
  Geräte-ID irgendwo im Topic oder in der Nutzlast vorkommt. Kurze IDs
  fangen Fremdes ein.
- **Koordinaten per Textsuche.** Die Standortabfrage filtert Objekte über
  `LIKE '%latitude%'` auf dem JSON und parst dann.
- **Keine Tests im Repo.**
