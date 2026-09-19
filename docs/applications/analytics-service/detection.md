# Detection

Der Service besitzt die Auswertung auf dem Messwertpfad. Core besitzt die
Regeln und publiziert sie als compacted Topics, analytics spielt sie in den
Speicher und wertet jeden Messwert dagegen aus. Findings verlassen den Service
als `DetectionEvent` auf `threshold.breached` und `anomaly.detected`. Core
nimmt sie als Ereignisse auf, notification-service als Meldungen.

## Topics

| Topic                       | Richtung       | Besitzer           | Rolle                                                              |
| --------------------------- | -------------- | ------------------ | ------------------------------------------------------------------ |
| `measurement.ingested`      | ein            | core               | Messwert-Batches, Consumer-Group `analytics`                       |
| `rule.configured`           | ein, compacted | core               | Schwellwertregeln, Key ist die Regel-ID                            |
| `anomaly-rule.configured`   | ein, compacted | core               | Anomalieregeln als Template-Instanzen mit Kanal-Bindungen          |
| `device.configured`         | ein, compacted | device-management  | Signal-Map und Standortkoordinaten je Gerät                        |
| `threshold.breached`        | aus            | analytics          | Findings des Schwellwert-Evaluators                                |
| `anomaly.detected`          | aus            | analytics          | Findings der Anomalie-Engine                                       |
| `measurement.ingested.dlq`  | aus            | core               | Nicht dekodierbare Batches, unverändert weitergereicht             |

Die beiden Ausgangs-Topics legt der Service beim Start selbst an. Auf die
Eingangs-Topics wartet er, bis ihr Besitzer sie angelegt hat.

## Ablauf je Batch

1. Der Consumer dekodiert den `MeasurementBatch`. Scheitert das, geht die
   Nachricht unverändert in die DLQ und der Offset wird committet.
2. Je Messwert fragt der Schwellwert-Evaluator die Regeln des Kanals ab und
   publiziert je ausgelöster Regel ein Event.
3. Derselbe Messwert geht als Beobachtung an die Anomalie-Engine, die nur
   puffert.
4. Der Offset wird nach der Auswertung committet, auch wenn die Auswertung
   eine Ausnahme geworfen hat. Sie wird geloggt, der Consumer bleibt nie an
   einem Batch hängen.

## Compacted Stores

`CompactedStore` ist die gemeinsame Basis der drei Projektionen. Beim Start
weist sich der Consumer alle Partitionen zu, liest ab dem Anfang bis zu den
End-Offsets und blockiert solange. Danach folgt ein Hintergrund-Task dem
Topic. Ein Datensatz ohne Wert ist ein Tombstone und entfernt den Schlüssel.
Das ist derselbe Mechanismus wie im ingestion-service für `device.configured`.

| Store              | Hält                                              | Zugriff                                 |
| ------------------ | ------------------------------------------------- | --------------------------------------- |
| `RuleStore`        | Schwellwertregeln je Kanal und je ID              | `rules_for(device_id, metric_id)`       |
| `AnomalyRuleStore` | Anomalieregeln mit Bindungen und Parametern       | `all()`, `referenced_channels()`        |
| `DeviceStore`      | Signal-Map und Koordinaten je Gerät               | `coordinates(device_id)` mit Fallback   |

## Schwellwertregeln

`ThresholdEvaluator` hält je Regel den letzten Auslösezeitpunkt (Cooldown)
und je Kanal den letzten Wert. Beides ist nach einem Neustart leer.

| Operator                     | Feuert wenn                                |
| ---------------------------- | ------------------------------------------ |
| `GT`, `GTE`, `LT`, `LTE`     | Wert gegen `threshold`                     |
| `CHANGED_TO_TRUE`            | Vorwert bis 0,5 und Wert über 0,5          |
| `CHANGED_TO_FALSE`           | Vorwert über 0,5 und Wert bis 0,5          |

Zustandswechsel brauchen einen bekannten Vorwert, der erste Messwert nach dem
Neustart feuert daher nie. Das Detail-JSON ist mit dem früheren Evaluator in
core formatkompatibel, weil das Frontend es liest.

## Anomalie-Engine

Die Engine wertet nicht je Messwert aus, sondern im Takt von
`WEATHER_EVAL_INTERVAL_SECONDS` (300 s). `observe` puffert nur Kanäle, die
irgendeine Regel bindet, in einer Deque je Kanal, beschnitten auf das größte
Fenster aller Regeln (mindestens eine Stunde). Je Regel gilt ein Cooldown
(Standard 1800 s) und optional eine Bindung `suppress_while`, die bei einem
Wert über 0,5 die Auswertung unterdrückt.

| Template                  | Bindungen                  | Bedingung                                                                                          |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| `short_cycle`             | `switch`                   | Startflanken je Stunde über `base_per_hour + max(0, 15 - t_out) * per_degree`                      |
| `weather_heating`         | `switch`, optional `flow`  | Außentemperatur ab `t_warm_c` und Einschaltdauer über `min_duty` oder Vorlauf über `min_flow_c`    |
| `actuator_without_demand` | `demand`, `actuator`       | Anforderung unter `max_demand_duty` bei Aktor über `min_actuator_duty`                             |
| `condition`               | beliebige Rollen           | Baum aus `all` und `any` über Aggregate (`mean`, `min`, `max`, `last`, `duty`, `edges_per_hour`) oder `t_out` |

Ein Aggregat braucht mindestens zwei Werte im Fenster, sonst gilt die Regel
als nicht auswertbar und schweigt. Die Außentemperatur kommt von Open-Meteo
an den Koordinaten des Standorts aus `device.configured`, gecacht je
gerundeter Koordinate für 15 Minuten. Schlägt die Abfrage fehl, wird die
Regel übersprungen, es gibt keine Ersatzwerte.

## Event-Envelope

Beide Detektoren füllen dieselbe Nachricht aus `apis/proto/detection/v1/`.

| Feld                 | Inhalt                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `type`               | Name des Topics                                                                                     |
| `severity`           | Aus der Regel, `INFO` bis `CRITICAL`                                                                |
| `channel`            | `device_id` und `metric_id`, die Geräte-ID ist auch der Kafka-Key                                   |
| `asset_ref`          | Messpunkt-ID der Regel, bei Anomalien die der ersten Bindung                                        |
| `tenant_id`          | Aus der Regel, damit Konsumenten keine Registry brauchen                                            |
| `summary`, `detail`  | Einzeiler und JSON mit Wert, Schwelle und Operator beziehungsweise Detektor und Regelname          |
| `detected_at`        | Zeitpunkt der Auswertung                                                                            |

Publizieren ist Fire-and-forget. Ein Fehler wird geloggt und hält die
Auswertung nicht an.
