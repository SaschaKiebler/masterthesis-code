# QS-MOD-02 – Änderung einer regulatorischen Regel

**Status: erfüllt.** 0 Codeänderungen, 0 berührte Dienste, 0 Neuausrollungen.
Der Durchlauf hat 6 Bedienschritte, die neue Regel lag nach dem Speichern
innerhalb weniger Sekunden auf dem kompaktierten Topic, aus dem der
Analytics-Dienst seine Regeln bezieht.

## Was der Test zeigt

Das Szenario nennt als Beispiel ein Intervall der Verbrauchsinformation. So
etwas gibt es im Prototyp nicht, er bildet keine Berichtspflichten ab.
Regulatorische Vorgaben treten im Prototyp als Erkennungsregeln auf, also als
Schwellwert- und Anomalieregeln des Core. Geprüft wird deshalb eine Regel
dieser Art, eine Warmwettergrenze, ab der Heizbetrieb als unnötig gilt.

Der Durchlauf in der Projekt-IDE.

1. **Anlage wählen.** Der Kessel „Boiler 001" hat zwei Schwellwertregeln und
   zwei Anomalieregeln, alle gelistet.
2. **Neue Regel.** Erkennungsmuster „Heating despite warm weather" wählen,
   Schaltsignal der Pumpe binden, Warmwettergrenze auf 18 °C statt der
   Vorgabe 20 °C setzen, speichern. Die Regel erscheint in der Liste.
3. **Bestehende Regel ändern.** Die Regel „Short cycling (Boiler 001)"
   deaktivieren und wieder aktivieren.
4. **Condition Builder.** Für eine freie Regel öffnet sich der grafische
   Builder, in dem Bedingungen über Fensteraggregate (Mittel, Minimum,
   Maximum, letzter Wert, Einschaltanteil, Schaltflanken pro Stunde,
   Außentemperatur) mit UND und ODER zusammengesetzt werden.

Der Core publiziert die Regel direkt nach dem Commit auf
`anomaly-rule.configured`. Das Skript liest das Topic und findet die
Kennung der neuen Regel dort. Der Analytics-Dienst folgt dem Topic im
laufenden Betrieb, deaktivieren erzeugt einen Tombstone, aktivieren
publiziert die Regel erneut.

## Wie das Ergebnis belegt ist

Wie bei QS-MOD-01 werden Commit-Stand, Arbeitsverzeichnis und Container vor
und nach der Handlung verglichen. Erfassung und Rohdatenhaltung sind
unberührt, weil weder eine Migration lief noch ein Dienst neu startete und die
Regeln auf dem Ereignisstrom wirken, nicht auf der Speicherung.

| Größe | Wert |
|---|---|
| Geänderte Codezeilen | 0 |
| Berührte Dienste | 0 |
| Neuausrollungen | 0 |
| Bedienschritte | 6 |
| Neue Regel auf `anomaly-rule.configured` | ja |
| Parameter der neuen Regel | t_warm_c 18, min_duty 0,5, min_flow_c 45 |

## Grenzen

- **Parameter bestehender Musterregeln** sind in der Oberfläche nicht
  editierbar, nur Schalter und Löschen. Eine Parameteränderung heißt dort
  Löschen und neu Anlegen, oder ein PATCH über die API. Freie Regeln lassen
  sich im Builder bearbeiten. Das ist eine Lücke der Bedienoberfläche, keine
  der Architektur.
- **Variante 2 (neuer Regeltyp)** hängt am Weg. Eine neue Regel als freie
  Bedingung kostet 0 Code. Ein neues kuratiertes Erkennungsmuster berührt
  zwei Bausteine, die Vorlagenliste im Core und die Engine im
  Analytics-Dienst, und liegt damit über dem Sollwert von einem Baustein.
  Die Operatorlogik der Schwellwertregeln steht zudem doppelt im Code, in
  Java im Core (nicht mehr auf dem Auswertungspfad) und in Python im
  Analytics-Dienst.
- Der Ausführende ist der Autor.

## Dateien

- `protokoll.json` – Schritte mit Zählung, Fakten vor und nach der Handlung,
  gebundener Kanal, neue Regel und ihr Nachweis auf dem Topic.
- `screenshots/` – ein Bild je Schritt.

## Wiederholen

```bash
scripts/dev.sh up
evaluation/usability/.venv/bin/python evaluation/scripts/qs_mod_walkthrough.py --only mod-02
```

Das Skript löscht die Regel eines früheren Laufs vorher. Es erwartet die
Flotte „gap" aus `qs_int_01_gap_run.py`, deren Kessel die Regeln trägt.
