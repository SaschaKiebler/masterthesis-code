# Konfiguration

Alle Werte sind Felder der pydantic-Settings in `analytics_service/config.py`.
Der Name der Umgebungsvariable ist der Feldname in Großbuchstaben, Groß- und
Kleinschreibung spielt keine Rolle. Eine `.env` liest der Service nicht
selbst, `scripts/dev.sh` lädt sie vor dem Start. Im Cluster setzt
`infrastructure/kubernetes/base/analytics-service.yaml` die abweichenden Werte.

## Datenbanken

| Variable                | Standard                                                                   | Bedeutung                                       |
| ----------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| `DATABASE_URL`          | `postgresql://postgres:password@localhost:5433/heating_platform_measurements` | Messwertspeicher                                |
| `REGISTRY_DATABASE_URL` | `postgresql://postgres:password@localhost:5432/heating_platform`              | Stammdaten-DB, Registry und Mitgliedschaften    |
| `DB_MIN_POOL`           | `2`                                                                        | Untergrenze des Messwert-Pools                  |
| `DB_MAX_POOL`           | `10`                                                                       | Obergrenze beider Pools                         |

## Authentifizierung und Mandanten

| Variable                          | Standard                              | Bedeutung                                                                        |
| --------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `AUTH_ENABLED`                    | `true`                                | `false` schaltet die Token-Prüfung ab und damit auch die Mandantenprüfung        |
| `LOCAL_AUTH_JWT_SECRET`           | `insecure-local-dev-secret-change-me` | Muss dem Geheimnis von core entsprechen                                          |
| `TENANT_ENFORCEMENT`              | `enforce`                             | `off`, `observe` oder `enforce`, Zwilling von `TENANT_ENFORCEMENT_MODE` in core  |
| `TENANT_MEMBERSHIP_TTL_SECONDS`   | `5`                                   | Cache der Mitgliedschaft je Subjekt                                              |
| `TENANT_SCOPE_CACHE_TTL_SECONDS`  | `300`                                 | Cache der Zuordnung Messpunkt zu Mandant                                         |
| `ANALYTICS_AUDIT_ENABLED`         | `true`                                | Abgelehnte Zugriffe in `access_audit` schreiben                                  |
| `ANALYTICS_EXPOSE_DOCS`           | `false`                               | `/docs`, `/redoc` und `/openapi.json` freischalten                               |

## Kafka und Detection

| Variable                          | Standard                   | Bedeutung                                   |
| --------------------------------- | -------------------------- | ------------------------------------------- |
| `KAFKA_ENABLED`                   | `true`                     | `false` startet nur die Abfrage-API         |
| `KAFKA_BOOTSTRAP_SERVERS`         | `localhost:9092`           |                                             |
| `KAFKA_CONSUMER_GROUP`            | `analytics`                |                                             |
| `TOPIC_MEASUREMENT_INGESTED`      | `measurement.ingested`     | Eingang                                     |
| `TOPIC_RULE_CONFIGURED`           | `rule.configured`          | Eingang, compacted                          |
| `TOPIC_ANOMALY_RULE_CONFIGURED`   | `anomaly-rule.configured`  | Eingang, compacted                          |
| `TOPIC_DEVICE_CONFIGURED`         | `device.configured`        | Eingang, compacted                          |
| `TOPIC_THRESHOLD_BREACHED`        | `threshold.breached`       | Ausgang, wird vom Service angelegt          |
| `TOPIC_ANOMALY_DETECTED`          | `anomaly.detected`         | Ausgang, wird vom Service angelegt          |
| `TOPIC_PARTITIONS`, `TOPIC_REPLICAS` | `3`, `1`                | Für die beiden angelegten Topics            |

## Wetterkontext

| Variable                                               | Standard                                    | Bedeutung                                          |
| ------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------- |
| `WEATHER_ENABLED`                                      | `true`                                      | Außentemperatur für wetterabhängige Regeln         |
| `WEATHER_BASE_URL`                                     | `https://api.open-meteo.com/v1/forecast`    | Öffentlich, ohne Schlüssel                         |
| `WEATHER_CACHE_TTL_SECONDS`                            | `900`                                       | Cache je gerundeter Koordinate                     |
| `WEATHER_DEFAULT_LATITUDE`, `WEATHER_DEFAULT_LONGITUDE` | `48.78`, `9.18`                            | Fallback, wenn der Standort keine Koordinaten hat  |
| `WEATHER_EVAL_INTERVAL_SECONDS`                        | `300`                                       | Takt der Anomalie-Engine                           |

Schwellen der Detektoren sind keine Einstellungen mehr, sie kommen je Regel
über `anomaly-rule.configured`. `LOG_LEVEL` (Standard `info`) steuert das
Logging, den Port setzt uvicorn beim Start.
