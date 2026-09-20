# Seed

`mock-service seed` ersetzt die Inbetriebnahme über die Oberfläche. Es
schreibt direkt in die Stammdaten-DB, und zwar auf zwei Ebenen.

## Datenpfad

Das, was der ingestion-service braucht, um die Geräte anzunehmen.

| Tabelle             | Je      | Inhalt                                                                          |
| ------------------- | ------- | ------------------------------------------------------------------------------- |
| `tenants`           | Flotte  | Mandant „Mock Fleet“, ID aus dem Präfix                                         |
| `physical_devices`  | Gerät   | Geräte-ID, Hersteller, Modell, Protokoll `MQTT`, `commissioned_at`              |
| `metric_points`     | Metrik  | `metric_id`, `source`, `field`, Einheit, optional die physikalische Größe       |
| `threshold_rules`   | Regel   | Raumtemperatur über 28 °C, Rücklauf über 62 °C, Vorlauf über 75 °C              |
| `anomaly_rules`     | Kessel  | `short_cycle` und `weather_heating`, gebunden an den Pumpenkanal                |

Nach dem Seed dauert es bis zu 30 Sekunden, bis device-management die
Konfiguration als `device.configured` publiziert hat. Bis dahin verwirft der
ingestion-service die Nachrichten der Flotte noch.

## Objektmodell

Das, was die Oberfläche braucht, damit die Flotte in Projekt, Monitor und
Analyse erscheint.

| Objekt                      | Typ                           | Verknüpfung                                                                                          |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Projekt „Mock Fleet“        | `projects`                    | Enthält je Standort ein Gebäude                                                                      |
| Gebäude „Mock Site 001“     | `BUILDING`                    | `CONTAINS` Etage „EG“                                                                                |
| Etage                       | `FLOOR`                       | `CONTAINS` Heizraum und Räume                                                                        |
| Heizraum, Räume             | `TECHNICAL_ROOM`, `ROOM`      |                                                                                                      |
| Kessel, Raumsensor          | `BOILER`, `GENERIC_SENSOR`    | `INSTALLED_AT` Gebäude, `INSTALLED_IN` Heizraum oder Raum, `REALIZED_BY` Gerät, `HAS_METRIC` Messpunkte |
| Person (`--persons`)        | `PERSON`                      | `RESIDES_IN` Raum, mit erfundenen Kontaktdaten unter `example.org`                                   |

Die Personen sind das Referenzinventar für die Datenschutz-Prüfung
(QS-SEC-02). Person i eines Standorts wohnt in Raum `(i mod rooms) + 1`, so
erreicht jede Person über den Graph mindestens einen Sensor.

## Eigenschaften

- **Idempotent.** Alle IDs sind mit uuid5 aus Präfix und Geräte-ID
  berechnet, jede Anweisung ist ein Upsert. Ein zweiter Seed mit denselben
  Parametern ändert nichts, ein Seed nach einer Änderung aktualisiert.
- **Voraussetzung.** Objekttypen wie `BOILER` und Linktypen wie `HAS_METRIC`
  müssen existieren. Sie kommen aus den Flyway-Migrationen von core, das also
  einmal gelaufen sein muss. Fehlen sie, bricht der Seed mit einer klaren
  Meldung ab.
- **Entfernen.** `seed --remove` löscht das Projekt und alle Objekte der
  Flotte. Geräte, Messpunkte, Links und Regeln verschwinden per Kaskade, und
  device-management publiziert Tombstones für die Geräte.
- **Mehrere Mandanten.** Ein anderes `--prefix` ergibt einen anderen
  Mandanten. So entstehen in der Evaluation `tenanta` mit 25 Standorten und
  `tenantb` mit 2 Standorten.
