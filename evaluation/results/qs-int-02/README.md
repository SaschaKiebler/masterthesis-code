# QS-INT-02, Provenance der Messwerte

| Stimulus | Response Measure |
|---|---|
| Ein abrechnungsrelevanter Messwert wird verarbeitet | 100 % der persistierten Werte tragen Gerät, Metrik, Mess- und Empfangszeitpunkt, Stichprobe von 100 Werten bis zur Roh-Payload rückverfolgbar |

Der Lauf ist lesend und verändert nichts. Er wertet ein Zeitfenster im
Messwertspeicher aus und zieht dafür den Stammdatenspeicher hinzu.

## Ergebnis vom 03.09.2026, bestanden

Fenster von 20 Minuten über die Flotte `gap` mit 19.076 Messwerten aus 13
Kanälen, also den Daten des QS-INT-01-Laufs samt eines anschließenden kurzen
Laufs mit nicht kommissionierten Geräten.

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Vollständigkeit der vier Felder | 100 % | 100,00 %, kein Feld fehlt |
| Kanäle ohne Registrierung | 0 | 0 von 13 |
| Stichprobe rückverfolgbar | 100 | 100 von 100 |
| Messzeit unabhängig von Empfangszeit | nicht gefordert | 44,0 % aller Werte |

## Was die Prüfung über eine NOT-NULL-Abfrage hinaushebt

**Jeder Wert muss sich im Verzeichnis auflösen.** Ein Kanal, der alle vier
Felder trägt, dessen Gerät und Metrik aber in keinem Messpunkt des
Stammdatenspeichers stehen, hat einen Herkunftsnachweis, den niemand mehr
einlösen kann. Diese Prüfung überspannt beide Datenbanken und ist deshalb die
eine, die das reine SQL-Skript nicht leisten kann.

**Die Rückverfolgung endet an Topic und Feld.** Für einen erfolgreich
verarbeiteten Wert bewahrt die Plattform die Roh-Bytes nicht auf, wohl aber den
Weg dorthin. Aus dem Messpunkt folgen Quelle und Feld, daraus das MQTT-Topic
und der JSON-Schlüssel. Ein Beispiel aus der Stichprobe des Laufs.

```
value        20.5 celsius
measured     2026-09-03T12:16:56.910931+00:00
received     2026-09-03T12:16:56.910931+00:00
persisted    2026-09-03T12:16:56.912086+00:00
device       gap-ht-001-03, metric 1
metric point 08877adc-19e4-5c96-a1b8-9224ba0476c0
arrived on   gap-ht-001-03/status/temperature:0  field 'tC'
```

## Zwei Befunde, die zum Ergebnis gehören

**Die beiden Zeitstempel sind nicht überall unabhängig.** Auf der Shelly-Route
trägt die Nutzlast keine Geräteuhr, weshalb die Erfassung die Empfangszeit in
beide Felder schreibt. Alle vier Felder sind vorhanden, die Messzeit sagt dort
aber nichts über die Empfangszeit hinaus. Im gemessenen Fenster trifft das auf
10.692 Sensorwerte zu, während alle 8.384 Kesselwerte eine eigene Uhr tragen.
Das ist eine Eigenschaft des Geräteprotokolls und nicht der Plattform, gehört
aber ausgewiesen statt weggemittelt.

**Der Fehlerpfad deckt nicht alles ab.** Die Erfassung verwirft eine Nachricht
auf zwei Wegen, und nur einer hinterlässt eine Spur.

| Weg | Spur |
|---|---|
| Parse- oder Schreibfehler | Zeile in `ingestion_errors`, Roh-Payload bleibt erhalten |
| Gerät nicht kommissioniert | verworfen, nur eine INFO-Zeile im Log, keine Zeile |

Der zweite Weg kehrt aus dem Handler mit Erfolg zurück, also vor dem Parsen.
Nachgeprüft mit einem Generatorlauf mit `--rogue`, der aus nicht
kommissionierten Geräten sendete und keine einzige Zeile erzeugte. Für die
Provenance ist das vertretbar, denn es wurde nichts gespeichert, was eine
Herkunft bräuchte. Für den Betrieb ist es eine Lücke, weil ein falsch
konfiguriertes reales Gerät spurlos verschwindet.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-int-02-20260903-143759.txt` | Vollständigkeit, Verzeichnisauflösung, Stichprobe, Fehlerpfad, Unabhängigkeit der Zeitstempel, Urteil |
| `qs-int-02-20260903-143759-sample.csv` | die 100 Werte der Stichprobe mit Topic, Nutzlastfeld, Messpunkt und Ingest-Dauer |

## Reproduktion

```bash
# das jüngste Fenster einer Flotte
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_int_02_provenance_run.py \
  --prefix gap --minutes 20

# ein bestimmtes Fenster, etwa das eines Lastlaufs
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_int_02_provenance_run.py \
  --start '2026-09-02 11:06:34+00' --end '2026-09-02 11:36:58+00'
```

Gegen den Cluster lässt sich derselbe Lauf über zwei Port-Forwards auf die
beiden Speicher fahren, dann mit `--master-dsn` und `--measurement-dsn`.

## Grenzen

Das Szenario prüft die Herkunftskette der Monitoring-Werte. Eichstatus und
Eichfrist nach RB-REG-04 gehören zur Abrechnung, die der Prototyp nicht
umsetzt, und sind deshalb kein Teil des Szenarios. Die Strukturanalyse der
Anschlussfähigkeit in der Arbeit prüft sie als Posten der Abrechnung. Die
Stichprobe umfasst wie gefordert 100 Werte und ist deterministisch nach
Empfangszeit geordnet, also keine Zufallsstichprobe im statistischen Sinn.
