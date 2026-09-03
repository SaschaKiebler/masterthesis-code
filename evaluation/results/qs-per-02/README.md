# QS-PER-02, Lastspitze im Ingest

| Stimulus | Response Measure |
|---|---|
| Fünf Minuten Grundlast von 500 Messwerten pro Sekunde, dann fünf Minuten Spitze auf 2.500 durch einen zweiten parallelen Generator, danach Erholungsfenster | Verlustrate 0 %, Erholung binnen 5 Minuten |

Dieses Szenario ist der einzige Beleg für die horizontale Skalierung der
Erfassung. QS-PER-01 läuft mit der Mindestausstattung von zwei Instanzen und
prüft sie deshalb nicht.

## Ergebnis vom 02.09.2026, bestanden

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Verlustrate | 0 % | 0 %, 1.081.456 persistiert, 0 abgewiesene Payloads |
| Erreichte Spitzenrate | 2.500/s | 2.575/s, 154.501 Messwerte je Minute über vier Minuten |
| Persistierung p95 | Grenzwert 500 ms aus QS-PER-01 | 11,4 ms über den ganzen Lauf, in der Spitzenminute 17,8 ms, max 295,8 ms |
| Erholung | binnen 5 min | in der ersten Minute nach der Spitze, p95 zurück auf 7,4 ms |
| Autoskalierung | | 2 auf 8 Instanzen in drei Schritten, danach zurück auf 7 |

Der Grenzwert von 500 ms wurde zu keinem Zeitpunkt verlassen, weshalb die
Erholung nicht als Rückkehr unter eine Schwelle sichtbar wird, sondern als
Rückgang der Latenz auf das Niveau der Grundlast.

## Dateien

Der Ordner enthält vier Läufe, und drei davon sind Fehlschläge. Sie liegen
bei, weil die Korrektur zwischen ihnen der eigentliche Befund des Szenarios
ist.

| Datei | Inhalt |
|---|---|
| `qs-per-02-20260902-133724.txt` | **der berichtete Lauf**, bestanden |
| `qs-per-02-20260902-133724-scaling.csv` | Instanzzahl und Rechenzeit alle 15 Sekunden, Spitze 8 Instanzen |
| `qs-per-02-20260902-113914.txt` | erster Lauf nach der Korrektur des Verbindungspools, ebenfalls unauffällig, p95 10,4 ms |
| `qs-per-02-20260902-113914-scaling.csv` | dazu die Skalierung, Spitze 8 Instanzen |
| `qs-per-02-20260901-191304-scaling.csv` | Skalierung des Laufs mit erschöpftem Verbindungspool, Spitze 9 Instanzen |
| `VERWORFEN-qs-per-02-20260901-183205.txt` | verworfener Lauf, Fußnote erklärt die Ursache |
| `qs-per-02-scaling-20260901-183826.csv` | Skalierung des verworfenen Laufs |

### Der verworfene Lauf

Beide Generatoren verbanden sich unter denselben MQTT-Client-IDs, weil der
mock-service die Kennung allein aus Präfix und Verbindungsindex bildete. Der
Broker warf jeweils die ältere Verbindung hinaus, beide bauten in einer
Schleife neu auf. Der Spitzengenerator verwarf dadurch 205.914 Nachrichten und
erreichte statt 2.500 nur rund 1.700 Messwerte pro Sekunde. Gemessen wurde
damit der Generator und nicht die Plattform. Behoben durch einen
prozesseindeutigen Zusatz in der Client-ID.

### Der Lauf mit erschöpftem Verbindungspool

Der schärfste Sensitivity Point der ganzen Bewertung. Ohne Obergrenze bemisst
deadpool den Verbindungspool je Instanz an den Kernen des Knotens, was mit der
Belastbarkeit des Speichers nichts zu tun hat. Unter der Spitze ging die
Autoskalierung auf neun Instanzen, die Summe der Pools überschritt das
`max_connections` von 100 des Speichers, und der Lauf verlor 5,65 Prozent
seiner Messwerte bei einem p95 von 224 Sekunden, während der Speicher laut
Skalierungs-CSV mit 2.086 von 4.000 Millicores nur zur Hälfte ausgelastet war.
Mit der festen Obergrenze von sechs Verbindungen je Instanz, abgestimmt auf
`max_connections` und die Decke der Autoskalierung, verliert dieselbe Last
nichts.

Von diesem Lauf ist nur die Skalierungs-CSV erhalten, der zugehörige Bericht
wurde nicht gesichert. Verlustrate und p95 stammen aus der Konsolenausgabe des
Laufs und lassen sich aus den Dateien in diesem Ordner nicht nachrechnen. Die
CSV belegt die neun Instanzen und die halbe Auslastung des Speichers. Wer die
vollständige Messung braucht, stellt sie mit der Anleitung unten wieder her.

## Reproduktion

```bash
infrastructure/scripts/eval-up.sh
evaluation/scripts/ingest-scenario.sh qs-per-02
```

Der Lauf dauert rund 15 Minuten und startet die Spitze selbst als zweiten
Generator. Der Zustand vor der Korrektur, also der Lauf mit erschöpftem
Verbindungspool, lässt sich gezielt wiederherstellen.

```bash
# DB_MAX_CONNECTIONS in infrastructure/kubernetes/base/ingestion-service.yaml
# entfernen, dann neu ausrollen und das Szenario wiederholen
kubectl -n heating-platform rollout restart deploy/ingestion-service
evaluation/scripts/ingest-scenario.sh qs-per-02
```

## Beim Lesen beachten

Die Ursache der Erschöpfung liegt nicht in der Skalierung selbst, sondern in
der stillschweigenden Kopplung eines zustandslosen Dienstes an eine nicht
mitskalierende Ressource. Der Wert ist immer dann neu herzuleiten, wenn sich
die Decke der Autoskalierung oder `max_connections` des Speichers ändert.
