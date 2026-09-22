# Heizungsmonitoring-Plattform

Prototyp zur Masterarbeit *Entwurf und Bewertung einer Referenzarchitektur für
Heizungsmonitoring-Plattformen*. Das
Repository enthält die Implementierung der in der Arbeit hergeleiteten
Architektur als polyglotte Microservice-Plattform sowie den Messaufbau, mit dem
sie in Kapitel 6 der Arbeit bewertet wird.

## Einstieg

- [Schnellstart](docs/quickstart.md). Nur die Befehle, um den Stack lokal oder
  in Google Cloud zum Laufen zu bringen.
- [Lokal ausführen](docs/local-development.md). Was installiert sein muss, wie
  der gesamte Stack mit einem Skript startet und wie Telemetrie erzeugt wird.
- [Deployment in Google Cloud](docs/deployment-gcloud.md). Was gebraucht wird,
  wie Images gebaut werden und wie der Cluster hoch- und wieder runtergefahren wird.
- [Infrastruktur und Skripte](docs/infrastructure.md). Was Terraform anlegt,
  was im Cluster läuft und was die Skripte der Reihe nach tun.
- [Messaufbau der Evaluation](evaluation/README.md). Welche Lastszenarien
  gemessen werden, welche Testdaten sie verwenden und wie ein Messlauf
  gestartet und nachvollzogen wird.

## Was liegt wo

| Ordner            | Inhalt                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `applications/`   | Die Services der Plattform, je ein Unterordner (siehe unten)                                                            |
| `apis/`           | Protobuf-Schemata der Kafka-Events und Service-Schnittstellen                                                           |
| `docker/`         | Compose-Stack für die lokale Infrastruktur (Kafka, Mosquitto, PostgreSQL, TimescaleDB)                                  |
| `docs/`           | Diese Dokumentation, Architekturdiagramm und [Event-Katalog](docs/architecture/events.md), je Service eine Detaildoku   |
| `evaluation/`     | Messaufbau der Evaluation, Lastszenarien und Ergebnisse, siehe [evaluation/README.md](evaluation/README.md)             |
| `infrastructure/` | Terraform und Kustomize für die GKE-Umgebung, siehe [docs/infrastructure.md](docs/infrastructure.md) und [infrastructure/README.md](infrastructure/README.md) |
| `scripts/`        | `dev.sh` für den lokalen Stack                                                                                          |

## Services

| Service              | Technologie            | Aufgabe                                                                                   | Doku                                                   |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| core-platform        | Java 21, Spring Boot   | Stammdaten und Objektmodell, Authentifizierung, API für das Frontend, Schema-Migration    | [docs](docs/applications/core-platform/README.md)               |
| device-management    | Java 21, Spring Boot   | Inbetriebnahme der Geräte, Gerätekonfiguration als Event, Erkennung unbekannter Geräte    | [docs](docs/applications/device-management/README.md)           |
| ingestion-service    | Rust                   | Nimmt Telemetrie per MQTT entgegen, parst die Gerätenutzlasten, schreibt Messwerte        | [docs](docs/applications/ingestion-service/README.md)           |
| analytics-service    | Python, FastAPI        | Schwellwert- und Anomalie-Erkennung, Statistik-Endpunkte auf dem Messwertspeicher         | [docs](docs/applications/analytics-service/README.md)           |
| notification-service | Java 21, Spring Boot   | Meldungen und Benachrichtigungsregeln, Webhook-Zustellung                                 | [docs](docs/applications/notification-service/README.md)        |
| frontend             | TypeScript, Next.js    | Web-Oberfläche                                                                            | [docs](docs/applications/frontend/README.md)                    |
| mock-service         | Python                 | Simulierte Geräteflotte für Funktionstests und Lastmessung, ersetzt das Edge-Gerät        | [docs](docs/applications/mock-service/README.md)                |
| simulation-engine    | Python                 | Vorgesehen für den digitalen Zwilling, noch nicht implementiert                           | keine                                                  |

Die Services kommunizieren über Kafka-Events, die Geräte liefern über MQTT an.
Welche Topics es gibt, wem sie gehören und was bewusst kein Topic bekommt,
steht im [Event-Katalog](docs/architecture/events.md). Stammdaten liegen in
PostgreSQL, Messwerte in TimescaleDB.
