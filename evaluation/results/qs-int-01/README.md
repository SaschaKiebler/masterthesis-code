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

**Die API-Antwort muss beide Seiten des Ausfalls tragen.** Der erste Lauf
dieses Skripts las das falsche Feld der Antwort, bekam eine leere Liste und
meldete deshalb Bestanden, ohne irgendetwas geprüft zu haben. Seitdem gilt eine
leere oder einseitige Antwort ausdrücklich als Fehlschlag, denn sie ist von
einer korrekt offenen Lücke nicht zu unterscheiden.

Die Bucket-Breite muss dabei deutlich unter der Lückenlänge liegen, sonst
überspannt ein einziger Bucket den ganzen Ausfall. Das Skript verweigert eine
Kombination, in der kein vollständiger Bucket in die Lücke fällt. Bei 60 s
Buckets und 300 s Ausfall liegen vier Buckets vollständig darin, und genau
diese vier fehlen in der Antwort.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-int-01-20260903-142547.txt` | Verlustrate, gefundene Lücke, Werte darin, Nachbarkanäle, API-Antwort, Urteil |
| `qs-int-01-20260903-142547-series.csv` | die Buckets der API-Antwort mit Kennzeichnung, welcher in die Lücke fällt |

## Reproduktion

```bash
scripts/dev.sh up
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_int_01_gap_run.py
```

Das Skript seedet die Flotte selbst, wartet auf die Freigabe der Geräte,
erzeugt die Telemetrie samt Ausfall und wertet danach beide Hälften aus. Ein
Lauf dauert rund zehn Minuten, davon neun Minuten Telemetrie.

```bash
# kürzer, mit entsprechend kleinerer Lücke
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_int_01_gap_run.py \
  --target-measurements 3000 --gap-for 180
```

Die Geräteauswahl des Ausfalls ist deterministisch, der mock-service nimmt das
erste passende Gerät in Flottenreihenfolge. Betroffen ist deshalb immer
`<präfix>-ht-001-01`. Das Skript verlässt sich nicht darauf, sondern prüft es
über die Nachbarkanäle nach.

## Befund, die Darstellung überbrückt die Lücke

Der Response Measure endet bei der Abfrage-API. Die Weboberfläche ist der
dritte Ort, an den eine auswertende Fachkraft tatsächlich schaut, und dort hält
die Lücke nicht.

In der Analyse-Ansicht läuft die Kurve des ausgefallenen Sensors über die fünf
Minuten als eine einzige gerade Strecke durch, während der Nachbarsensor über
denselben Zeitraum sein normales Rauschen zeigt. Die Zeitachse ordnet den
Ausfall richtig ein, seine Dauer bleibt also ablesbar, die Linie wird aber ohne
Unterbrechung von der letzten Messung davor zur ersten danach gezogen.

Die Plattform zeichnet Zeitreihen an zwei Stellen mit verschiedenen
Bibliotheken, und beide gehen unterschiedlich mit fehlenden Werten um.

| Ansicht | Achse | Verhalten bei fehlenden Werten |
|---|---|---|
| Analyse-Ansicht | ECharts, `xAxis: { type: "time" }` | Lücke behält ihre Breite, Linie wird als gerade Strecke durchgezogen |
| Detailseite einer Anlage | Recharts, `<XAxis dataKey="time">` ohne `type="number"`, also Kategorieachse | Lücke fällt vollständig zusammen, nur die Achsenbeschriftungen springen |

Beide verletzen die Forderung, dass die Lücke als Lücke erscheint, die zweite
stärker als die erste. Der Entwurf verbietet das Zurückschreiben abgeleiteter
Werte, sagt aber nichts darüber, wie eine Ansicht fehlende Werte zu zeichnen
hat. Genau diese Lücke in der Festlegung ist der Befund.

Zu schließen wäre er an zwei Stellen. Entweder bekommt die Kategorieachse der
Detailseite `type="number"` mit einer Zeitdomäne, dann verhält sie sich wie die
Analyse-Ansicht. Oder die Abfrage liefert leere Zeitabschnitte ausdrücklich als
`null` und die Linien zeichnen ohne Verbinden über Lücken, dann bricht die
Kurve sichtbar ab. Die zweite Variante zeigt den Ausfall deutlicher, kostet
aber eine Änderung an der Aggregation im Analytics-Dienst.

## Die Abbildung

`screenshots/analyse-luecke-<zeitstempel>-diagramm.png` zeigt beide Kanäle
untereinander über dasselbe Fenster und dieselbe Auflösung. Das Paar ist
notwendig, denn eine einzelne Kurve mit einem auffällig geraden Stück könnte
auch ein Diagramm sein, das nicht geladen hat. Neben einem Nachbarn, der über
dieselben Minuten durchgehend rauscht, kann die gerade Strecke nur der Ausfall
sein.

```bash
evaluation/usability/.venv/bin/python evaluation/scripts/qs_int_01_analysis_figure.py
```

Das Skript sucht den Ausfall selbst in den Daten, legt das Fenster mit etwas
Rand darum, baut in der Analyse-Ansicht zwei beschriftete Diagramme und nimmt
sie auf. Das Usability-venv braucht dafür zusätzlich `psycopg`.

## Grenzen

Der Ausfall ist ein sauberes Verstummen. Ein reales Gerät kann stattdessen
verzögert, doppelt oder mit eingefrorenen Werten senden. Für den eingefrorenen
Fall kennt der Generator `stuck`, dieser Lauf prüft ihn nicht. Die Darstellung
in der Weboberfläche ist nicht Gegenstand, geprüft sind Speicher und
Abfrage-API, wie es der Response Measure verlangt.
