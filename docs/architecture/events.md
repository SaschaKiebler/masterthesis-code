# Event-Katalog

Die kanonische Liste der Kafka-Topics der Plattform, wem sie gehören, wer sie
liest und welche Regeln für alle gelten. Was ein einzelner Service mit einem
Topic macht, steht in dessen Doku unter `docs/applications/<service>/`. Das
Zusammenspiel zeigt [architecture.drawio.png](architecture.drawio.png).

## Topics

Alle Nutzlasten sind Protobuf aus `apis/proto`. Key und Nutzlast liegen als
Byte-Arrays auf dem Topic, jeder Service dekodiert selbst. Alle Topics haben
drei Partitionen und Replikationsfaktor 1 (`KAFKA_TOPIC_PARTITIONS`,
`KAFKA_TOPIC_REPLICAS`).

| Topic                     | Art                  | Key       | Nutzlast                        | Besitzer, legt an  | Produzent         | Konsumenten                                                         |
| ------------------------- | -------------------- | --------- | ------------------------------- | ------------------ | ----------------- | ------------------------------------------------------------------- |
| `measurement.ingested`    | Ereignis             | Geräte-ID | `core.v1.MeasurementBatch`      | core-platform      | ingestion-service | core-platform (Gruppe `core-platform`), analytics-service (Gruppe `analytics`) |
| `device.discovered`       | Ereignis, gedrosselt | Geräte-ID | `device.v1.DeviceDiscovered`    | device-management  | device-management | core-platform (Gruppe `core-platform`)                              |
| `device.configured`       | Zustand, compacted   | Geräte-ID | `device.v1.DeviceConfig`        | device-management  | device-management | ingestion-service, analytics-service (beide ohne Gruppe)            |
| `rule.configured`         | Zustand, compacted   | Regel-ID  | `detection.v1.RuleConfig`       | core-platform      | core-platform     | analytics-service (ohne Gruppe)                                     |
| `anomaly-rule.configured` | Zustand, compacted   | Regel-ID  | `detection.v1.AnomalyRuleConfig`| core-platform      | core-platform     | analytics-service (ohne Gruppe)                                     |
| `threshold.breached`      | Ereignis             | Geräte-ID | `detection.v1.DetectionEvent`   | analytics-service  | analytics-service | core-platform (Gruppe `core-platform`), notification-service (Gruppe `notification`) |
| `anomaly.detected`        | Ereignis             | Geräte-ID | `detection.v1.DetectionEvent`   | analytics-service  | analytics-service | core-platform (Gruppe `core-platform`), notification-service (Gruppe `notification`) |

Verträge

| Nutzlast                         | Datei                                           |
| -------------------------------- | ----------------------------------------------- |
| `core.v1.MeasurementBatch`       | `apis/proto/core/v1/measurement_ingestion.proto` |
| `device.v1.DeviceDiscovered`     | `apis/proto/device/v1/device_discovered.proto`  |
| `device.v1.DeviceConfig`         | `apis/proto/device/v1/device_config.proto`      |
| `detection.v1.RuleConfig`        | `apis/proto/detection/v1/rule_config.proto`     |
| `detection.v1.AnomalyRuleConfig` | `apis/proto/detection/v1/anomaly_rule_config.proto` |
| `detection.v1.DetectionEvent`    | `apis/proto/detection/v1/detection_event.proto` |

Das Verzeichnis `apis/proto` gehört keinem Service. Jeder Service erzeugt
seinen Code daraus selbst beim Bauen, Java über das Gradle-Protobuf-Plugin,
Rust über `build.rs` mit prost, Python über ein Generierungsskript. Kein
Service importiert den generierten Code eines anderen.

## Dead-Letter-Topics

| DLQ                        | Quelle                 | Legt an                                  | Schreibt hinein                                       |
| -------------------------- | ---------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `measurement.ingested.dlq` | `measurement.ingested` | core-platform                            | core-platform (Listener), analytics-service (Consumer) |
| `threshold.breached.dlq`   | `threshold.breached`   | core-platform und notification-service, idempotent | core-platform, notification-service          |
| `anomaly.detected.dlq`     | `anomaly.detected`     | core-platform und notification-service, idempotent | core-platform, notification-service          |

Eine DLQ hat dieselbe Partitionszahl wie ihre Quelle, weil der Recoverer der
Java-Services den Datensatz in die Partition schreibt, aus der er kam. In
die DLQ geht der rohe Datensatz mit Key und Nutzlast, unverändert.

Bekannte Lücke. Der Listener von core-platform auf `device.discovered` zielt
bei einer nicht dekodierbaren Nachricht auf `device.discovered.dlq`, dieses
Topic legt aber kein Service an. Bei abgeschalteter automatischer Anlage
scheitert der Recoverer in diesem Fall. Bisher ist keine solche Nachricht
aufgetreten, die Lücke ist dokumentiert und nicht geschlossen.

## Regeln

Vier Regeln gelten für alle Services. Die ersten drei betreffen die Topics
selbst, die vierte ihre Anlage.

**1. Namensschema.** Ein Topic heißt `<substantiv>.<partizip>` in
englischer Sprache und Kleinschreibung. Ereignisse tragen ein Partizip für
etwas, das schon geschehen ist (`ingested`, `discovered`, `breached`,
`detected`), Zustandstopics ebenso (`configured`). Ein mehrteiliges
Substantiv trennt ein Bindestrich (`anomaly-rule`). Die DLQ einer Quelle
heißt `<quelle>.dlq`. Der Name des Topics ist zugleich der Wert des Felds
`type` im `DetectionEvent`.

**2. Zustandstopics sind compacted und geschlüsselt.** Ein Zustandstopic
trägt je Schlüssel den vollständigen letzten Stand als Snapshot, Kafka
behält je Key nur den jüngsten Datensatz. Ein Datensatz ohne Nutzlast ist
ein Tombstone und entfernt den Schlüssel. Konsumenten lesen ein
Zustandstopic ohne Consumer-Group. Jede Instanz weist sich beim Start alle
Partitionen zu, liest von Anfang bis zur High Watermark, blockiert solange
und folgt danach im Hintergrund. Nach dem Replay hat sie den vollständigen
Zustand, ohne eine Datenbank oder einen anderen Service zu fragen. Das ist
Event-carried State Transfer. Der Produzent publiziert nur Änderungen, indem
er je Schlüssel einen Fingerprint mit dem zuletzt gesendeten Stand
vergleicht, und beim ersten Sweep nach einem Neustart alles einmal. Zustands-
topics haben keine DLQ. Ein nicht dekodierbarer Snapshot wird protokolliert
und übersprungen, der nächste Sweep des Besitzers publiziert den Schlüssel
erneut.

**3. Jede Subscription mit Consumer-Group hat eine DLQ.** Wer ein
Ereignistopic in einer Gruppe konsumiert, besitzt die DLQ dieser
Subscription und legt sie an. Konsumieren zwei Services dasselbe Topic,
teilen sie sich die DLQ und legen sie beide idempotent an. Ein nicht
dekodierbarer Datensatz geht ohne Wiederholung in die DLQ, ein transienter
Fehler nach zwei Wiederholungen im Abstand von einer Sekunde. Fehler in der
fachlichen Verarbeitung nach erfolgreichem Dekodieren gehen nicht in die
DLQ, sie werden protokolliert und der Offset wird committet. Ein Consumer
bleibt nie an einer Nachricht hängen.

**4. Besitz und Anlage.** Jedes Topic hat genau einen Besitzer, der es beim
Start anlegt. Die automatische Anlage ist am Broker abgeschaltet
(`KAFKA_AUTO_CREATE_TOPICS_ENABLE=false`, lokal wie im Cluster) und in den
Spring-Consumern ebenfalls (`allow.auto.create.topics=false`). Ein Konsument,
der vor dem Besitzer startet, wartet, bis das Topic erscheint. Ein Besitzer,
der vor dem Broker startet, scheitert laut (`spring.kafka.admin.fail-fast`)
und startet neu, statt ohne seine Topics weiterzulaufen. Besitzer ist der
produzierende Service, mit einer Ausnahme. `measurement.ingested` besitzt
core-platform, weil der Vertrag im Paket `core.v1` liegt und der
ingestion-service grundsätzlich keine Topics anlegt. Er publiziert nur.

## Was kein Topic bekommt

Die Grenze ist genauso wichtig wie die Liste. Folgendes läuft bewusst nicht
über Kafka.

- **Rohe Gerätetelemetrie.** Sie bleibt auf MQTT. Der ingestion-service ist
  die einzige Brücke, Kafka sieht erst den dekodierten `MeasurementBatch`.
- **Messwertabfragen.** Zeitreihen, Statistik und Live-Werte holt das
  Frontend synchron per HTTP beim analytics-service, dem einzigen Leser des
  Messwertspeichers.
- **Stammdaten und Registry.** Objekte, Links, Typen, Messpunkte, Nutzer und
  Mandanten liest das Frontend synchron beim core-platform. Andere Services
  lesen die Tabellen des Stammdatenspeichers direkt, wo der Entwurf es
  vorsieht, es gibt keine Replikation per Event.
- **Meldungen.** Der Ausgang des notification-service ist die Datenbank und
  optional ein Webhook, kein Topic.
- **Discovery-Sitzungen.** Die Inbetriebnahme läuft synchron per HTTP vom
  core-platform zum device-management.

Wer hier ein Topic ergänzen will, braucht einen Konsumenten, der den Zustand
aus dem Topic aufbauen soll, oder ein Ereignis, auf das mehr als ein Service
reagiert. Sonst reicht ein synchroner Aufruf.

## Einen Detektor ergänzen

Ein neues Detection-Topic braucht am Katalog nichts zu ändern, wenn es die
gemeinsame Envelope `DetectionEvent` benutzt. Der analytics-service legt es
an und publiziert, notification-service bekommt es über
`NOTIFICATION_TOPICS`, core-platform über seine Topic-Konfiguration. Beide
legen die DLQ dazu selbst an. Die Zeile in der Tabelle oben kommt trotzdem
dazu, der Katalog ist die Liste.
