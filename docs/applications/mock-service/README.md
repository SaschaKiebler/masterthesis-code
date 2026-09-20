# mock-service

Eine simulierte Geräteflotte. Der mock-service ersetzt die echten Heizungen
und Raumsensoren, die es im Prototyp nicht gibt. Er legt eine Flotte in der
Plattform an und schickt anschließend deren Telemetrie per MQTT, so wie es
echte Geräte tun würden. Damit laufen Funktionstests, Demos und die
Lastmessungen der Evaluation. Python, aiomqtt, psycopg.

Nicht zu verwechseln mit dem simulation-engine, der als digitaler Zwilling
vorgesehen ist. Der mock-service ist ein Werkzeug, kein Teil der Plattform.

| Seite                                        | Inhalt                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Kommandozeile](cli.md)                      | Die drei Kommandos, alle Optionen, Szenario-Dateien, Störungen                             |
| [Simulation](simulation.md)                  | Welche Geräte es gibt, was sie senden, wie das Modell rechnet, was Störungen auslösen      |
| [Seed](seed.md)                              | Was `seed` in der Datenbank anlegt und warum                                               |
| [Betrieb](betrieb.md)                        | Installieren, Container, Einsatz im Cluster und in der Evaluation, bekannte Grenzen        |
| [Kernfunktionen im Code](kernfunktionen.md)  | Die fünf wichtigsten Funktionen mit Auszug und Link in die Quelle                          |

## So funktioniert es

Ein Szenario beschreibt die Flotte (Anzahl Standorte und Räume), das Tempo
(Sendetakt, Dauer) und optionale Störungen. Aus demselben Szenario entstehen
beide Seiten der Simulation.

1. `mock-service seed` legt die Flotte in der Stammdaten-DB an. Ab dann kennt
   die Plattform die Geräte, und der ingestion-service nimmt ihre Nachrichten an.
2. `mock-service run` startet für jedes Gerät eine kleine Simulation und
   schickt die Nachrichten an den MQTT-Broker.

Weil beide Kommandos die Flotte aus denselben Parametern ableiten, sendet
genau das, was angelegt wurde. Alle IDs sind aus dem Präfix berechnet, ein
zweiter `seed` mit denselben Parametern ändert nichts.

## Schnittstellen

| Richtung | Kanal                                        | Inhalt                                                          |
| -------- | -------------------------------------------- | --------------------------------------------------------------- |
| aus      | MQTT, Standard `localhost:1883`              | Telemetrie der Flotte, QoS 1, über mehrere Verbindungen         |
| aus      | PostgreSQL `stammdaten-db`, nur bei `seed`   | Mandant, Projekt, Gebäude, Räume, Geräte, Messpunkte, Regeln    |

Der mock-service liest nichts aus der Plattform zurück. Ob eine Nachricht
angekommen ist, sieht man in den Logs des ingestion-service oder in der
Oberfläche.

## Was eine Flotte enthält

Je Standort ein Kesselregler und eine wählbare Zahl Raumsensoren. Dazu auf
Wunsch unbekannte Geräte, die nie angelegt werden, und Personen für den
Datenschutz-Pfad.

| Gerät                          | ID-Muster              | Sendet auf                                                                     | Wird verarbeitet von                                     |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Kesselregler                   | `<prefix>-boiler-001`  | `<id>/data`, ein JSON mit vier Werten und eigener Uhr                          | generische Route des ingestion-service                   |
| Raumsensor Shelly Plus H&T     | `<prefix>-ht-001-01`   | `<id>/status/temperature:0`, `humidity:0`, alle zehn Takte `devicepower:0`     | Shelly-Route des ingestion-service                       |
| Unbekanntes Gerät (`--rogue`)  | `<prefix>-rogue-001`   | Wie ein Raumsensor, aber nie angelegt                                          | Wird verworfen und von device-management gemeldet        |

## Module

| Datei           | Zuständigkeit                                                  |
| --------------- | -------------------------------------------------------------- |
| `__main__.py`   | Kommandozeile mit `plan`, `seed` und `run`                     |
| `scenario.py`   | Szenario aus Datei und Flags, Beschreibung einer Störung       |
| `fleet.py`      | Flotte und alle IDs aus dem Szenario ableiten                  |
| `thermal.py`    | Wetter, Kessel- und Raummodell                                 |
| `devices.py`    | Modellzustand in MQTT-Nachrichten übersetzen                   |
| `runner.py`     | Sendeschleife, Verbindungen, Störungsplan, Statistik           |
| `seed.py`       | Alles, was in der Datenbank angelegt oder entfernt wird        |
