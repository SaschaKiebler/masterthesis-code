# Laststufenlauf (ramp), Kalibrierung der Erfassungskette

Kein Szenario aus Kapitel 3, sondern die Voraussetzung ihrer Einordnung. Der
Lauf beantwortet eine einzige Frage, nämlich ob die von QS-PER-02 geforderte
Spitze von 2.500 Messwerten pro Sekunde überhaupt im erreichbaren Bereich der
Ausstattung liegt. Ohne diese Antwort wäre ein Scheitern von QS-PER-02 nicht
von einer zu klein gewählten Ausstattung zu unterscheiden.

Vier Stufen zu je drei Minuten mit 500, 1.000, 2.000 und 2.500 angebotenen
Messwerten pro Sekunde auf derselben Flotte aus 100 Geräten.

## Ergebnis vom 01.09.2026

| Angebotene Rate | Erreichte Rate | p95 der Persistierung |
|---|---|---|
| 500/s | 515/s | rund 16 ms |
| 1.000/s | 1.030/s | 60 bis 122 ms |
| 2.000/s | rund 1.417/s | 2.365 bis 4.893 ms |
| 2.500/s | rund 1.400/s | 5.129 bis 6.989 ms |

Die Kette sättigt bei rund 1.400 Messwerten pro Sekunde. Verloren ging nichts,
846.572 Messwerte wurden persistiert und null Payloads abgewiesen, die Last
staute sich stattdessen in der Latenz. Der Engpass war durchgehend die
Rechenzeit des Messwertspeichers und nicht die Erfassung.

Gemessene Ausstattung zu diesem Zeitpunkt war ein Messwertspeicher mit 500
Millicores und eine Autoskalierung der Erfassung bis sechs Instanzen, im Lauf
ging sie auf fünf. Ein zweiter Lauf mit 2 CPU sättigte bei rund 2.300
Messwerten/s, er wurde nicht als Bericht gesichert und ist nur als
Konsolenwert in `infrastructure/README.md` festgehalten. Als
Konsequenz wurde der Speicher auf 4 CPU angehoben und die Decke der
Autoskalierung auf zehn Instanzen gesetzt. Erst damit lag die geforderte
Spitze im erreichbaren Bereich, was der spätere Lauf von QS-PER-02 mit 2.575
Messwerten pro Sekunde bestätigt.

## Dateien

| Datei | Inhalt |
|---|---|
| `ramp-20260901-140200.txt` | Verlustrate, Minutenprofil, Latenzperzentile je Minute, Zustand der Autoskalierung |

## Reproduktion

Der Lauf gehört an den Anfang einer Messsitzung, weil er die Decke der
Ausstattung bestimmt. Zwölf Minuten Laufzeit plus Auswertung.

```bash
infrastructure/scripts/eval-up.sh
evaluation/scripts/ingest-scenario.sh ramp
```

Die Zahlen oben gelten für 500 Millicores im Messwertspeicher. Die heutige
Konfiguration in `infrastructure/kubernetes/base/measurement-db.yaml` steht auf
4 CPU, ein Wiederholungslauf sättigt deshalb deutlich später. Wer die Zahlen
oben nachstellen will, muss die Zuteilung vorher zurücksetzen.

## Beim Lesen beachten

Die Ende-zu-Ende-Latenz von 18,9 Sekunden im Median betrifft nur die
Heizkessel, also die Geräte mit eigener Uhr. Sie enthält die Wartezeit in den
Warteschlangen des Generators und des Brokers und ist unter Sättigung deshalb
kein Maß der Plattform, sondern eines der Überlast. Aussagekräftig ist in
diesem Lauf allein die Spalte der Persistierungslatenz.
