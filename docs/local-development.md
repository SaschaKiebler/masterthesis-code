# Lokal ausführen

Der gesamte Stack läuft auf einem Entwicklerrechner. Die Infrastruktur kommt
aus Docker, die Services starten nativ aus ihren Quellordnern. Ein Skript
übernimmt Reihenfolge und Wartezeiten.

## Voraussetzungen

| Werkzeug        | Version       | Wofür                                                   |
| --------------- | ------------- | ------------------------------------------------------- |
| Docker + Compose | aktuell      | Kafka, Mosquitto, PostgreSQL, TimescaleDB               |
| JDK             | 21            | core-platform, device-management, notification-service  |
| Rust (cargo)    | ab 1.90       | ingestion-service, dazu `protoc` und `cmake`            |
| Python          | ab 3.10       | analytics-service, mock-service                         |
| Node.js + npm   | ab 20         | frontend                                                |
| bash            | ab 3.2        | `scripts/dev.sh`                                        |

Konfigurationsdateien sind nicht nötig. Alle Services haben Standardwerte, die
auf den Compose-Stack zeigen. Eine `.env` im Ordner eines Services überschreibt
sie und wird vom Skript beim Start geladen.

## Starten

```bash
scripts/dev.sh up
```

Das Skript startet die Docker-Infrastruktur, wartet auf die Datenbanken und
bringt danach die Services hoch. Beim ersten Lauf legt es die Python-Umgebung
für den analytics-service an und installiert die Frontend-Abhängigkeiten. Der
erste Start dauert einige Minuten, weil Gradle und Cargo die Abhängigkeiten
auflösen.

| Komponente           | Adresse                 |
| -------------------- | ----------------------- |
| Frontend             | http://localhost:3000   |
| core-platform        | http://localhost:8080   |
| device-management    | http://localhost:8082   |
| notification-service | http://localhost:8083   |
| analytics-service    | http://localhost:8100   |
| Kafka UI             | http://localhost:8081   |
| Kafka                | localhost:9092          |
| Mosquitto (MQTT)     | localhost:1883          |
| Stammdaten-DB        | localhost:5432          |
| Messwert-DB          | localhost:5433          |

Login im Frontend mit `admin@local` und Passwort `admin`.

## Telemetrie erzeugen

Nach dem Start ist die Plattform leer. Der mock-service legt eine Geräteflotte
an und publiziert deren Telemetrie per MQTT.

```bash
cd applications/mock-service
python3 -m venv .venv && .venv/bin/pip install -e .

# Flotte in der Plattform anlegen (Objekte, Geräte, Messpunkte, Regeln)
.venv/bin/mock-service seed --sites 2 --rooms 2

# Telemetrie senden, Abbruch mit Ctrl-C
.venv/bin/mock-service run --sites 2 --rooms 2 --interval 10
```

Nach dem Seed dauert es bis zu 30 Sekunden, bis device-management die
Gerätekonfiguration publiziert hat und der ingestion-service die Nachrichten
annimmt. Weitere Optionen wie Störungsinjektion und Lastskalierung beschreibt
[applications/mock-service/README.md](../applications/mock-service/README.md).

## Beobachten und stoppen

```bash
scripts/dev.sh status               # was läuft
scripts/dev.sh logs core            # core|device|notify|ingest|analytics|frontend
scripts/dev.sh down                 # Services und Docker-Infrastruktur stoppen
```

`down` behält die Datenbank-Volumes. Für einen komplett frischen Stand die
Volumes löschen und neu starten.

```bash
docker compose -f docker/docker-compose-kafka.yaml down -v
scripts/dev.sh up
```

## Wenn etwas hängt

- **Ein Service kommt nicht hoch.** Log des Services mit `scripts/dev.sh logs <name>` prüfen.
  Die Logs liegen unter `.dev/logs/`.
- **Ports sind belegt.** Ein früherer Lauf wurde nicht sauber beendet.
  `scripts/dev.sh down` räumt auch verwaiste Prozesse auf den Ports 8080, 8082 und 8083 ab.
- **Telemetrie kommt nicht an.** Der ingestion-service verwirft Nachrichten von
  Geräten, die nicht per `seed` angelegt wurden. Seed und Run müssen dieselben
  Parameter für `--prefix`, `--sites` und `--rooms` verwenden.
