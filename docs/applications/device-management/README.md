# device-management

Besitzt den Geräte-Lebenszyklus am Broker. Der Service hält neben dem
ingestion-service als einziger Dienst eine Verbindung zum MQTT-Broker,
publiziert die Sollkonfiguration jedes Geräts als compacted Kafka-Topic,
meldet unbekannte Geräte und stellt Sniffing-Sitzungen für die
Inbetriebnahme bereit. Java 21, Spring Boot 4, Spring Kafka, Spring JDBC,
Eclipse Paho.

| Seite                                        | Inhalt                                                              |
| -------------------------------------------- | ------------------------------------------------------------------- |
| [Konfiguration](konfiguration.md)            | Umgebungsvariablen und Properties                                   |
| [Kafka-Events](events.md)                    | Projektion `device.configured`, Watcher und `device.discovered`     |
| [Discovery-API](api.md)                      | Sniffing-Sitzungen für die Inbetriebnahme, von core durchgereicht   |
| [Betrieb](betrieb.md)                        | Bauen, Starten, Container, Cluster, bekannte Grenzen                |
| [Kernfunktionen im Code](kernfunktionen.md)  | Die fünf wichtigsten Funktionen mit Auszug und Link in die Quelle   |

## Drei Aufgaben

| Aufgabe                    | Quelle                                                                    | Ziel                                                              |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Konfigurations-Projektion  | `physical_devices`, `metric_points`, `objects`, `links` in der Stammdaten-DB | Kafka `device.configured`, compacted, Key ist die Geräte-ID    |
| Broker-Watcher             | Alle MQTT-Nachrichten über den Filter `#`                                 | Kafka `device.discovered` für Geräte ohne Konfiguration           |
| Discovery-Sitzungen        | Derselbe MQTT-Strom, gefiltert auf ein Gerät                              | REST für core, das die Sitzungen für die Oberfläche durchreicht   |

Die Projektion ist der Grund, warum der ingestion-service keine Datenbank
liest. Sie zieht das Polling der Gerätekonfiguration aus dem heißen Pfad zum
Besitzer der Konfiguration, wo es alle 30 Sekunden abseits der Daten läuft.

## Schnittstellen

| Richtung | Kanal                                            | Inhalt                                                                                   |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ein      | MQTT, Filter `#` mit QoS 0                       | Jede Nachricht am Broker, eine Subscription, Verteilung an registrierte Handler          |
| ein      | PostgreSQL `stammdaten-db`, nur lesend           | Geräte, Messpunkte, Objekte und Links, Schema gehört core                                |
| ein      | HTTP `/api/v1/device-discovery` auf Port 8082    | Sitzungen anlegen, abfragen, stoppen, auswerten. Intern, ohne Authentifizierung          |
| aus      | Kafka `device.configured` (compacted)            | Sollkonfiguration je Gerät für ingestion-service und analytics-service                   |
| aus      | Kafka `device.discovered`                        | Unbekannte Geräte für die Registry in core                                               |

Beide Topics legt der Service selbst an. Ohne erreichbaren Kafka-Broker
bricht der Start ab (fail-fast), der Pod startet neu, bis Kafka da ist.

## Was beim Start passiert

1. Kafka-Topics anlegen, Datenbankverbindung aufbauen.
2. Nach dem `ApplicationReadyEvent` verbindet sich der Service mit dem
   MQTT-Broker und abonniert `#`. Danach hängt sich der Watcher an den Strom.
3. Zwei Sekunden nach dem Start läuft der erste Sweep der Projektion und
   publiziert jede Konfiguration einmal. Erst danach vertraut der Watcher
   seiner Liste bekannter Geräte.
4. Der ingestion-service wartet auf genau dieses Topic, deshalb muss
   device-management vor ihm laufen.

## Module

| Paket        | Zuständigkeit                                                                      |
| ------------ | ---------------------------------------------------------------------------------- |
| `config`     | Properties und die beiden `NewTopic`-Beans                                         |
| `mqtt`       | Geteilte Broker-Verbindung mit Handler-Registrierung                               |
| `projection` | Sweep, SQL, Koordinaten aus dem Ontologie-Graph, Fingerprints, Tombstones          |
| `watcher`    | Geräte-ID aus dem Topic, Drosselung, `device.discovered`                           |
| `discovery`  | Sitzungen, Filter je Gerät, Auswertung der Nutzlasten, REST                        |
