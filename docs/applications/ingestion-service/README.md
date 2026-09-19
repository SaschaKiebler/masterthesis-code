# ingestion-service

Nimmt die Telemetrie der Geräte per MQTT entgegen, übersetzt sie anhand der
Gerätekonfiguration in Messwerte, schreibt sie in den Messwertspeicher und
meldet jeden geschriebenen Batch als Kafka-Event. Geschrieben in Rust mit
tokio, rumqttc, rdkafka und tokio-postgres.

| Seite                                   | Inhalt                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| [Konfiguration](konfiguration.md)       | Alle Umgebungsvariablen mit Standardwerten                |
| [Protokolle und Parsing](protokolle.md) | Topic-Routing, Signal-Map, Zeitstempel                    |
| [Betrieb](betrieb.md)                   | Bauen, Testen, Container, Skalierung, bekannte Grenzen    |
| [Kernfunktionen im Code](kernfunktionen.md) | Die wichtigsten Funktionen mit Erklärung|

## Schnittstellen

| Richtung | Kanal                                          | Inhalt                                                                          |
| ----------| ------------------------------------------------| ---------------------------------------------------------------------------------|
| ein      | MQTT, Standardfilter `#`                       | Rohe Gerätenachrichten (Shelly Gen2, Tasmota, generisches JSON)                 |
| ein      | Kafka `device.configured` (compacted)          | Freigabe und Signal-Map je Gerät, publiziert von device-management              |
| aus      | TimescaleDB `measurements`, `ingestion_errors` | Ein INSERT je Messwert, Fehler mit Rohnutzlast                                  |
| aus      | Kafka `measurement.ingested`                   | `MeasurementBatch` (Protobuf) je verarbeiteter Nachricht, Key ist die Geräte-ID |

Der Service liest nie aus einer Datenbank. Alles, was er über Geräte wissen
muss, kommt aus der Kafka-Projektion. Er legt auch keine Topics an,
`device.configured` gehört device-management und `measurement.ingested`
gehört core-platform. Die Verträge liegen unter `apis/proto/device/v1/` und
`apis/proto/core/v1/`.

## Verarbeitung einer Nachricht

1. Die Event-Loop nimmt die Nachricht vom Broker und stempelt `received_at`.
   Das ist der Systemeingang, ab dem die Evaluation die Ingest-Latenz misst.
2. Ein eigener Task übernimmt die Nachricht, die Loop bleibt frei.
3. Das Topic bestimmt die Route (Shelly, Tasmota, generisch) und damit die Geräte-ID.
4. Gate. Ist das Gerät in der Projektion nicht als `accepted` bekannt, wird die
   Nachricht mit einem Log-Eintrag verworfen. Kein Fehler, keine Datenbankzeile.
5. Die Signal-Map des Geräts bestimmt, welche JSON-Felder zu welcher `metric_id` werden.
6. Der Zeitstempel kommt aus der Nutzlast, wenn sie einen trägt, sonst ist es `received_at`.
7. Jeder Messwert wird einzeln in `measurements` geschrieben. `persisted_at` setzt die Datenbank.
8. Nach dem letzten INSERT geht ein `MeasurementBatch` nach Kafka. Schlägt das
   fehl, bleibt es bei einer Warnung, die Datenbank ist die Wahrheit.

Ungültiges JSON, eine Signal-Map ohne passenden Eintrag, ein Topic ohne Route
und Datenbankfehler landen mit Rohnutzlast und Fehlermeldung in `ingestion_errors`.

## Start

Der Service ist erst nach vier Schritten empfangsbereit.

1. Konfiguration aus Umgebungsvariablen und optionaler `.env`.
2. Verbindungspool zum Messwertspeicher, geprüft mit `SELECT 1`. Ohne Datenbank startet der Service nicht.
3. Kafka-Producer. Er verbindet sich erst bei Bedarf, Kafka darf noch hochfahren.
4. Replay von `device.configured`. Wartet, bis das Topic existiert, liest alle
   Partitionen von Anfang bis zur High Watermark in eine In-Memory-Map und folgt
   danach live. Erst dann verbindet sich der Service mit dem MQTT-Broker.

Der Übergang ist im Log an der Zeile `Device-config replay complete` erkennbar.

## Module

| Datei                                        | Zuständigkeit                                                    |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `src/main.rs`                                | Startreihenfolge                                                 |
| `src/config.rs`                              | Umgebungsvariablen, Client-ID je Instanz, Verbindungsbudget      |
| `src/mqtt.rs`                                | Broker-Verbindung, Topic-Filter, Routing, Fehlerbehandlung       |
| `src/device_state.rs`                        | Projektion von `device.configured` (Replay und Live-Follow)      |
| `src/parser/mod.rs`                          | Messwert-Struktur, Auflösung des Zeitstempels                    |
| `src/parser/shelly.rs`                       | Shelly-Topics und die gemeinsame Signal-Map-Extraktion           |
| `src/parser/tasmota.rs`, `src/parser/generic.rs` | Tasmota- und generische Topics                               |
| `src/db.rs`                                  | Pool und die beiden INSERTs                                      |
| `src/publisher.rs`                           | Kafka-Producer für `measurement.ingested`                        |
| `src/proto.rs`, `build.rs`                   | Aus `apis/proto` generierter Protobuf-Code                       |

Tests liegen neben den Modulen in `*_tests.rs`.
