# core-platform

Stammdaten und Zugriff der Plattform. Der Service verwaltet das Objektmodell
als Graph (Objekte, Links, Typen), Mandanten, Nutzer und Rollen, stellt die
Authentifizierung mit selbst ausgestellten JWTs und die REST-API für das
Frontend bereit, besitzt das Stammdaten-Schema und publiziert die
Regelkonfiguration als Kafka-Projektion. Java 21, Spring Boot 4, Spring
Security, Spring Data JPA, Flyway, Spring Kafka.

| Seite                                        | Inhalt                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| [Konfiguration](konfiguration.md)            | Umgebungsvariablen, Profile, optionale Integrationen                    |
| [REST-API](api.md)                           | Anmeldung, Endpunktfamilien, Fehlerformat, gRPC                         |
| [Mandanten und Sicherheit](mandanten.md)     | Rollen, zentrale Mandantenautorisierung, Zugriffs-Audit, Datenschutz    |
| [Kafka-Events](events.md)                    | Konsumierte und publizierte Topics, Projektionen, Dead Letter           |
| [Betrieb](betrieb.md)                        | Bauen, Testen, Datenbank, Container, bekannte Grenzen                   |
| [Kernfunktionen im Code](kernfunktionen.md)  | Die fünf wichtigsten Funktionen mit Auszug und Link in die Quelle       |

## Schnittstellen

| Richtung      | Kanal                                                       | Inhalt                                                                                  |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ein           | REST `/api/v1/**` auf Port 8080                             | Frontend (über dessen BFF), Skripte, n8n                                                |
| ein           | Kafka `measurement.ingested`                                | Messwert-Batches vom ingestion-service                                                  |
| ein           | Kafka `threshold.breached`, `anomaly.detected`              | Detection-Events vom analytics-service                                                  |
| ein           | Kafka `device.discovered`                                   | Unbekannte Geräte vom device-management                                                 |
| aus           | Kafka `rule.configured`, `anomaly-rule.configured` (compacted) | Regelkonfiguration für den analytics-service                                         |
| aus           | HTTP zu device-management                                   | Proxy für MQTT-Discovery-Sitzungen                                                      |
| aus, optional | n8n-Webhooks, Google Cloud Storage                          | KI-Funktionen, SVG-Icons                                                                |
| beides        | PostgreSQL `stammdaten-db`                                  | Besitzer des Schemas, geteilt mit notification-service, gelesen von device-management   |
| nur lesen     | TimescaleDB `measurement-db`                                | Ausschließlich das privacy-Paket für den DSGVO-Export                                   |
| intern        | gRPC auf Port 9090                                          | Site- und Asset-Service, nur vom eigenen REST-Gateway genutzt                           |

Core liest keine Zeitreihen. Was es über aktuelle Werte weiß, kommt aus dem
`measurement.ingested`-Strom und liegt als In-Memory-Projektion vor. Reihen und
Statistiken holt das Frontend beim analytics-service.

## Was beim Start passiert

1. Flyway repariert und migriert das Stammdaten-Schema. Baseline ist 0, weil
   notification-service dieselbe Datenbank migriert.
2. Die eigenen Kafka-Topics werden angelegt. Ohne erreichbaren Broker bricht
   der Start ab (fail-fast), der Pod startet neu, bis Kafka da ist.
3. Der lokale Admin (`admin@local`) und optional der n8n-Service-Nutzer werden
   angelegt, falls sie fehlen.
4. Die Kafka-Listener starten in der Consumer-Group `core-platform`. Beim
   allerersten Start ab dem aktuellen Ende, danach ab dem committeten Offset.
5. Die Regel-Projektionen publizieren nach 2 Sekunden den vollständigen Stand
   und laufen danach alle 30 Sekunden.

Bereit ist der Service, wenn `/actuator/health` antwortet.

## Pakete

| Paket                                                                     | Zuständigkeit                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `user`, `tenant`, `invitation`                                            | Nutzer, Login, Mandanten, Einladungen, Rollen                                    |
| `tenancy`, `audit`                                                        | Zentrale Mandantenautorisierung und Zugriffs-Audit                               |
| `ontology`, `site`, `space`, `asset`, `metricpoint`, `physicalquantity`   | Objektmodell als Graph, Registry der Typen, Messpunkte                           |
| `device`                                                                  | Gerätezuordnung an Objekte, Discovery-Proxy, Registry unbekannter Geräte         |
| `thresholdrule`, `anomalyrule`                                            | Regel-CRUD und Projektion nach Kafka                                             |
| `measurement`                                                             | Kafka-Consumer, Latest-Value-Projektion, Auflösung von Messpunkten zu Kanälen    |
| `project`, `dashboard`, `analysis`, `kpiformula`, `derivedproperty`, `event` | Projekte, Dashboards, Analysen, KPI-Formeln, Ereignisprotokoll                |
| `privacy`                                                                 | DSGVO-Auskunft und -Löschung                                                     |
| `fleet`                                                                   | Flottenübersicht aus Telemetriefrische                                           |
| `common`                                                                  | Security, Kafka, gRPC, Flyway, REST-Gateway, Fehlerbehandlung                    |
