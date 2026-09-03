# QS-INT-01, Messlücke bei Sensorausfall

| Stimulus | Response Measure |
|---|---|
| Ein Sensor fällt aus, der Messwertstrom reißt ab, 10.000 gesendete Messwerte mit einer definierten Lücke | Persistiert gleich empfangen (Verlustrate 0 %), 0 Datenpunkte innerhalb der Lücke in Speicher und API-Antwort |

Das Szenario ist die Gegenprobe zu jeder Telemetrieplattform, die ihre Reihen
glättet. Eine korrekte Plattform zeigt ein Loch, wo der Sensor geschwiegen hat.
Eine, die auffüllt, den letzten Wert fortschreibt oder interpoliert, zeigt
keines und zerstört genau die diagnostische Information, die die Domäne
braucht. Gesucht wird deshalb nicht fehlender, sondern **erfundener** Wert.

Gemessen wird auf dem lokalen Entwicklungsstack. Das Szenario braucht keine
Last, und der Ausfall wird injiziert statt abgewartet.

## Ergebnis vom 03.09.2026, bestanden

Flotte `gap`, ein Standort mit einem Kessel und drei Raumsensoren, Sendeintervall
0,5 s. Der Ausfall trifft `gap-ht-001-01`, Metrik 1, ab Sekunde 60 für 300 s.

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Verlustrate | 0 % | 0,0000 %, 9.947 erzeugt, 9.947 persistiert |
| Lücke im Speicher | vorhanden | 300,5 s, injiziert waren 300 s |
| Werte in der Lücke, Speicher | 0 | 0 |
| Werte in der Lücke, API | 0 | 0 |
| Antwort umspannt den Ausfall | beide Seiten | 1 Bucket davor, 3 danach |
| Ausfall auf einen Kanal begrenzt | ja | 3 von 3 Nachbarkanälen durchgehend |

Die Laufdauer kompensiert die 1.200 Messwerte, die der Ausfall selbst
entfernt, damit die geforderten 10.000 tatsächlich angeboten werden. Die
verbleibenden 53 fehlenden Werte stammen aus der Rundung des Batteriekanals,
der nur jeden zehnten Takt sendet.

## Drei Vorkehrungen gegen ein wertloses Bestanden

Ein Szenario, dessen Bestehen in der **Abwesenheit** von Daten besteht, ist
leicht versehentlich zu bestehen. Drei Prüfungen halten das Ergebnis belastbar.

**Die Lücke wird gefunden, nicht angenommen.** Das Skript sucht das größte
Intervall, das die eigene Taktrate des Kanals um mehr als das Dreifache
übersteigt, und vergleicht es erst danach mit dem injizierten Ausfall. Eine
Abweichung von 0,5 s bei 300 s injiziert bestätigt, dass die gefundene Lücke
die injizierte ist.

**Die Nachbarkanäle müssen weitergesendet haben.** Sonst wäre das Loch ein
Stillstand der ganzen Plattform und nicht der simulierte Ausfall, und die
Messung sagte nichts aus.

**Die API-Antwort muss beide Seiten des Ausfalls tragen.** Eine leere oder
einseitige Antwort gilt als Fehlschlag, denn sie ist von einer korrekt offenen
Lücke nicht zu unterscheiden. Die Bucket-Breite muss dabei deutlich unter der
Lückenlänge liegen, sonst überspannt ein einziger Bucket den ganzen Ausfall.
Das Skript verweigert eine Kombination, in der kein vollständiger Bucket in die
Lücke fällt. Bei 60 s Buckets und 300 s Ausfall liegen vier Buckets vollständig
darin, und genau diese vier fehlen in der Antwort.

## Die Darstellung in der Weboberfläche

Der Response Measure endet bei der Abfrage-API. Die Analyse-Ansicht ist der
dritte Ort, an den eine auswertende Fachkraft tatsächlich schaut, und auch dort
bleibt die Lücke offen.

Die Ansicht fügt an jeder Stelle, an der der nächste Messwert fällig gewesen
wäre, eine Leerstelle ein und verbindet nicht darüber hinweg. Als fällig gilt
ein Abstand von mehr als dem Anderthalbfachen des mittleren Abstands der Reihe.
Damit unterbricht schon ein einzelner fehlender Wert die Linie, gewöhnliches
Jitter im Sendeintervall dagegen nicht. Der Ausfall erscheint als Unterbrechung
der Kurve mit farbig hinterlegter Fläche.

`screenshots/analyse-luecke-20260903-172826-diagramm.png` zeigt beide Kanäle
untereinander über dasselbe Fenster und dieselbe Auflösung. Das Paar ist
notwendig, denn eine einzelne unterbrochene Kurve könnte auch ein Diagramm
sein, das nicht geladen hat. Neben einem Nachbarn, der über dieselben Minuten
durchgehend zeichnet, kann die Unterbrechung nur der Ausfall sein.

Die Detailseite einer Anlage zeichnet ihre Zeitreihe mit einer Kategorieachse,
in der fehlende Abschnitte zusammenrücken. Sie ist nicht Gegenstand der
Abbildung.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-int-01-20260903-171525.txt` | Verlustrate, gefundene Lücke, Werte darin, Nachbarkanäle, API-Antwort, Urteil |
| `qs-int-01-20260903-171525-series.csv` | die Buckets der API-Antwort mit Kennzeichnung, welcher in die Lücke fällt |
| `screenshots/analyse-luecke-20260903-172826-diagramm.png` | beide Diagramme der Analyse-Ansicht über das Ausfallfenster |
| `screenshots/analyse-luecke-20260903-172826-ganze-seite.png` | dieselbe Ansicht als ganze Seite |
| `screenshots/analyse-luecke-20260903-172826.json` | Fenster, Ausfallzeiten, Auflösung und Dateinamen der Aufnahme |

## Reproduktion

```bash
scripts/dev.sh up
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_int_01_gap_run.py
evaluation/usability/.venv/bin/python evaluation/scripts/qs_int_01_analysis_figure.py --resolution Raw
```

Das erste Skript seedet die Flotte selbst, wartet auf die Freigabe der Geräte,
erzeugt die Telemetrie samt Ausfall und wertet danach beide Hälften aus. Ein
Lauf dauert rund zehn Minuten, davon neun Minuten Telemetrie.

Das zweite Skript sucht den jüngsten Ausfall in den Daten, legt das Fenster
mit etwas Rand darum und nimmt die Analyse-Ansicht auf. Liegen dort bereits
zwei Diagramme mit den Titeln „Sensor mit Ausfall" und „Nachbarsensor ohne
Ausfall", benutzt es sie und setzt nur ihre Quelle auf die beiden Sensoren des
Laufs, ohne die Ansicht zu speichern. Das Usability-venv braucht dafür
zusätzlich `psycopg`.

```bash
# kürzer, mit entsprechend kleinerer Lücke
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_int_01_gap_run.py \
  --target-measurements 3000 --gap-for 180
```

Die Geräteauswahl des Ausfalls ist deterministisch, der mock-service nimmt das
erste passende Gerät in Flottenreihenfolge. Betroffen ist deshalb immer
`<präfix>-ht-001-01`. Das Skript verlässt sich nicht darauf, sondern prüft es
über die Nachbarkanäle nach.

## Grenzen

Der Ausfall ist ein sauberes Verstummen. Ein reales Gerät kann stattdessen
verzögert, doppelt oder mit eingefrorenen Werten senden. Für den eingefrorenen
Fall kennt der Generator `stuck`, dieser Lauf prüft ihn nicht. Geprüft sind
Speicher, Abfrage-API und die Analyse-Ansicht.
