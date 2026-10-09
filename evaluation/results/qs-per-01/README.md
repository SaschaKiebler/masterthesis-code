# QS-PER-01, Ingest-Durchsatz im Dauerbetrieb

| Stimulus | Response Measure |
|---|---|
| 100 Geräte senden 30 Minuten lang mit 500 Messwerten pro Sekunde | Verlustrate 0 %, p95 der Persistierung unter 500 ms, p95 der Bereitstellung unter 1 s |

Das Szenario hat zwei Kenngrößen, die verschiedene Strecken messen und
deshalb getrennt erhoben werden.

- **Persistierung.** Vom Eintritt in die Plattform bis zur Zeile im
  Messwertspeicher, berechnet im Speicher selbst aus Empfangs- und
  Schreibzeitstempel. Diese Zahl steht im Hauptbericht.
- **Bereitstellung.** Vom Eintritt bis zur Sichtbarkeit in der Auswertungs-API,
  gemessen durch Abfragen im festen Takt. Diese Zahl steht im
  Visibility-Bericht.

## Ergebnis vom 02.09.2026, bestanden

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Verlustrate | 0 % | 0 %, 926.997 persistiert, 0 abgewiesene Payloads |
| Persistierung p95 | unter 500 ms | 7,7 ms, p50 0,8 ms, p99 9,1 ms, max 63,0 ms |
| Bereitstellung p95, Sensoren | unter 1.000 ms | 231 ms, Median 3 ms |
| Bereitstellung p95, Kessel | unter 1.000 ms | 244 ms, Median 14 ms |

Das Minutenprofil liegt über die gesamten 30 Minuten konstant bei 30.900
Messwerten je Minute, ohne Lücke und ohne Drift der Latenz. Die Autoskalierung
blieb bei zwei Instanzen, dem Minimum. Die Grundlast wird also von der
Mindestausstattung getragen, weshalb dieses Szenario die horizontale
Skalierung nicht prüft. Der Beleg dafür kommt aus QS-PER-02.

Der große Abstand zum Zielwert bedeutet, dass 500 Messwerte pro Sekunde für
diese Architektur keine Belastung darstellen. Die Aussage des Szenarios liegt
damit weniger im Bestehen als in der Stabilität über die Dauer.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-per-01-20260902-130633.txt` | der berichtete Lauf, 30 Minuten, mit Verlustrate, Minutenprofil, Perzentilen und Zustand der Autoskalierung |
| `qs-per-01-20260902-130633-scaling.csv` | Instanzzahl, Auslastung und Rechenzeit beider Speicher alle 15 Sekunden |
| `qs-per-01-visibility-20260902-145122.txt` | die zweite Kenngröße mit Auswertung und Nachtrag zur Uhrenkorrektur |
| `qs-per-01-visibility-20260902-145122.csv` | 7.775 Einzelbeobachtungen an 30 Kanälen |
| `qs-per-01-visibility-20260902-145122-baseline.txt` | Tunnel-Latenz des Port-Forwards, der Anteil der nicht der Plattform gehört |
| `qs-per-01-20260901-180048.txt` | ein früherer, ebenfalls bestandener Lauf vom Vortag, p95 5,5 ms |

Berichtet wird der Lauf vom 02.09.2026, weil er mit QS-PER-02 und QS-PER-03 in
einer Sitzung auf derselben Ausstattung lief. Der Lauf vom Vortag bleibt als
Beleg dafür liegen, dass das Ergebnis über zwei Sitzungen hinweg stabil ist.

## Reproduktion

```bash
infrastructure/scripts/eval-up.sh
evaluation/scripts/ingest-scenario.sh qs-per-01          # 30 Minuten
evaluation/scripts/ingest-scenario.sh qs-per-01 600      # kürzer, 10 Minuten
```

Die zweite Kenngröße läuft getrennt. Sie braucht Zugang zu beiden APIs, eine
laufende Telemetrie, weil sonst keine neuen Werte erscheinen, und den vorher
bestimmten Uhrenversatz der messenden Maschine, ohne den das Ergebnis nicht
korrigierbar ist.

```bash
sntp -t 5 time.apple.com                                  # Versatz notieren
kubectl -n heating-platform port-forward svc/core-platform 8080:8080 &
kubectl -n heating-platform port-forward svc/analytics-service 8100:8100 &
kubectl apply -f infrastructure/kubernetes/jobs/mock-run.yaml   # Telemetrie
evaluation/scripts/.venv/bin/python evaluation/scripts/visibility_poller.py \
  --duration 300 --interval 0.5 --channels 30 \
  --csv evaluation/results/qs-per-01/qs-per-01-visibility-$(date +%Y%m%d-%H%M%S).csv
```

Nach dem Lauf den Versatz von den Rohwerten abziehen. Der Bericht des
vorliegenden Laufs führt diese Rechnung im Nachtrag vor.

## Grenzen der zweiten Kenngröße

Sie gehören zur Zahl und stehen deshalb auch im Bericht selbst.

1. Die Rohwerte des Laufs waren negativ, was physikalisch unmöglich ist.
   Ursache ist ein Uhrenversatz von 59 ms zwischen messender Maschine und
   Cluster, gemessen unmittelbar nach dem Lauf mit einer Unsicherheit von
   13 ms. Die berichteten Zahlen sind um diesen Betrag korrigiert. Eine Drift
   während der fünf Minuten ist nicht erfasst.
2. Jede Beobachtung ist eine Obergrenze, gerundet auf den Polltakt von 0,5 s.
   Ein Wert kann frühestens beim nächsten Poll gesehen werden.
3. Der Poller lief über einen Port-Forward mit einer Tunnel-Latenz von 51,5 ms
   im Median. Dieser Anteil steckt in den Zahlen und gehört nicht der
   Plattform.
4. Gemessen wurde gegen eine unbelastete Auswertungs-API. Die Kombination aus
   Bereitstellungslatenz und der Abfragelast von QS-PER-03 wurde nicht
   gemessen.
5. Die um den Uhrenversatz korrigierten Mediane von 3 und 14 ms liegen unter
   der Tunnel-Latenz aus Punkt 3 und sind deshalb nicht interpretierbar, die
   Korrektur ist um mindestens den halben Tunnelweg zu klein. Belastbar ist
   allein der p95 als Obergrenze, Kapitel 6 nennt die Mediane nicht mehr.
