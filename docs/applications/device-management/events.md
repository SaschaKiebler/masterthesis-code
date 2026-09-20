# Kafka-Events

Der Service besitzt beide Geräte-Topics und legt sie beim Start an. Die
Nutzlasten sind Protobuf aus `apis/proto/device/v1/`, der Key ist immer die
Geräte-ID.

| Topic                | Art                                                          | Konsumenten                                                                              |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `device.configured`  | compacted, Snapshot je Gerät, Tombstone beim Verschwinden    | ingestion-service (Gate und Signal-Map), analytics-service (Signal-Map und Koordinaten)  |
| `device.discovered`  | Ereignis je Sichtung, gedrosselt                             | core (Tabelle `discovered_devices` für die Inbetriebnahme)                               |

## Projektion `device.configured`

Ein Sweep läuft zwei Sekunden nach dem Start und danach alle 30 Sekunden.

1. Eine Abfrage liest alle Geräte mit ihren Messpunkten. Freigegeben ist ein
   Gerät, solange `decommissioned_at` leer ist. Je Messpunkt entsteht ein
   Signal-Map-Eintrag mit `metric_id`, Anzeigename aus dem Objekt, Einheit,
   `source`, `field` sowie `min` und `max`.
2. Eine zweite, rekursive Abfrage sucht je Gerät den nächsten Standort mit
   Koordinaten. Sie geht vom Gerät zum Asset (`REALIZED_BY`), dann über
   `INSTALLED_AT` und `INSTALLED_IN` nach oben und die `CONTAINS`-Kette
   hinauf, höchstens sechs Ebenen. Das erste Objekt mit `latitude` und
   `longitude` in `properties.custom` oder `properties.attributes` gewinnt,
   auch mit Dezimalkomma.
3. Über den Inhalt jedes Snapshots (ohne `updated_at`) wird ein Fingerprint
   gebildet. Nur was sich gegenüber dem letzten Sweep geändert hat, wird
   gesendet.
4. Geräte, die aus der Datenbank verschwunden sind, bekommen einen Tombstone.

Die Koordinaten fließen in den Fingerprint, eine Standortänderung publiziert
das Gerät also von selbst neu. Einen Sofort-Sweep bei Änderungen gibt es
nicht, weil core die Tabellen schreibt und nicht dieser Service. Eine neue
Konfiguration braucht daher bis zu 30 Sekunden, bis der ingestion-service
sie annimmt.

| Feld in `DeviceConfig`             | Quelle                                                     |
| ---------------------------------- | ---------------------------------------------------------- |
| `device_id`, `protocol`            | `physical_devices`                                         |
| `accepted`                         | `decommissioned_at IS NULL`                                |
| `signals[]`                        | `metric_points` mit Anzeigename aus `objects`              |
| `site_latitude`, `site_longitude`  | Nächstes Objekt mit Koordinaten im Graph, sonst nicht gesetzt |
| `updated_at`                       | Zeitpunkt der Publikation                                  |

## Watcher `device.discovered`

Der Watcher hängt an derselben Broker-Verbindung wie die Discovery-Sitzungen
und sieht jede Nachricht.

1. Bis der erste Sweep durch ist, tut er nichts, weil „unbekannt“ vorher
   nicht belastbar ist.
2. Aus dem Topic wird die Geräte-ID gezogen, nach denselben Konventionen wie
   im ingestion-service. Shelly `<id>/status/…` und `<id>/events/…`, Tasmota
   `tele/<id>/…` und `stat/<id>/…`, sonst das erste Segment. Topics mit `$`
   am Anfang werden ignoriert.
3. Ist das Gerät in der Projektion bekannt, passiert nichts.
4. Sonst wird es höchstens einmal je Drosselfenster gemeldet, mit Topic und
   den ersten 512 Zeichen der Nutzlast als Probe.

| Feld in `DeviceDiscovered`        | Inhalt                                |
| --------------------------------- | ------------------------------------- |
| `device_id`                       | Aus dem Topic                         |
| `protocol`                        | Immer `MQTT`                          |
| `sample_topic`, `sample_payload`  | Hinweis für die Template-Erstellung   |
| `seen_at`                         | Zeitpunkt der Sichtung                |

Die Drosselung lebt im Speicher. Nach einem Neustart wird jedes unbekannte
Gerät einmal erneut gemeldet.
