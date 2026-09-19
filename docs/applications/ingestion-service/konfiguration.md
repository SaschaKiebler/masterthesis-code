# Konfiguration

Alles kommt aus Umgebungsvariablen. Eine `.env` im Service-Ordner wird beim
Start gelesen. Die Standardwerte passen zum lokalen Compose-Stack, für das
Cluster setzt `infrastructure/kubernetes/base/ingestion-service.yaml` die
abweichenden Werte.

## MQTT

| Variable                         | Standard            | Bedeutung                                                                     |
| -------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `MQTT_HOST`                      | `localhost`         | Broker                                                                        |
| `MQTT_PORT`                      | `1883`              |                                                                               |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | leer                | Nur wirksam, wenn beide gesetzt sind                                          |
| `MQTT_CLIENT_ID`                 | `ingestion-service` | Basis der Client-ID, siehe unten                                              |
| `MQTT_TOPIC`                     | `house/+/sensor/#`  | Primärer Filter                                                               |
| `MQTT_EXTRA_TOPICS`              | `#`                 | Weitere Filter, kommagetrennt. `tele/#` wird ergänzt, falls nicht abgedeckt   |
| `MQTT_SHARE_GROUP`               | `ingestion`         | Shared-Subscription-Gruppe. Leer setzen für Broker ohne Shared Subscriptions  |

**Client-ID.** Der Broker trennt die ältere Verbindung, sobald ein zweiter
Client mit derselben ID verbindet. Deshalb hängt der Service an die Basis den
Wert von `HOSTNAME` an, unter Kubernetes also den Pod-Namen. Ohne `HOSTNAME`
ein zufälliges Suffix. Beginnt der Hostname bereits mit der Basis, wird er
unverändert genommen.

**Effektive Filter.** Überlappende Filter werden zusammengefasst, weil der
Broker eine Nachricht je passendem Filter zustellt und sie sonst doppelt
geschrieben würde. Mit den Standardwerten bleibt nur `#` übrig. Ist eine
Share-Group gesetzt, wird jeder Filter als `$share/<group>/<filter>` abonniert.
Der Broker liefert Nachrichten trotzdem unter ihrem Original-Topic, die Parser
sehen den Präfix nie.

## Messwertspeicher

| Variable             | Standard                       | Bedeutung                                   |
| -------------------- | ------------------------------ | ------------------------------------------- |
| `DB_HOST`            | `localhost`                    | TimescaleDB                                 |
| `DB_PORT`            | `5433`                         | Lokaler Compose-Port. Im Cluster `5432`     |
| `DB_USER`            | `postgres`                     |                                             |
| `DB_PASSWORD`        | `password`                     |                                             |
| `DB_NAME`            | `digital_demon_measurements`   |                                             |
| `DB_MAX_CONNECTIONS` | `6`                            | Verbindungen je Instanz, siehe unten        |

**Verbindungsbudget.** Ohne den Wert dimensioniert der Pool nach der CPU-Zahl
des Knotens, was nichts mit der Datenbank zu tun hat. Der Speicher läuft mit
`max_connections = 100` und wird mit analytics und core geteilt. Bei zehn
Replikas am Autoscaler-Limit sind sechs je Instanz das Maximum, das noch Platz
für die anderen Leser lässt. Ein zu kleiner Wert kostet Latenz und keine Daten,
Aufrufer warten dann auf eine freie Verbindung.

## Kafka

| Variable                    | Standard               | Bedeutung                                                              |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `KAFKA_BOOTSTRAP_SERVERS`   | `localhost:9092`       |                                                                        |
| `KAFKA_CLIENT_ID`           | `ingestion-service`    | Producer-ID. Der Consumer der Projektion hängt `-device-config` an     |
| `KAFKA_MEASUREMENT_TOPIC`   | `measurement.ingested` | Ausgang                                                                |
| `KAFKA_DEVICE_CONFIG_TOPIC` | `device.configured`    | Eingang, compacted                                                     |

Der Producer läuft idempotent (`enable.idempotence`), ein Batch, der binnen
10 Sekunden nicht zugestellt ist, wird mit Warnung verworfen.

## Logging

`RUST_LOG` steuert den tracing-Filter, Standard ist `ingestion_service=info`.
Mit `ingestion_service=debug` erscheint jede empfangene Nachricht samt Nutzlast.
