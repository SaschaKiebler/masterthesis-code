# Kafka-Events

Core konsumiert in der Consumer-Group `core-platform`. Schlüssel und Nutzlast
sind Byte-Arrays, die Nutzlast wird als Protobuf aus `apis/proto` dekodiert.
Beim allerersten Start beginnt die Gruppe am aktuellen Ende (`latest`), danach
am committeten Offset. Topics werden nie automatisch angelegt, jeder Besitzer
legt seine eigenen an.

## Topics

| Topic                                                                       | Richtung       | Besitzer           | Verarbeitung in core                                                              |
| --------------------------------------------------------------------------- | -------------- | ------------------ | --------------------------------------------------------------------------------- |
| `measurement.ingested`                                                      | ein            | core               | `MeasurementBatchListener`. Erst die Latest-Value-Projektion, dann die KPI-Formeln |
| `threshold.breached`, `anomaly.detected`                                    | ein            | analytics-service  | `DetectionEventsListener`. Jede Erkennung wird eine Zeile in `events`             |
| `device.discovered`                                                         | ein            | device-management  | `DeviceDiscoveredListener`. Upsert in `discovered_devices` für die Inbetriebnahme |
| `rule.configured`                                                           | aus, compacted | core               | `ThresholdRuleConfigProjection`, Key ist die Regel-ID                             |
| `anomaly-rule.configured`                                                   | aus, compacted | core               | `AnomalyRuleConfigProjection`, gleicher Mechanismus                               |
| `measurement.ingested.dlq`, `threshold.breached.dlq`, `anomaly.detected.dlq` | aus            | core               | Dead Letter der eigenen Subscriptions                                             |

## Regel-Projektionen

Core besitzt die Regelkonfiguration, der analytics-service wertet aus. Damit
der Evaluator keine Registry lesen muss, publiziert core jede aktive Regel als
Snapshot in ein compacted Topic, mit Geräte-ID und Metrik-ID aus dem Messpunkt
schon denormalisiert.

- Ein Sweep läuft 2 Sekunden nach dem Start und danach alle 30 Sekunden. Jede
  Änderung über die API stößt zusätzlich sofort einen Sweep an.
- Der Sweep vergleicht einen Fingerprint je Regel mit dem zuletzt
  publizierten Stand und sendet nur Änderungen. Gelöschte oder deaktivierte
  Regeln bekommen einen Tombstone.
- Der erste Sweep nach einem Neustart publiziert alles einmal, weil die
  Fingerprints nur im Speicher liegen.

## Detection-Events

Der `DetectionEventsListener` bildet die gemeinsame Envelope aus
`apis/proto/detection/v1/` auf die Ereignistabelle ab. Das Ereignis hängt am
übergeordneten Objekt des Messpunkts (eingehender `HAS_METRIC`-Link), der
Mandant kommt aus der Envelope oder ersatzweise aus dem Messpunkt.

| Quelle                                          | Ereignistyp        |
| ----------------------------------------------- | ------------------ |
| `anomaly.detected`                              | `FAULT`            |
| `threshold.breached` mit Operator `CHANGED_TO…` | `STATE_CHANGE`     |
| `threshold.breached` sonst                      | `THRESHOLD_BREACH` |

## Latest-Value-Projektion

`LatestValueProjection` hält je Kanal (`device_id`, `metric_id`) den jüngsten
Wert und je Gerät den letzten Zeitstempel im Speicher. Sie speist die
KPI-Auswertung, `/projects/{id}/latest-values` und die Gesundheitsstufen der
Flotte (bis 2 Stunden online, bis 24 Stunden veraltet, darüber offline,
ein Standort nach 48 Stunden offline). Nach einem Neustart ist sie leer.

## KPI-Formeln

`KpiFormulaEvaluator` läuft auf dem Listener-Thread. Formeln mit direkter
Bindung rechnen, sobald einer ihrer Messpunkte im Batch auftaucht. Formeln
mit Graph-Traversierung rechnen bei jedem Batch, aber höchstens alle 60
Sekunden. Ein Scheduler rechnet zusätzlich alle 30 Sekunden als Rückfallebene.

## Fehlerbehandlung

Der `DefaultErrorHandler` versucht einen Datensatz zweimal mit einer Sekunde
Abstand erneut und schreibt ihn dann in das Dead-Letter-Topic, in dieselbe
Partition. Nicht dekodierbares Protobuf (`IllegalArgumentException`)
überspringt die Wiederholungen. Fehler in der fachlichen Verarbeitung (KPI,
Ereignis anlegen) werden dagegen gefangen und geloggt, der Offset wird
committet.
