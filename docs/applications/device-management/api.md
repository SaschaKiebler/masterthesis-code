# Discovery-API

Sniffing-Sitzungen für die Inbetriebnahme. Ein Nutzer nennt eine Geräte-ID,
der Service sammelt für kurze Zeit alle Nachrichten dieses Geräts vom Broker
und schlägt daraus eine Signal-Map vor. Die Endpunkte sind intern und ohne
Authentifizierung. Core reicht sie unter demselben Pfad durch, prüft vorher
Token und Rollen und leitet dann unverändert weiter.

| Methode und Pfad                                      | Body                                        | Antwort                                                                                              |
| ----------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /api/v1/device-discovery`                       | `{"deviceId": "...", "tenantId": "..."}`    | 201 mit der Sitzung, 429 ab der vierten aktiven Sitzung je Mandant, 500 ohne Broker-Verbindung       |
| `GET /api/v1/device-discovery/{id}?since=<epochMs>`   |                                             | Sitzung mit den Nachrichten nach `since`                                                             |
| `DELETE /api/v1/device-discovery/{id}`                |                                             | Sitzung gestoppt                                                                                     |
| `POST /api/v1/device-discovery/{id}/analyze`          |                                             | Feldstruktur und Vorschlag für die Signal-Map                                                        |

Eine Sitzung im JSON trägt `sessionId`, `deviceId`, `tenantId`, `status`
(`LISTENING`, `STOPPED`, `TIMED_OUT`), `messageCount`, `uniqueTopicCount`,
`startedAt`, `stoppedAt` und `messages` mit `topic`, `rawPayload`,
`parsedPayload` und `timestamp`.

## Aufnahme

- Eine Nachricht gehört zur Sitzung, wenn Topic oder Nutzlast die Geräte-ID
  enthalten, ohne Beachtung der Schreibweise.
- Je Topic werden höchstens drei Nachrichten behalten, damit ein
  hochfrequentes Topic das Budget von 500 Nachrichten nicht allein füllt.
- Nach 300 Sekunden endet die Sitzung von selbst. Ein Aufräumlauf alle
  30 Sekunden setzt den Status und entfernt beendete Sitzungen nach
  15 Minuten.
- Die Oberfläche fragt per `since` nach, es gibt keinen Push.

## Auswertung

`analyze` gruppiert die JSON-Felder aller gültigen Nachrichten nach Quelle.
Die Quelle ist der Teil des Topics hinter `<id>/status/` (Shelly Gen2),
hinter `shellies/<id>/` (Shelly Gen1) oder sonst das letzte Segment.
Verschachtelte Felder werden bis zwei Ebenen tief in Punktnotation
aufgelöst, passend zum ingestion-service. Jedes numerische Feld wird ein
Vorschlag mit fortlaufender `metricId`, `source`, `field`, einem lesbaren
Namen und einer geratenen Einheit. Aus `tC` wird „Temperature (C)“ mit
`celsius`, aus `apower` „Active Power“ mit `W`.

```json
{
  "fieldsBySource": { "temperature:0": ["id", "tC", "tF"] },
  "fieldTypes": { "temperature:0/id": "number", "temperature:0/tC": "number", "temperature:0/tF": "number" },
  "suggestedSignalMap": [
    { "metricId": "1", "source": "temperature:0", "field": "id", "name": "Id", "unit": "", "type": "number" },
    { "metricId": "2", "source": "temperature:0", "field": "tC", "name": "Temperature (C)", "unit": "celsius", "type": "number" },
    { "metricId": "3", "source": "temperature:0", "field": "tF", "name": "Temperature (F)", "unit": "fahrenheit", "type": "number" }
  ],
  "detectedProtocol": "SHELLY",
  "messageCount": 3,
  "sourcesCount": 1
}
```

Das Feld `id` der Shelly-Komponente ist numerisch und landet deshalb ebenfalls
im Vorschlag, der Nutzer streicht es in der Oberfläche. `detectedProtocol`
ist `SHELLY`, sobald ein Topic `shellies/` oder `/status/` enthält, sonst
`MQTT`.
