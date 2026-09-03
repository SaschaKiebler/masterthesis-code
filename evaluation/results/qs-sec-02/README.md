# QS-SEC-02, Auskunft und Löschung nach DSGVO

| Stimulus | Response Measure |
|---|---|
| Ein Betroffener stellt einen Auskunfts- und Löschantrag, das Referenzinventar ist vorab eingespielt | Export deckt 100 % des Referenzinventars ab, nach dem Löschlauf 0 Treffer bei Nachabfrage, Laufzeit unter 15 Minuten |

Das einzige Szenario, das nicht im Cluster gemessen wird, sondern auf dem
lokalen Entwicklungsstack. Es braucht keine Last, und der Löschlauf ist auf
einer synthetischen Person destruktiv, was lokal nichts kostet.

Das Referenzinventar wird aus den Daten gebildet und nicht aus dem Export. Ein
eigenständiger Graph-Walk in SQL geht von der Person über `RESIDES_IN`,
`CONTAINS` und `INSTALLED_IN` zu den Geräten und zählt deren Messreihen im
Messwertspeicher. Erst danach wird der Export Posten für Posten dagegen
geprüft. Andernfalls prüfte der Export sich selbst.

## Ergebnis vom 02.09.2026, bestanden

Subjekt war eine synthetische Person mit einem Wohnort, einem darüber
erreichbaren Raumsensor und 126 Messwerten aus zwei Minuten Telemetrie.

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Abdeckung des Exports | 100 % | 100 %, fünf von fünf Posten |
| Treffer nach dem Löschlauf | 0 | 0 in allen sechs Abschnitten des Residual-Checks |
| Nachabfrage | keine Auskunft mehr | HTTP 404, keine Links mehr am Objekt |
| Laufzeit | unter 15 min | 0,8 s gesamt, Löschaufruf 0,07 s, Export 0,11 s |
| Messreihen nach der Löschung | | 126 Zeilen, unverändert, ohne Personenbezug |

Die fünf Posten der Abdeckung sind der Anzeigename, der Satz der gespeicherten
Eigenschaften, die Menge der Wohnorte, die Menge der über den Graph
erreichbaren Geräte und je Gerät die Messreihe, bei der sowohl die gemeldete
Zahl als auch die Zahl der tatsächlich gelieferten Werte mit dem
Messwertspeicher übereinstimmen muss.

## Die Abweichung vom Entwurf gehört zum Ergebnis

Kapitel 4 sieht die Löschung auch im Messwertspeicher entlang der betroffenen
Geräte und Zeiträume vor. Der Prototyp lässt die 126 Messwerte unverändert
stehen. Mit der Kante `RESIDES_IN` verliert die Reihe ihren Personenbezug, die
Werte bleiben wegen der Aufbewahrungspflicht für abrechnungsrelevante Daten
nach Art. 17 Abs. 3 lit. b DSGVO und wegen der Rohdatenintegrität erhalten.
Das Protokoll weist die Zeilenzahl vor und nach dem Löschlauf aus, weil genau
diese Zahl der Beleg für den Trade-off zwischen QA-SEC und QA-INT in Kapitel 6
ist. Das Restrisiko der Re-Identifizierung bei einer Wohneinheit mit nur einem
Bewohner bleibt bestehen.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-sec-02-20260902-164933.txt` | Inventar, Abgleich je Posten mit Abdeckung, Löschbericht mit Dauer, Residual-Check wörtlich, Nachabfrage, Urteil und Nachtrag zur Reproduktion |
| `qs-sec-02-20260902-164933-export.json` | der Export unverändert, also die Kopie nach Art. 15 Abs. 3 |

## Reproduktion

Der Lauf ist vollständig automatisiert. Ein erneutes Seeding legt die
gelöschte Person wieder an, der Lauf lässt sich also wiederholen.

```bash
# 1  Dev-Stack starten
scripts/dev.sh up

# 2  Flotte MIT Personen seeden, eigenes Präfix, damit die tenanta-Flotte
#    der Lastszenarien unberührt bleibt
applications/mock-service/.venv/bin/mock-service seed \
  --prefix gdpr --sites 1 --rooms 2 --persons 2

# 3  Zwei Minuten Telemetrie, damit die Messreihen nicht leer sind. Die
#    Geräteverwaltung braucht bis zu 30 s, bis die neuen Geräte freigegeben
#    sind, deshalb zuerst warten. Der Generator MUSS beendet sein, sonst
#    driften die Zeilenzahlen zwischen Inventar und Export.
sleep 40
applications/mock-service/.venv/bin/mock-service run \
  --prefix gdpr --sites 1 --rooms 2 --interval 2 --duration 120

# 4  Der Lauf
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_sec_02_privacy_run.py --prefix gdpr

# nur Export und Abdeckung, ohne Löschung
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_sec_02_privacy_run.py --prefix gdpr --skip-erase
```

Das Auswertungs-venv braucht neben `requests` auch `psycopg`, weil das
Inventar direkt aus beiden Speichern gelesen wird.

```bash
python3 -m venv evaluation/scripts/.venv
evaluation/scripts/.venv/bin/pip install 'requests>=2.31' 'psycopg[binary]>=3.1'
```

Mit `--subject-id` lässt sich jede andere Person messen. Ohne die Angabe ist
das Subjekt Person 1 an Standort 1 des Präfix, deren Kennung deterministisch
aus derselben uuid5-Regel folgt, die der mock-service benutzt.

## Grenzen

Der Residual-Check prüft den Stammdatenspeicher und nicht das Event-Backbone,
dessen Aufbewahrung und Tombstones Topic-Konfiguration sind. Das
Zugriffsprotokoll wird bei Löschungen von Plattformnutzern bewusst behalten,
für die hier gemessene Löschung eines Bewohners war es leer. Gemessen wurde
eine Person mit einem Gerät, die Vollständigkeit des Graph-Walks bei
verschachtelten Räumen und mehreren Geräten ist über Unit-Tests belegt und
nicht über diesen Lauf. Die Laufzeit stammt vom Entwicklungsrechner und nicht
aus der Messumgebung, was bei drei Größenordnungen Abstand zum Zielwert ohne
Folgen bleibt.
