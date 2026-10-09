# Messergebnisse

Ein Ordner je Szenario, darin die Rohdateien des Laufs und ein README, das den
Test erklärt, sein Ergebnis nennt und zeigt, wie er zu wiederholen ist. Die
Skripte schreiben neue Läufe selbst in den passenden Ordner.

Den gemeinsamen Aufbau, also Messumgebung, Testdaten, Latenzbegriffe und
Fallstricke, beschreibt [evaluation/README.md](../README.md). Hier stehen nur
die Ergebnisse.

| Ordner | Szenario | Status | Kernzahl |
|---|---|---|---|
| [ramp](ramp) | Laststufenlauf, Kalibrierung der Erfassungskette | Voraussetzung, kein Szenario | Sättigung bei rund 1.400 Messwerten/s mit 500 Millicores im Speicher |
| [qs-per-01](qs-per-01) | Ingest-Durchsatz im Dauerbetrieb | erfüllt | Verlust 0 %, p95 Persistierung 7,7 ms, p95 Bereitstellung 231 ms |
| [qs-per-02](qs-per-02) | Lastspitze im Ingest | erfüllt | 2.575 Messwerte/s, Verlust 0 %, Skalierung 2 auf 8 Instanzen |
| [qs-per-03](qs-per-03) | Abfrage-APIs unter Last | nicht erfüllt | p95 7.600 ms gegen 300 ms, 24,2 statt 100 Anfragen/s durchgesetzt, Fehlerrate 0,51 % eingehalten |
| [qs-sec-01](qs-sec-01) | mandantenübergreifender Zugriffsversuch | erfüllt | 0 Lecks aus 122.787 Versuchen, 107.401 Audit-Einträge |
| [qs-sec-02](qs-sec-02) | Auskunft und Löschung nach DSGVO | erfüllt | 100 % Abdeckung, 0 Treffer nach dem Löschlauf, 0,8 s |
| [qs-int-01](qs-int-01) | Messlücke bei Sensorausfall | erfüllt | Verlust 0 %, 0 Werte in der Lücke in Speicher, API und Analyse-Ansicht |
| [qs-int-02](qs-int-02) | Provenance der Messwerte | erfüllt | 4 Felder zu 100 %, 0 Kanäle ohne Registrierung, 100/100 rückverfolgbar |
| [qs-mod-01](qs-mod-01) | Aufnahme eines neuen Gerätetyps | erfüllt | 0 Codeänderungen, 0 Neuausrollungen, 11 Bedienschritte, erster Messwert nach 28,9 s |
| [qs-mod-02](qs-mod-02) | Neue Regel | erfüllt | 0 Codeänderungen, 0 Neuausrollungen, 6 Bedienschritte, Regel nach dem Commit auf dem Topic |
| [qs-usa-01](qs-usa-01) | Selbsterklärende Erstinbetriebnahme | erfüllt | 7 Bedienschritte ab der Startseite, 9 ab der Anmeldung |

Die vier Lastszenarien und QS-SEC-01 liefen in der Messumgebung auf Google
Kubernetes Engine, QS-SEC-02, die beiden Integritätsszenarien, die beiden
Änderungsexperimente und der Bedienbarkeitsdurchlauf auf dem lokalen
Entwicklungsstack. Die Gründe stehen im jeweiligen README.

Damit haben alle zehn Szenarien einen Ergebnisordner.

## Was ein Ergebnisordner enthält

Fehlgeschlagene und verworfene Läufe bleiben liegen, wenn die Korrektur
zwischen ihnen zum Befund gehört. `results/qs-per-02` enthält deshalb neben
dem bestandenen Lauf auch einen verworfenen und die Skalierungsdaten eines
Laufs mit erschöpftem Verbindungspool. Ein Protokoll ohne Ergebnis wird
umbenannt und bekommt eine Fußnote, die erklärt, warum es nicht zählt, damit
es sich nicht später wie ein gültiges Ergebnis liest.

## Zählregel für Bedienschritte

QS-USA-01, QS-MOD-01 und QS-MOD-02 zählen Bedienschritte. Die Regel legt
Kapitel 6.2 der Arbeit fest und gilt hier wörtlich. Als Bedienschritt zählt
jede Stelle, an der die Fachkraft etwas auswählt, eingibt oder auslöst. Ein
Weiter, das nur eine getroffene Auswahl bestätigt, zählt nicht, die Felder
eines Formulars zählen zusammen, Scrollen, Lesen und Überfahren zählen nie.
Jeder Schritt ist mit einem Screenshot belegt, sodass die Zahl nachgezählt
werden kann. Weil auch der Startpunkt eine Wertung ist, weist QS-USA-01 zwei
Summen aus, ab der Anmeldung und ab der Startseite.
