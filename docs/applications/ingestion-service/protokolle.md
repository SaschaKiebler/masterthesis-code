# Protokolle und Parsing

Das Topic entscheidet über die Route, die Signal-Map des Geräts über die
Messwerte. Die Routen werden in fester Reihenfolge geprüft, die erste passende
gewinnt.

## Routen

| Reihenfolge   | Erkennung                     | Geräte-ID       | Quelle für die Signal-Map              | Beispiel                                 |
| ------------- | ----------------------------- | --------------- | -------------------------------------- | ---------------------------------------- |
| 1 Shelly Gen2 | Topic enthält `/status/`      | Alles davor     | Komponente danach, z. B. `temperature:0` | `shellyplusht-abc/status/temperature:0` |
| 2 Tasmota     | Präfix `tele/` oder `stat/`   | Zweites Segment | Nachrichtentyp, z. B. `SENSOR`         | `tele/tasmota_01/SENSOR`                 |
| 3 Generisch   | Mindestens ein `/`            | Erstes Segment  | Rest des Topics, z. B. `data`          | `boiler-001/data`                        |

Topics ohne `/` passen auf keine Route und erzeugen einen Eintrag in
`ingestion_errors`. Ein Shelly-Topic wie `<id>/events/rpc` enthält kein
`/status/` und fällt deshalb in die generische Route.

## Signal-Map

Die Signal-Map kommt je Gerät aus `device.configured` und hat die Form

```json
{
  "12": { "name": "Vorlauf", "unit": "°C", "source": "data",          "field": "flow_c", "min": null, "max": null },
  "13": { "name": "Raum",    "unit": "°C", "source": "temperature:0", "field": "tC" }
}
```

Der Schlüssel ist die `metric_id`. Ein Eintrag greift, wenn sein `source` mit
der Quelle der Route übereinstimmt. Bei Shelly wird eine Komponente ohne Kanal
auf `:0` ergänzt, `temperature` und `temperature:0` sind also gleichwertig.

- **field** ist ein Pfad in die JSON-Nutzlast, Punktnotation bis drei Ebenen (`battery.percent`).
- Zahlen werden übernommen, `true` und `false` werden zu `1.0` und `0.0`.
- Fehlt das Feld oder ist es `null`, wird der Eintrag übersprungen, die übrigen laufen weiter.
- Fehlt `field`, greifen bei Shelly Standardfelder, `tC` für `temperature` und `rh` für `humidity`.
  Für andere Komponenten muss `field` gesetzt sein.
- `min` und `max` werden vom ingestion-service nicht geprüft.

Passt kein Eintrag, ist das ein Fehler und die Nachricht landet mit Rohnutzlast
in `ingestion_errors`. Das betrifft auch Tasmota-Nachrichten vom Typ `STATE`
oder `RESULT`, sofern keine Signal-Map-Einträge für sie existieren.

## Zeitstempel

Jeder Messwert trägt `time`. Die Parser suchen in der Nutzlast der Reihe nach
die Felder `ts`, `timestamp`, `Time` und `time` und akzeptieren

- RFC 3339 mit Offset, normalisiert auf UTC,
- `YYYY-MM-DDTHH:MM:SS` ohne Offset, gelesen als UTC (Tasmota),
- Epoch als Zahl in Sekunden oder Millisekunden (ab 1e11 gilt Millisekunden).

Ein Wert, der mehr als 24 Stunden von `received_at` entfernt liegt, wird
verworfen. Ein Gerät ohne NTP meldet sonst Epoch 0 und würde einen
Hypertable-Chunk im Jahr 1970 öffnen. Ohne brauchbares Feld gilt `received_at`.

| Route              | Uhr in der Nutzlast                                                          |
| ------------------ | ---------------------------------------------------------------------------- |
| Shelly Gen2 Status | Keine, `time` ist immer `received_at`                                        |
| Tasmota `tele/`    | `Time`, ohne Offset                                                          |
| Generisch          | Üblicherweise `ts`, so publiziert es auch der mock-service für den Kessel    |

Nur auf der generischen Route unterscheiden sich `time` und `received_at`
tatsächlich. Das ist die Route, auf der die Evaluation Transport- und
Verarbeitungszeit trennen kann.

## Shelly Gen2 Komponenten

Nutzlasten, wie Shelly-Gen2-Geräte sie auf ihren Status-Topics publizieren.

| Topic-Suffix             | Nutzlast                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `status/temperature:0`   | `{"id":0,"tC":22.5,"tF":72.5}`                               |
| `status/humidity:0`      | `{"id":0,"rh":65.3}`                                         |
| `status/devicepower:0`   | `{"id":0,"battery":{"V":3.04,"percent":87}}`                 |
| `status/switch:0`        | `{"id":0,"output":true,"apower":120.5,"voltage":230.1}`      |
| `status/em:0`            | `{"id":0,"a_act_power":120.5,"total_act_power":420.9}`       |
