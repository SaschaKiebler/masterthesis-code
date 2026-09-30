# QS-USA-01 – Selbsterklärende Erstinbetriebnahme

**Status: erfüllt.** 7 Bedienschritte ab der Startseite, 9 ab der Anmeldung,
Sollwert höchstens 10. Der Durchlauf wurde am 13.08.2026 mit dem
Browser-Automatisierungsskript `evaluation/usability/qs_usa_01_walkthrough.py`
ausgeführt, das den Bedienablauf in der Weboberfläche fährt und jeden Schritt
mit einem Screenshot festhält. Die Zählung folgt der Zählregel in
[results/README.md](../README.md), die Kapitel 6.2 der Arbeit festlegt, und
lässt sich aus den Screenshots nachvollziehen.

## Was der Test zeigt

Das Szenario verlangt einen protokollierten Durchlauf von der Montage bis
zum ersten sichtbaren Messwert mit höchstens zehn Bedienschritten in der
Oberfläche. Die Montage simuliert ein Gerät der Mock-Flotte, das bereits am
Broker sendet (`mock-ht-005-06`). Die Fachkraft liest die Geräte-ID vom
Typenschild ab und gibt sie im Wizard ein.

Die sieben Schritte ab der Startseite mit bestehendem Mandantenkonto.

| Nr. | Schritt | Screenshot |
|---|---|---|
| 1 | Auf der Projektkarte „Sensor" wählen, der Wizard öffnet sich in der Projekt-IDE | 01 |
| 2 | Standort wählen (Raum 005-06), Liste aus Gebäuden, Etagen, Räumen, überspringbar | 02 |
| 3 | Sensortyp wählen (Digital Input), das Weiter bestätigt nur die Auswahl | 03 |
| 4 | Gerätevorlage wählen (Shelly Plus I4), bringt die Signal-Map mit, überspringbar | 04 |
| 5 | Name und Geräte-ID eintragen, ein Formular | 05 |
| 6 | „Create Sensor", der Sensor erscheint in der Topologie mit seiner Konfiguration | 06 |
| 7 | In das Projekt-Dashboard wechseln, der Sensor zeigt aktuelle Werte | 07 |

Zählregel wie in [results/README.md](../README.md) und Kapitel 6.2 der
Arbeit. Auswahl, Eingabe oder Auslösen
zählt, ein Weiter nach einer getroffenen Auswahl zählt nicht, die Felder
eines Formulars zählen zusammen. Ab der Anmeldung kommen das
Anmeldeformular und das Anmelden hinzu, also 9.

## Grenzen

- Der Ausführende ist der Autor. Belegt sind Schrittzahl und Machbarkeit
  ohne Eingriff des Betreibers, nicht die Verständlichkeit für eine IT-ferne
  Fachkraft.
- Die niedrige Zahl hängt an der Vorlage. Ohne passende Vorlage entsteht ein
  Sensor ohne Signal-Map, der keinen Wert zeigt. Der Katalog ist Aufgabe des
  Betreibers.
- Die Oberfläche ist englisch beschriftet.

## Dateien

- `screenshots/` – die sieben beschrifteten Screenshots der gezählten Schritte
  in Ablaufreihenfolge, der Beleg für die Zählung.
- `../../usability/screenshots/` – der Rohlauf des Skripts mit einem Screenshot
  je Aktion, auch für die nicht gezählten wie Anmeldemaske oder Weiter. Die
  dort liegende `protokoll.json` stammt aus der ersten Fassung des Skripts,
  die Werkzeugaufrufe statt Bedienschritte zählte (16 statt 9 ab der
  Anmeldung), und ist nicht der Beleg.

## Wiederholen

```bash
scripts/dev.sh up
evaluation/usability/.venv/bin/python evaluation/usability/qs_usa_01_walkthrough.py \
  --device-id mock-ht-005-06 --location "Raum 005-06" \
  --sensor-type "Digital Input" --template "Shelly Plus I4"
```

Das Skript meldet sich an, fährt den Sensor-Wizard, legt den Sensor an und
wartet auf den ersten sichtbaren Messwert. Voreingestellt schreibt es
Screenshots und `protokoll.json` nach `evaluation/usability/screenshots/`,
mit `--out` in einen anderen Ordner. Das Gerät muss bereits am Broker senden,
also Teil einer geseedeten und laufenden Mock-Flotte sein.
