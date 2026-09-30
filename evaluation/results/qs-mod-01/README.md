# QS-MOD-01 – Aufnahme eines neuen Gerätetyps

**Status: erfüllt.** 0 Codeänderungen, 0 berührte Dienste, 0 Neuausrollungen.
Der Durchlauf hat 11 Bedienschritte, der erste Messwert des neuen Geräts lag
28,9 s nach dem Anlegen des Sensors im Speicher.

## Was der Test zeigt

Das Szenario behauptet, dass ein Gerät eines bisher unbekannten Typs bei
bereits unterstütztem Übertragungsprotokoll allein über die Bedienoberfläche
aufgenommen wird, ohne Codeänderung und ohne Neuausrollen. Der Durchlauf
macht genau das. Ein Wärmemengenzähler, den die Plattform nicht kennt, sendet
unter dem Topic `wmz-001/data` einen JSON-Payload mit Feldnamen, die in keiner
Vorlage vorkommen. Vor der Konfiguration verwirft die Erfassung die
Nachrichten (0 Messwerte im Speicher), der Broker-Watcher führt das Gerät als
erkannt.

Die Handlung selbst läuft in drei Abschnitten der Weboberfläche.

1. **Device Scanner.** Geräte-ID eingeben, Empfang starten, nach sechs
   Nachrichten beenden, Payload analysieren. Die Analyse erkennt Protokoll,
   Quelle und sechs numerische Felder und schlägt eine Signal-Map vor.
2. **Vorlage.** Aus der Analyse heraus wird eine Gerätevorlage angelegt. Die
   Signal-Map ist vorbelegt. Ergänzt werden Name, Hersteller, Modell und
   Objekttyp, die Einheiten werden gesetzt und der Zeitstempel des Geräts wird
   als Kanal entfernt.
3. **Sensor-Wizard.** In der Projekt-IDE wird ein Sensor mit Standort
   Heizraum 001, Typ Wärmemengenzähler und der neuen Vorlage angelegt und an
   die Geräte-ID gebunden.

Danach passiert nichts mehr von Hand. Die Geräteverwaltung projiziert die
Konfiguration innerhalb eines Sweeps (höchstens 30 s) auf das kompaktierte
Topic `device.configured`, der Erfassungsdienst übernimmt sie in seinen Cache
und dekodiert die nächste Nachricht nach der Signal-Map. Im Protokoll steht
die Zeit vom Klick auf „Create Sensor" bis zum ersten persistierten Wert.

## Wie das Ergebnis belegt ist

Das Skript hält vor und nach der Handlung den Commit-Stand, das
Arbeitsverzeichnis unter `applications/` und `apis/` sowie Kennung und
Startzeit aller laufenden Container fest. Beide Aufnahmen sind identisch,
daraus folgen die drei Nullen. Jeder Schritt hat einen Screenshot, die
Zählung folgt der Zählregel in [results/README.md](../README.md), die
Kapitel 6.2 der Arbeit festlegt (Auswahl, Eingabe oder
Auslösen zählt, Ansichten und reine Bestätigungen zählen nicht).

| Größe | Wert |
|---|---|
| Geänderte Codezeilen | 0 |
| Berührte Dienste | 0 |
| Neuausrollungen | 0 |
| Bedienschritte (Device Scanner bis Sensor angelegt) | 11 |
| Messwerte vor der Konfiguration | 0 |
| Erster Messwert nach dem Anlegen | 28,9 s |
| Kanäle des neuen Geräts | 5 (Vorlauf, Rücklauf, Leistung, Energie, Volumen) |

## Grenzen

- **Erfassung ohne Unterbrechung** ist strukturell belegt, nicht gemessen.
  Kein Dienst wurde neu gestartet, der Cache der Erfassung folgt dem Topic im
  laufenden Betrieb. Eine parallel laufende zweite Flotte mit Lückenprüfung
  war nicht Teil des Durchlaufs.
- **Neues Protokoll oder Topic-Schema** braucht Code. Der Erfassungsdienst
  kennt genau einen Transport (MQTT), ein zweiter wäre ein neues Modul in der
  Erfassung. Die Zuordnung von Topic zu Gerät kennt drei fest verdrahtete
  Schemata (Shelly, Tasmota, generisch), ein viertes braucht Code in der
  Erfassung und in der Geräteverwaltung.
- Der Ausführende ist der Autor. Der Durchlauf belegt den Weg und seine
  Länge, nicht die Verständlichkeit für Dritte.

## Dateien

- `protokoll.json` – Schritte mit Zählung, Fakten vor und nach der Handlung,
  Messpunkte des neuen Geräts, Zeit bis zum ersten Messwert.
- `screenshots/` – ein Bild je Schritt, nummeriert in Ablaufreihenfolge.

## Wiederholen

```bash
scripts/dev.sh up
evaluation/usability/.venv/bin/python evaluation/scripts/qs_int_01_gap_run.py   # seeded die Flotte "gap"
evaluation/usability/.venv/bin/python evaluation/scripts/qs_mod_walkthrough.py --only mod-01
```

Das Skript räumt Vorlage, Sensor, Gerät und Messwerte eines früheren Laufs
vorher weg und lässt den Eintrag der erkannten Geräte stehen, weil der
Broker-Watcher ein Gerät nur alle zehn Minuten meldet.
