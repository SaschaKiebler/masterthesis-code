# Abfrage-API

Alle Endpunkte liegen unter `/stats`, nehmen `POST` mit JSON-Body entgegen und
antworten mit JSON. `GET /health` ist offen. Die interaktive Dokumentation
unter `/docs` ist abgeschaltet, solange `ANALYTICS_EXPOSE_DOCS` nicht gesetzt
ist.

## Zugriff

Jeder `/stats`-Aufruf braucht das Bearer-Token, das core beim Login
ausstellt. Der Service prüft die Signatur mit demselben Geheimnis und liest
das Subjekt. Danach prüft er, ob alle im Body adressierten Messpunkte oder
Kanäle zum Mandanten des Aufrufers gehören. Fremde Daten werden mit 403 und
`{"detail": "Access denied to another tenant's data"}` abgelehnt, ein
fehlendes oder ungültiges Token mit 401. Die Prüfung selbst ist unter
[Kernfunktionen](kernfunktionen.md) beschrieben.

## Endpunkte

Zwei Familien. Die erste adressiert Messpunkte über ihre ID und löst sie in
der Stammdaten-DB zu Kanälen auf. Die zweite bekommt die Kanäle (`device_id`,
`metric_id`) direkt vom Aufrufer, der Endpunkt selbst liest die Registry
nicht. Die Mandantenprüfung löst die Kanäle trotzdem rückwärts über die
Registry auf.

| Endpunkt                        | Body (Kern)                                                                       | Antwort                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/stats/descriptive`            | `metric_point_ids`, `time_range`                                                  | count, mean, median, std, min, max, q25, q75, iqr je Messpunkt              |
| `/stats/timeseries`             | `metric_point_ids`, `time_range`, `resample`, `aggregation`, `rolling_window`     | Gebucketete Reihen, optional gleitender Mittelwert                          |
| `/stats/difference`             | `metric_point_id_a`, `metric_point_id_b`, `time_range`                            | A minus B je Bucket                                                         |
| `/stats/regression`             | `x_metric_point_id`, `y_metric_point_id`, `time_range`, `confidence_level`        | Steigung, R², p-Wert, Streudiagramm, Konfidenzband                          |
| `/stats/boxplot`                | `metric_point_ids`, `time_range`, `group_by` (`hour`, `weekday`, `month`)         | Quartile und Ausreißer je Gruppe                                            |
| `/stats/histogram`              | `metric_point_ids`, `time_range`, `bins`                                          | Klassengrenzen und Häufigkeiten                                             |
| `/stats/heatmap`                | `metric_point_id`, `time_range`, `aggregation`                                    | Wochentag mal Stunde                                                        |
| `/stats/compute`                | `sources`, `calculations`, `time_range`                                           | Serverseitig berechnete Serien für den Chart-Builder                        |
| `/stats/latest`                 | `metric_point_ids`                                                                | Letzter Wert je Messpunkt mit Anzeigekontext (Monitor)                      |
| `/stats/ingest-rate`            | `metric_point_ids`, `window_minutes`                                              | Messwerte je Minute im Fenster, ohne IDs der ganze Speicher (nur Admin)     |
| `/stats/series`                 | `channels`, `start`, `end`, `resample` (auch `raw`), `aggregation`                | Reihen je Kanal, `ref` wird unverändert zurückgegeben                       |
| `/stats/descriptive-by-channel` | `channels`, `start`, `end`                                                        | Kennzahlen je Kanal                                                         |
| `/stats/latest-by-channel`      | `channels`                                                                        | Letzter Wert und Zeit je Kanal                                              |

`time_range` ist `{"start", "end"}` in Epoch-Sekunden, bei den
Kanal-Endpunkten liegen `start` und `end` direkt im Body. Ein Kanal ist
`{"device_id", "metric_id", "ref"}`, wobei `ref` nur durchgereicht und nie
zur Autorisierung benutzt wird.

## Auflösung

`resample` mit dem Wert `auto` wählt die Bucket-Breite nach der Länge des
Zeitraums.

| Zeitraum         | Bucket      |
| ---------------- | ----------- |
| bis 6 Stunden    | 1 Minute    |
| bis 2 Tage       | 5 Minuten   |
| bis 7 Tage       | 15 Minuten  |
| bis 30 Tage      | 1 Stunde    |
| bis 90 Tage      | 6 Stunden   |
| darüber          | 1 Tag       |

Feste Werte sind `1min`, `5min`, `15min`, `1h`, `6h` und `1d`, dazu
`bucket_seconds` als expliziter Wert. Die Aggregation (`mean`, `min`, `max`,
`sum`) läuft als `time_bucket` in TimescaleDB, nicht in Python.

## Berechnungen in `/stats/compute`

Ein Aufruf trägt Quellen (Messpunkte mit lokaler ID) und eine Liste von
Berechnungen, die in Reihenfolge ausgewertet werden. Eine Linie kann Eingang
einer späteren Berechnung sein.

| Typ                                     | Ergebnis                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `mean`, `median`, `reference_line`      | Horizontale Markierungslinie                                                                                                   |
| `moving_average`, `difference`, `trend` | Linie                                                                                                                          |
| `formula`                               | Linie aus einem Ausdruck über Quellen, sicherer AST-Teil von Python (`+ - * / ** %`, `abs`, `sqrt`, `log`, `exp`, `round`, `min`, `max`) |
| `min_max_band`, `std_band`              | Band aus unterer und oberer Reihe                                                                                              |
| `regression`                            | Kennwerte ohne Punkte                                                                                                          |

Eine fehlgeschlagene Berechnung liefert eine leere Serie mit Fehlertext, die
übrigen laufen weiter.

## Aufrufer

- **Frontend** über sein BFF. `ANALYTICS_URL` zeigt auf den Service, ein
  generischer Proxy unter `/api/analytics/*` reicht die Analyse-Charts durch.
  Die zusammengesetzten Routen (Messwerte je Standort, Asset, Projekt) rufen
  `/stats/series`, `/stats/latest-by-channel` und `/stats/descriptive-by-channel`.
- **Lastmessung QS-PER-03** aus `evaluation/load/locustfile.py` mit
  `/stats/latest`, `/stats/timeseries`, `/stats/descriptive` und `/stats/ingest-rate`.
