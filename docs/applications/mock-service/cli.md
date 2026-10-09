# Kommandozeile

Der Befehl heißt `mock-service` und liegt nach der Installation in
`.venv/bin/`. Alternativ geht `python -m mock_service`. Es gibt drei
Kommandos.

| Kommando | Wirkung                                                                                                     | Nebenwirkungen              |
| -------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- |
| `plan`   | Zeigt die Flotte, die ein Szenario ergibt, mit Geräten, Metriken, Regeln und der erwarteten Nachrichtenrate | keine                       |
| `seed`   | Legt die Flotte in der Stammdaten-DB an, mit `--remove` entfernt es sie wieder                              | schreibt in die Datenbank   |
| `run`    | Schickt die Telemetrie an den Broker, bis die Dauer abläuft oder Ctrl-C kommt                               | publiziert per MQTT         |

```bash
.venv/bin/mock-service plan --sites 2 --rooms 2 --rogue 1
.venv/bin/mock-service seed --sites 2 --rooms 2
.venv/bin/mock-service run  --sites 2 --rooms 2 --interval 10
.venv/bin/mock-service seed --sites 2 --rooms 2 --remove
```

## Optionen für die Flotte

Gelten für alle drei Kommandos. `seed` und `run` müssen dieselben Werte für
`--prefix`, `--sites` und `--rooms` bekommen, sonst sendet die Flotte unter
anderen Geräte-IDs, als angelegt wurden.

| Option       | Standard                                                    | Bedeutung                                                                    |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `--prefix`   | `mock`                                                      | Namenspräfix der Flotte. Daraus entstehen Mandant, Projekt und alle IDs      |
| `--sites`    | `2`                                                         | Standorte, je einer mit einem Kessel                                         |
| `--rooms`    | `2`                                                         | Raumsensoren je Standort                                                     |
| `--rogue`    | `0`                                                         | Zusätzliche Geräte, die senden, aber nie angelegt werden                     |
| `--persons`  | `0`                                                         | Personen je Standort mit Wohnsitz in einem Raum, für den Datenschutz-Pfad    |
| `--seed`     | `42`                                                        | Startwert des Zufallsgenerators, gleicher Wert ergibt gleiche Kurven         |
| `--dsn`      | `postgresql://postgres:password@localhost:5432/heating_platform` | Stammdaten-DB für `seed`                                                   |
| `--scenario` |                                                             | JSON-Datei mit denselben Schlüsseln, Flags überschreiben die Datei           |

## Optionen für `run`

| Option           | Standard         | Bedeutung                                                    |
| ---------------- | ---------------- | ------------------------------------------------------------ |
| `--interval`     | `10`             | Takt je Gerät in Sekunden                                    |
| `--duration`     | bis Ctrl-C       | Laufzeit in Sekunden                                         |
| `--broker`       | `localhost:1883` | Broker als `host` oder `host:port`                           |
| `--connections`  | `2`              | MQTT-Verbindungen, über die die Flotte verteilt sendet       |
| `--fault`        |                  | Störung, mehrfach möglich, siehe unten                       |

`seed` kennt zusätzlich `--no-rules` (keine Schwellwert- und Anomalieregeln
anlegen) und `--remove`.

## Störungen

Eine Störung wird als `TYP:schlüssel=wert,...` angegeben.

```bash
--fault overheat:count=1,at=30,for=90
--fault short_cycle:site=3,at=30
--fault dropout:fraction=0.5,at=120,for=60,target=rooms
```

| Schlüssel  | Standard      | Bedeutung                                                  |
| ---------- | ------------- | ---------------------------------------------------------- |
| `count`    | `1`           | So viele Geräte, in fester Reihenfolge der Flotte          |
| `fraction` |               | Anteil statt Anzahl, zum Beispiel `0.5`                    |
| `site`     | alle          | Nur Geräte dieses Standorts (1 bis `--sites`)              |
| `at`       | `60`          | Beginn in Sekunden nach dem Start                          |
| `for`      | bis zum Ende  | Dauer in Sekunden                                          |
| `target`   | je Typ        | `rooms`, `boilers` oder `any`                              |

Welche Störungen es gibt und was sie in der Plattform auslösen, steht unter
[Simulation](simulation.md).

## Szenario-Datei

`scenarios/local-smoke.json` ist das Beispiel. Die Schlüssel entsprechen den
Optionen, nur etwas anders benannt.

```json
{
  "prefix": "mock",
  "sites": 2,
  "rooms_per_site": 2,
  "rogue": 1,
  "persons_per_site": 0,
  "interval_s": 5.0,
  "duration_s": 240.0,
  "seed": 42,
  "broker_host": "localhost",
  "broker_port": 1883,
  "connections": 2,
  "mean_outdoor_c": 8.0,
  "diurnal_amplitude_c": 4.0,
  "faults": [
    { "type": "overheat", "count": 1, "at_s": 30.0, "duration_s": 120.0 }
  ]
}
```

`mean_outdoor_c` und `diurnal_amplitude_c` steuern das Wetter und gibt es
nur in der Datei. Unbekannte Schlüssel lehnt der Befehl ab.

## Was `run` ausgibt

Alle zehn Sekunden eine Zeile mit dem Stand.

```
t=+30s published=79 (2.7 msg/s) measurements=124 (4.2 val/s) queue=0 dropped=0 errors=0 faults=none
```

`published` zählt MQTT-Nachrichten, `measurements` die Messwerte darin. Ein
Kesseldokument trägt vier Messwerte, ein Shelly-Status einen. Die Evaluation
rechnet in Messwerten, deshalb ist `measurements` die Zahl, die mit den
Zeilen im Messwertspeicher verglichen wird. Die Abschlusszeile nennt
zusätzlich `seeded`, also die Messwerte ohne die unbekannten Geräte, die der
ingestion-service absichtlich verwirft.
