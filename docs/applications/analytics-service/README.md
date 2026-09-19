# analytics-service

Der einzige Leser des Messwertspeichers. Der Service beantwortet die
statistischen Abfragen des Frontends (Zeitreihen, Kennzahlen, Regression,
Verteilungen, Live-Werte) direkt aus TimescaleDB und wertet parallel dazu den
Messwertstrom aus Kafka gegen Schwellwert- und Anomalieregeln aus. Python,
FastAPI, asyncpg, aiokafka, numpy, scipy.

| Seite                                        | Inhalt                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| [Konfiguration](konfiguration.md)            | Umgebungsvariablen mit Standardwerten                                   |
| [Abfrage-API](api.md)                        | Die `/stats`-Endpunkte, Zugriff, Auflösung, Aufrufer                    |
| [Detection](detection.md)                    | Kafka-Pipeline, Regelprojektionen, Schwellwert- und Anomalie-Auswertung |
| [Betrieb](betrieb.md)                        | Installieren, Starten, Container, Cluster, bekannte Grenzen             |
| [Kernfunktionen im Code](kernfunktionen.md)  | Die fünf wichtigsten Funktionen mit Auszug und Link in die Quelle       |

## Zwei Pfade in einem Prozess

| Pfad      | Eingang                                                              | Ausgang                                                            |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Abfrage   | HTTP `POST /stats/*` vom Frontend (über dessen BFF) und der Lastmessung | JSON aus TimescaleDB, Aggregation soweit möglich in SQL         |
| Detection | Kafka `measurement.ingested`                                         | Kafka `threshold.breached` und `anomaly.detected`                  |

Beide Pfade teilen sich den Prozess, sonst nichts. Der Abfragepfad liest den
Messwertspeicher, der Detection-Pfad liest ihn nie. Er arbeitet nur auf dem
Strom und auf drei compacted Konfigurations-Topics.

## Schnittstellen

| Richtung  | Kanal                                                          | Inhalt                                                                   |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ein       | HTTP `/stats/**` auf Port 8100                                 | Statistik- und Live-Abfragen mit dem HS256-Token von core                |
| ein       | Kafka `measurement.ingested`                                   | Messwert-Batches vom ingestion-service                                   |
| ein       | Kafka `rule.configured`, `anomaly-rule.configured` (compacted) | Regelkonfiguration von core                                              |
| ein       | Kafka `device.configured` (compacted)                          | Signal-Map und Standortkoordinaten von device-management                 |
| aus       | Kafka `threshold.breached`, `anomaly.detected`                 | Detection-Events für core und notification-service                       |
| aus       | HTTP zu Open-Meteo                                             | Außentemperatur für wetterabhängige Regeln                               |
| lesen     | TimescaleDB `measurement-db`                                   | Messwerte, alleiniger Leser                                              |
| lesen     | PostgreSQL `stammdaten-db`                                     | Messpunkt-Registry und Mitgliedschaften für die Mandantenprüfung         |
| schreiben | PostgreSQL `stammdaten-db`, Tabelle `access_audit`             | Abgelehnte mandantenfremde Zugriffe, bewusste Abweichung                 |

## Was beim Start passiert

1. Zwei Verbindungspools, einer zum Messwertspeicher, einer zur Stammdaten-DB.
2. Wenn Kafka aktiv ist, legt der Service seine beiden Ausgangs-Topics an,
   startet den Producer und spielt die drei compacted Topics vollständig in
   den Speicher.
3. Der Consumer in der Gruppe `analytics` beginnt, die Anomalie-Engine startet
   ihren Auswertungstakt.
4. `/health` antwortet, sobald die App läuft. Ohne erreichbaren Broker bricht
   der Start ab.

## Module

| Pfad                    | Zuständigkeit                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `main.py`               | App, Lifespan, Router-Registrierung mit den Auth-Abhängigkeiten                            |
| `config.py`             | Alle Einstellungen als pydantic-Settings                                                   |
| `auth.py`, `tenancy.py` | Token-Prüfung und Mandantenprüfung auf den IDs im Body                                     |
| `db/`                   | Pools und die SQL-Abfragen mit `time_bucket`                                               |
| `routers/`              | Je Endpunktfamilie ein Router, alle unter `/stats`                                         |
| `detection/`            | Runner, Consumer, compacted Stores, Schwellwert-Evaluator, Anomalie-Engine, Wetter, Publisher |
| `proto_gen/`            | Aus `apis/proto` generierter Protobuf-Code, liegt fertig im Repository         |
| `models/`               | Pydantic-Modelle der älteren Endpunkte                                                     |
