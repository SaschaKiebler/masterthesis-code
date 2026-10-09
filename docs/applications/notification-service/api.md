# API und Regeln

Alle Endpunkte brauchen das Bearer-Token von core. Der Service prüft es mit
demselben Geheimnis und liest den Mandanten des Aufrufers aus den
Stammdaten. Ein `system_admin` darf mit `?tenantId=` jeden Mandanten
wählen, alle anderen nur ihre Mitgliedschaften, ohne Angabe gilt die erste.
Im Frontend laufen die Aufrufe über `/api/notifications/*`.

## Meldungen

| Methode und Pfad                          | Parameter                                                     | Antwort                                     |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| `GET /api/v1/notifications`               | `since`, `severity`, `acknowledged`, `limit` (max 500), `offset` | Meldungen des Mandanten, neueste zuerst  |
| `PATCH /api/v1/notifications/{id}/ack`    |                                                               | Meldung quittiert, mit Zeit und Subjekt     |

| Feld einer Meldung          | Inhalt                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| `type`, `severity`          | Aus dem Event, zum Beispiel `threshold.breached` und `WARNING`    |
| `deviceId`, `metricId`      | Der Kanal, auf dem die Erkennung feuerte                          |
| `assetRef`                  | Messpunkt-ID aus dem Event                                        |
| `summary`, `detail`         | Einzeiler und Detail-JSON des Detektors                           |
| `detectedAt`, `createdAt`   | Zeitpunkt der Erkennung und der Speicherung                       |
| `acknowledgedAt`, `acknowledgedBy` | Quittierung, leer solange offen                            |
| `ruleId`                    | Die auslösende Regel, leer bei der impliziten Standardregel       |

## Regeln

| Methode und Pfad                            | Wirkung                                        |
| ------------------------------------------- | ---------------------------------------------- |
| `GET /api/v1/notification-rules`            | Alle Regeln des Mandanten                      |
| `POST /api/v1/notification-rules`           | Regel anlegen, 201                             |
| `PATCH /api/v1/notification-rules/{id}`     | Felder ändern, nur die gesendeten               |
| `DELETE /api/v1/notification-rules/{id}`    | Regel löschen, 204                             |

Jede Änderung leert den Regel-Cache des Mandanten, sie wirkt sofort auf den
nächsten Befund.

| Feld              | Standard                                   | Bedeutung                                                                 |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `name`            | Pflicht                                    |                                                                           |
| `eventTypes`      | `threshold.breached`, `anomaly.detected`   | Welche Ereignisse die Regel greift                                        |
| `minSeverity`     | `INFO`                                     | `INFO`, `WARNING`, `ERROR` oder `CRITICAL`                                |
| `cooldownMinutes` | `15`                                       | Dieselbe Erkennung höchstens einmal je Fenster, 0 bis 1440, 0 schaltet ab |
| `webhookUrl`, `webhookToken` | leer                            | Eigener Webhook der Regel, sonst der globale                              |
| `enabled`         | `true`                                     |                                                                           |

„Dieselbe Erkennung“ ist das Tupel aus Mandant, Regel, Ereignistyp, Gerät,
Metrik und der Art des Befunds (`kind` im Detail-JSON). Zwei verschiedene
Anomalieregeln auf demselben Kanal unterdrücken sich deshalb nicht
gegenseitig. Der Cooldown wird im Speicher geführt, nach einem Neustart
dient die jüngste gespeicherte Meldung als Rückfallwert.

## Konfiguration

| Variable                        | Standard                                   | Bedeutung                                                        |
| ------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | `localhost`, `5432`, `heating_platform`, `postgres`, `password` | Geteilte Stammdaten-DB |
| `KAFKA_BOOTSTRAP_SERVERS`       | `localhost:9092`                           |                                                                  |
| `KAFKA_TOPIC_PARTITIONS`, `KAFKA_TOPIC_REPLICAS` | `3`, `1`                  | Für die angelegten `.dlq`-Topics                                 |
| `NOTIFICATION_TOPICS`           | `threshold.breached,anomaly.detected`      | Konsumierte Topics, ein neuer Detektor erweitert nur diese Liste |
| `NOTIFICATION_MIN_SEVERITY`     | `INFO`                                     | Mindestschwere der impliziten Standardregel                      |
| `NOTIFICATION_COOLDOWN_MINUTES` | `0`                                        | Cooldown der Standardregel                                       |
| `NOTIFICATION_WEBHOOK_URL`, `NOTIFICATION_WEBHOOK_TOKEN` | leer              | Globaler Webhook, leer bedeutet nur Log                          |
| `LOCAL_AUTH_JWT_SECRET`         | `insecure-local-dev-secret-change-me`      | Muss dem Geheimnis von core entsprechen                          |

Der Port ist 8083. Ohne Token erreichbar ist nur `/actuator/**`.
