# Konfiguration

Die Werte stehen in `src/main/resources/application.yml`. Die Zeilen mit
Umgebungsvariable lassen sich von außen setzen, die übrigen nur in der Datei.
Im Cluster setzt `infrastructure/kubernetes/base/device-management.yaml` die
abweichenden Werte.

## Stammdaten-DB

Nur lesend, Schema und Migrationen gehören core.

| Variable      | Standard          | Bedeutung |
| ------------- | ----------------- | --------- |
| `DB_HOST`     | `localhost`       |           |
| `DB_PORT`     | `5432`            |           |
| `DB_NAME`     | `heating_platform`   |           |
| `DB_USER`     | `postgres`        |           |
| `DB_PASSWORD` | `password`        |           |

## Kafka

| Variable                  | Standard          | Bedeutung                       |
| ------------------------- | ----------------- | ------------------------------- |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092`  |                                 |
| `KAFKA_TOPIC_PARTITIONS`  | `3`               | Für beide angelegten Topics     |
| `KAFKA_TOPIC_REPLICAS`    | `1`               |                                 |

Die Topic-Namen `device.configured` und `device.discovered` stehen fest in
der Datei.

## MQTT

| Variable                         | Standard                 | Bedeutung                                                            |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------- |
| `MQTT_BROKER_URL`                | `tcp://localhost:1883`   |                                                                      |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | leer                     | Nur wirksam, wenn der Nutzername nicht leer ist                      |
| `MQTT_ENABLED`                   | `true`                   | `false` entfernt Verbindung und Watcher, siehe [Betrieb](betrieb.md) |

Die Client-ID ist fest `device-management`. Der Service läuft mit einer
Instanz, eine zweite würde die erste vom Broker verdrängen.

## Projektion und Watcher

| Variable                       | Standard | Bedeutung                                                         |
| ------------------------------ | -------- | ----------------------------------------------------------------- |
| `PROJECTION_SWEEP_INTERVAL_MS` | `30000`  | Abstand der Sweeps, der erste läuft 2 s nach dem Start            |
| `WATCHER_THROTTLE_MINUTES`     | `10`     | Ein unbekanntes Gerät wird höchstens einmal je Fenster gemeldet   |

## Nur in der Datei

| Property                                                 | Standard | Bedeutung                                            |
| -------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `device-management.watcher.sample-payload-max-chars`     | `512`    | Länge der Nutzlastprobe im Event                     |
| `device-management.discovery.enabled`                    | `true`   | Sitzungen und ihre REST-Endpunkte                    |
| `device-management.discovery.max-sessions-per-tenant`    | `3`      | Gleichzeitig lauschende Sitzungen je Mandant         |
| `device-management.discovery.session-timeout-seconds`    | `300`    | Danach endet eine Sitzung von selbst                 |
| `device-management.discovery.max-messages-per-session`   | `500`    | Aufnahmebudget je Sitzung                            |

Der Port ist 8082. Im Container gilt `JAVA_OPTS` mit `-Xmx512m -Xms128m`.
