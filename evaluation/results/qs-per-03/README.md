# QS-PER-03, Abfrage-APIs unter Last

| Stimulus | Response Measure |
|---|---|
| 50 gleichzeitige Nutzer auf den Abfrage-APIs von Core und Analytics, zehn Minuten, während die Ingest-Grundlast von 500 Messwerten pro Sekunde weiterläuft | p95 der Antwortzeit unter 300 ms, Fehlerrate unter 1 % |

Angemeldet als mandantengebundener Nutzer, damit die Mandantenprüfung im
gemessenen Pfad liegt. Ein Systemadministrator beendet die Prüfung in ihrer
ersten Zeile, ein Lauf unter seinem Konto würde ihre Kosten als null
ausweisen.

## Ergebnis vom 02.09.2026, teilweise erfüllt

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Antwortzeit p95 | unter 300 ms | **7.600 ms**, p50 1.300 ms, p90 5.100 ms, p99 11.000 ms, max 16.000 ms |
| Fehlerrate | unter 1 % | 0,51 %, 73 von 14.450 Requests |
| Ingest während der Abfragelast | | 307.914 Messwerte, p95 der Persistierung 23,2 ms |

Das Szenario ist teilweise erfüllt. Die Antwortzeit verfehlt ihren Sollwert um
etwa den Faktor 25, Fehlerrate und Verlustrate der Erfassung halten ihre
Sollwerte. Entscheidend für die Einordnung ist die Aufteilung je Endpunkt.

| Endpunkt | Requests | Fehler | Median |
|---|---|---|---|
| `analytics:timeseries` | 958 | 27 | 9.100 ms |
| `analytics:descriptive` | 325 | 8 | 6.300 ms |
| `analytics:latest` | 1.256 | 28 | 3.800 ms |
| `analytics:ingest-rate` | 305 | 10 | 3.800 ms |
| `core:latest-values` | 4.662 | 0 | 1.600 ms |
| `core:events` | 2.379 | 0 | 1.400 ms |
| `core:health` | 2.318 | 0 | 790 ms |
| `core:dashboards` | 1.114 | 0 | 720 ms |
| `core:projects` | 1.133 | 0 | 430 ms |

Alle 73 Fehler entfallen auf den Analytics-Dienst, keiner auf den Core. Der
Engpass liegt damit nicht in der Abfrageschicht allgemein, sondern im
Lesepfad des Messwertspeichers. Analytics aggregiert über Zeitreihen, während
der Speicher zugleich die Ingest-Grundlast schreibt, und beides trifft auf
dieselbe Instanz. Das ist eine Folge des Entwurfs, der Erfassung und Abfrage
auf denselben Messwertspeicher setzt, unter der Ausstattung der Messumgebung
mit einer einzigen Instanz. Die Konkurrenz wirkt einseitig, der Schreibpfad
behält seine Rate, der Lesepfad bricht ein. Kapitel 6 führt das als Sensitivity
Point und Trade-off innerhalb von QA-PER und nicht als Abweichung des
Prototyps.

Die Ingest-Kette blieb davon unberührt. Ihr p95 stieg von 7,7 ms ohne
Abfragelast auf 23,2 ms, blieb also weit unter dem Zielwert von QS-PER-01.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-per-03-20260902-135500.txt` | Bericht mit Kennzahlen je Endpunkt, aggregierten Perzentilen und der parallel gemessenen Ingest-Strecke |
| `qs-per-03-20260902-135500-stats.csv` | Kennzahlen je Endpunkt, roh aus locust |
| `qs-per-03-20260902-135500-failures.csv` | die 73 Fehlschläge |
| `qs-per-03-20260902-135500-stats_history.csv` | sekundenweiser Verlauf über die zehn Minuten |

## Reproduktion

Der Lauf startet die Ingest-Grundlast selbst und fährt beide Generatoren als
Cloud-Run-Jobs, damit weder der Rechner noch die Anbindung der messenden
Person Teil der Messung wird.

```bash
infrastructure/scripts/eval-up.sh

LOGIN_EMAIL=probe-tenanta@example.org LOGIN_PASSWORD=probe-pw-2026 \
  evaluation/scripts/query-scenario.sh          # zehn Minuten

LOGIN_EMAIL=probe-tenanta@example.org LOGIN_PASSWORD=probe-pw-2026 \
  USERS=25 evaluation/scripts/query-scenario.sh 3m
```

Die Probe-Nutzer legt `eval-up.sh` an. Fehlen sie, erzeugt sie

```bash
evaluation/scripts/.venv/bin/python evaluation/scripts/tenant_isolation_probe.py --setup-only
```

## Beim Lesen beachten

Die Antwortzeiten sind client-seitig gemessen und enthalten die Strecke vom
Cloud-Run-Job zum internen Endpunkt. Weil der Job in derselben Region und
demselben VPC läuft, ist dieser Anteil klein gegenüber den gemessenen
Sekunden.

Nicht gemessen wurde die Kombination aus dieser Abfragelast und der
Bereitstellungslatenz aus QS-PER-01. Die dortige zweite Kenngröße stammt von
einer unbelasteten Auswertungs-API und ist mit diesem Ergebnis nicht
verrechenbar.
