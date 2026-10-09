# Konfiguration

Die Werte stehen in `src/main/resources/application.yml` und
`application.properties` und lassen sich über Umgebungsvariablen
überschreiben. Beim lokalen `bootRun` wird zusätzlich eine `.env` im
Service-Ordner eingelesen. Im Cluster setzt
`infrastructure/kubernetes/base/core-platform.yaml` die abweichenden Werte.

## Datenbanken

| Variable                     | Standard                                                        | Bedeutung                                          |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `SPRING_DATASOURCE_URL`      | `jdbc:postgresql://localhost:5432/heating_platform`                | Stammdaten-DB, Schema gehört core                  |
| `SPRING_DATASOURCE_USERNAME` | `postgres`                                                      |                                                    |
| `SPRING_DATASOURCE_PASSWORD` | `password`                                                      |                                                    |
| `MEASUREMENT_DB_URL`         | `jdbc:postgresql://localhost:5433/heating_platform_measurements`   | Messwertspeicher, nur lesend für den DSGVO-Export  |
| `MEASUREMENT_DB_USERNAME`    | `postgres`                                                      |                                                    |
| `MEASUREMENT_DB_PASSWORD`    | `password`                                                      |                                                    |

## Kafka

| Variable                                  | Standard         | Bedeutung                                                          |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `KAFKA_BOOTSTRAP_SERVERS`                 | `localhost:9092` |                                                                    |
| `KAFKA_ENABLED`                           | `true`           | `false` schaltet Topics, Listener und Projektionen ab (Tests)      |
| `KAFKA_TOPIC_PARTITIONS`                  | `3`              | Für alle von core angelegten Topics                                |
| `KAFKA_TOPIC_REPLICAS`                    | `1`              |                                                                    |
| `kafka.rule-projection.sweep-interval-ms` | `30000`          | Intervall der Regel-Sweeps                                         |

Die Topic-Namen sind fest in `application.yml` unter `kafka.topics` hinterlegt.

## Authentifizierung

| Variable                        | Standard                             | Bedeutung                                              |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `LOCAL_AUTH_JWT_SECRET`         | `insecure-local-dev-secret-change-me` | HMAC-Geheimnis, per SHA-256 auf 256 Bit abgeleitet    |
| `LOCAL_AUTH_TOKEN_TTL_HOURS`    | `24`                                 | Gültigkeit der Tokens                                  |
| `LOCAL_AUTH_ADMIN_EMAIL`        | `admin@local`                        | Beim Start angelegter Admin                            |
| `LOCAL_AUTH_ADMIN_PASSWORD`     | `admin`                              |                                                        |
| `LOCAL_AUTH_ADMIN_DISPLAY_NAME` | `Local Admin`                        |                                                        |
| `cors.allowed-origins`          | leer                                 | Zusätzlich zu `localhost:3000` und `localhost:3001`    |

## Mandanten und Audit

| Variable                  | Standard  | Bedeutung                                                                                                   |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `TENANT_ENFORCEMENT_MODE` | `ENFORCE` | `OFF` prüft nichts, `OBSERVE` protokolliert ohne abzulehnen, `ENFORCE` lehnt fremde Ressourcen mit 403 ab   |
| `audit.access.enabled`    | `true`    | Zugriffs-Audit an oder aus, für den Kostenvergleich in der Evaluation                                       |

## Nachbardienste

| Variable                | Standard                 | Bedeutung                   |
| ----------------------- | ------------------------ | --------------------------- |
| `DEVICE_MANAGEMENT_URL` | `http://localhost:8082`  | Ziel des Discovery-Proxys   |

## Optionale Integrationen

Alle Werte sind standardmäßig leer oder aus. Ohne sie fehlen nur die
KI-Funktionen und die SVG-Generierung, der Rest läuft unverändert.

| Variable                                                                                       | Bedeutung                                                              |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `N8N_SERVICE_TOKEN_ENABLED`, `N8N_SERVICE_TOKEN`                                               | Statisches Bearer-Token, mit dem n8n als Service-Nutzer zugreift       |
| `N8N_SERVICE_SUBJECT`, `N8N_SERVICE_EMAIL`, `N8N_SERVICE_DISPLAY_NAME`, `N8N_SERVICE_GLOBAL_ROLE` | Identität dieses Service-Nutzers, Standardrolle `system_admin`      |
| `N8N_KPI_FORMULA_WEBHOOK_URL`                                                                  | KI-Vorschlag für KPI-Formeln                                           |
| `N8N_WEBHOOK_URL`                                                                              | Template-Builder                                                       |
| `N8N_DASHBOARD_AI_WEBHOOK_URL`                                                                 | Dashboard-Assistent                                                    |
| `N8N_SVG_GENERATION_WEBHOOK_URL`                                                               | SVG-Icons für Objekttypen                                              |
| `N8N_WEBHOOK_TOKEN`                                                                            | Gemeinsames Token für die Webhooks                                     |
| `GCS_BUCKET_NAME`, `GCS_PROJECT_ID`                                                            | Ablage der generierten SVGs in Google Cloud Storage                    |

## Profile

| `SPRING_PROFILES_ACTIVE` | Wirkung                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| nicht gesetzt            | Gesicherte Filterkette, jeder Aufruf unter `/api/v1` braucht ein Token                                    |
| `dev`                    | Alle Anfragen erlaubt, Tokens werden trotzdem ausgewertet, Mandantenprüfung `OFF`, SQL-Logging            |
| `prod`                   | Reduziertes Logging                                                                                       |
| `local`                  | Liest `application-local.properties`, gedacht für lokale Geheimnisse, die nicht ins Repo gehören          |

Ports sind 8080 für HTTP und 9090 für gRPC. Im Container gilt `JAVA_OPTS`
mit `-Xmx2g -Xms512m`.
