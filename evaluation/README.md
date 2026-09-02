# Messaufbau der Evaluation

Zugehörig zu Kapitel 6 der Masterarbeit. Dieses Dokument beschreibt, wie die
Lastszenarien aufgebaut sind, welche Endpunkte und Testdaten sie verwenden und
wie ein Messlauf gestartet und nachvollzogen wird. Es richtet sich an alle, die
ein Ergebnis aus Kapitel 6 nachrechnen oder einen Lauf wiederholen wollen.

## 1 Was gemessen wird

| Szenario | Last | Zielwerte |
|---|---|---|
| QS-PER-01 | 100 Geräte, 500 Messwerte/s, 30 Minuten | Verlustrate 0 %, p95 der Ingest-Latenz unter 500 ms |
| QS-PER-02 | Aus der Grundlast heraus 5 Minuten auf 2.500 Messwerte/s | Verlustrate 0 %, Erholung binnen 5 Minuten |
| QS-PER-03 | 50 Nutzer, 100 Requests/s gegen Core und Analytics | p95 unter 300 ms, Fehlerrate unter 1 % |

Dazu kommt ein Vorlauf, der nicht Teil der Szenarien ist, aber Voraussetzung für
deren Einordnung.

| Vorlauf | Last | Zweck |
|---|---|---|
| `ramp` | Vier Stufen à drei Minuten mit 500, 1.000, 2.000 und 2.500 Messwerten/s | Bestimmt die Sättigungsgrenze der Erfassungskette und damit, ob die Spitze aus QS-PER-02 überhaupt erreichbar ist |

## 2 Die beiden Latenzbegriffe

Die Tabelle `measurements` trägt zwei Zeitstempel, die im Protokoll streng
auseinanderzuhalten sind.

- `received_at` ist der Zeitpunkt, zu dem der Erfassungsdienst die Nachricht von
  MQTT entgegengenommen hat. Das ist der Systemeingang.
- `persisted_at` ist der Zeitpunkt, zu dem die Zeile im Messwertspeicher stand.
  Ihn setzt die Datenbank per `DEFAULT now()`, wodurch der Schreibpfad ein
  einziger INSERT bleibt.

Daraus ergeben sich zwei Größen:

- **Ingest-Latenz** = `persisted_at - received_at`. Das ist der Response Measure
  von QS-PER-01 und QS-PER-02. Beide Zeitstempel entstehen serverseitig, es geht
  also nur der geringe Uhrenversatz zwischen zwei Pods ein.
- **Ende zu Ende** = `persisted_at - time`. Nur dort aussagekräftig, wo die
  Nutzlast eine eigene Uhr mitbringt. Das trifft auf den Kessel und auf Tasmota
  zu, nicht auf die Shelly-Statusnachrichten, deren `time` bereits die
  Empfangszeit ist. Die Auswertung weist den Wert deshalb getrennt nach
  Gerätefamilie aus.

## 3 Testdaten, die simulierte Flotte

Erzeugt vom `mock-service` unter [applications/mock-service](../applications/mock-service).
Die Flotte ist deterministisch, sie hängt nur an Präfix, Standortzahl, Raumzahl
und RNG-Seed. Gleiche Parameter ergeben dieselben Geräte-IDs und dieselben
Messreihen.

Die Zusammensetzung steht in
[infrastructure/kubernetes/jobs/mock-seed.yaml](../infrastructure/kubernetes/jobs/mock-seed.yaml).

```
25 Standorte x (1 Heizkessel + 3 Raumsensoren) = 100 Geräte
Präfix "tenanta", Seed 42
tenanta-boiler-001 .. tenanta-boiler-025
tenanta-ht-001-01  .. tenanta-ht-025-03
```

Das Präfix ist nicht beliebig, denn aus ihm wird die Mandanten-ID abgeleitet.
Mit `tenanta` liegt die vermessene Flotte im selben Mandanten wie der Nutzer,
mit dem QS-PER-03 sich anmeldet. Die Abfragelast läuft dadurch **durch** die
Mandantendurchsetzung hindurch und nicht als Systemadministrator daran vorbei.
Zusätzlich wird ein zweiter, bewusst kleiner Mandant `tenantb` mit vier Geräten
angelegt. Er gehört zu keinem Lastszenario und dient nur den Fixtures der
Mandantenprüfung.

Was ein Gerät je Sendeintervall auf den Broker legt:

| Gerät | Topic | Nutzlast | je Intervall |
|---|---|---|---|
| Heizkessel (generische Route) | `<geräte-id>/data` | ein JSON-Dokument mit `flow_c`, `return_c`, `power_kw`, `pump` | 1 Nachricht, 4 Messwerte |
| Shelly H&T (Gen2-nativ) | `<geräte-id>/status/temperature:0`, `<geräte-id>/status/humidity:0` | je ein Statusobjekt | 2 Nachrichten, je 1 Messwert |
| Shelly H&T, Batterie | `<geräte-id>/status/devicepower:0` | Batteriestand | nur jeden 10. Tick, weil echte Geräte das selten melden |

Daraus die Rechnung, mit der die Lastrate eingestellt wird:

```
je Intervall  175 Nachrichten, 250 Messwerte
Messwerte/s = 250 / Intervall

Intervall 0,5   s  ->    500 Messwerte/s   (QS-PER-01, Grundlast)
Intervall 0,125 s  ->  2.000 Messwerte/s   (Spitzenanteil QS-PER-02)
Intervall 0,1   s  ->  2.500 Messwerte/s
```

Die Spitze in QS-PER-02 entsteht durch einen **zweiten** Generator, der
zusätzlich zur weiterlaufenden Grundlast auf dieselbe Flotte sendet. Die Geräte
melden sich dadurch häufiger, was genau die im Szenario beschriebene Lastspitze
ist.

Wichtig für die Auswertung: Die Szenarien sind in **Messwerten** spezifiziert,
der Generator zählt aber auch **Nachrichten**. Eine Kesselnachricht trägt vier
Messwerte, eine Shelly-Nachricht einen. Beide Zahlen gehören ins Protokoll.

Damit ein Gerät überhaupt angenommen wird, muss es zuvor kommissioniert sein.
Der Seed-Job schreibt die Flotte in die Stammdaten-Datenbank, device-management
veröffentlicht daraus im nächsten Sweep das kompaktierte Kafka-Topic
`device.configured`, und erst dessen Projektion öffnet im Erfassungsdienst das
Tor für die betreffende Geräte-ID. Nicht kommissionierte Geräte werden bewusst
verworfen.

## 4 Endpunkte

Die Lasterzeugung läuft **außerhalb** des Clusters. Ein Generator im Cluster
würde mit den zu messenden Diensten um Pod-Ressourcen konkurrieren.

### Regelfall, VPC-intern

Definiert in
[infrastructure/kubernetes/eval/internal-access.yaml](../infrastructure/kubernetes/eval/internal-access.yaml).

| Service | Port | Zweck |
|---|---|---|
| `mosquitto-internal` | 1883 | MQTT-Eingang für die Generatoren |
| `core-platform-internal` | 8080 | Abfrage-API des Core |
| `analytics-internal` | 8100 | Statistik-API von Analytics |

Alle drei sind interne LoadBalancer und nur aus dem VPC erreichbar. Der Generator
läuft als Cloud-Run-Job mit Direct VPC Egress und liegt damit außerhalb des
Clusters, aber innerhalb des Projekts. Das braucht keinerlei öffentliche
Freigabe.

### Ausnahme, öffentlich

Definiert in
[infrastructure/kubernetes/eval/external-access.yaml](../infrastructure/kubernetes/eval/external-access.yaml).

Seit auch der Lastgenerator für die Abfrage-APIs als Cloud-Run-Job läuft, wird
dieser Weg für keines der drei Szenarien mehr gebraucht. Er bleibt als
Rückfallweg, etwa um die Weboberfläche von Hand anzusehen oder einen Generator
ausnahmsweise vom eigenen Rechner zu fahren. Jeder LoadBalancer wird dabei per
`loadBalancerSourceRanges` auf eine einzelne Adresse begrenzt. Das ist nicht optional, denn der Broker läuft mit
`allow_anonymous`, und ein offener MQTT-Port im Netz würde fremde Publishes
annehmen und die Messung verfälschen. Diese Services sind **vor** dem Abbau des
Clusters zu löschen, sonst können die Forwarding-Rules den Cluster überleben.

Beim Ermitteln der eigenen Adresse ist `curl -4` zwingend. Auf einem
Dual-Stack-Anschluss antwortet `ifconfig.me` sonst mit der IPv6-Adresse, und die
Regel passt dann nicht auf den tatsächlichen Verkehr.

## 5 Konfiguration des vermessenen Systems

Die Zahlen in Kapitel 6 gelten für genau diese Ausstattung. Sie steht in
[infrastructure/kubernetes/base](../infrastructure/kubernetes/base) und wandert
über das GKE-Overlay in den Cluster.

| Komponente | Ausstattung |
|---|---|
| Messwertspeicher | TimescaleDB, 1 Instanz, 4 CPU, 4 GiB, `max_connections = 100` |
| Erfassungsdienst | 2 bis 10 Instanzen, HPA auf 70 % CPU, 250m CPU je Instanz, `DB_MAX_CONNECTIONS = 6` |
| Broker | Mosquitto, 1 Instanz, 100m CPU |
| Event-Backbone | Kafka, 1 Broker, 500m CPU |
| Cluster | GKE Autopilot, europe-west3 |

Zwei Zuteilungen sind bewusst gewählt und nicht beliebig.

- **Die CPU des Messwertspeichers** ist der wirksamste Stellhebel der ganzen
  Kette. Mit 500m sättigt die Kette bei rund 1.400 Messwerten/s, mit 2 CPU bei
  rund 2.300. Der Zusammenhang ist deutlich sublinear.
- **Das Verbindungsbudget** ergibt sich aus `max_connections`. Zehn Instanzen zu
  je sechs Verbindungen belegen höchstens 60 von 100, der Rest bleibt für
  Analytics, Core und die Superuser-Reserve. Ohne diese Grenze bemisst der Pool
  sich an den CPUs des **Knotens**, was mit der Belastbarkeit der Datenbank
  nichts zu tun hat.

## 6 Einen Messlauf durchführen

Voraussetzungen sind ein angemeldetes `gcloud`, dazu `terraform` und `kubectl`,
sowie für den lokalen Generator das venv unter
`applications/mock-service/.venv`.

```bash
# 1  Umgebung aufbauen. Legt Cluster, Plattform, Flotte, interne Endpunkte und
#    den Generator-Job an. --smoke hängt 60 s Telemetrie an und prüft, dass
#    Zeilen ankommen.
infrastructure/scripts/eval-up.sh --smoke

# 2  Kapazität bestimmen, zwölf Minuten. Zuerst fahren, sonst ist unklar, ob die
#    Spitze aus QS-PER-02 überhaupt im erreichbaren Bereich liegt.
evaluation/scripts/ingest-scenario.sh ramp

# 3  Die Ingest-Szenarien
evaluation/scripts/ingest-scenario.sh qs-per-01     # 30 Minuten
evaluation/scripts/ingest-scenario.sh qs-per-02     # 15 Minuten

# 4  Abfrage-APIs unter Last (QS-PER-03). Startet eine Ingest-Grundlast und
#    fährt locust gegen beide Abfrage-APIs, beides als Cloud-Run-Job.
evaluation/scripts/query-scenario.sh

# 5  Abbauen. Entfernt beide Endpunkt-Sätze, dann den Cluster, und prüft danach
#    bei GCP nach, ob wirklich nichts mehr läuft.
infrastructure/scripts/eval-down.sh
```

Die Anmeldung bei QS-PER-03 erfolgt voreingestellt als
`probe-tenanta@example.org`, also mandantengebunden. Diesen Nutzer legt
`eval-up.sh` beim Aufbau an, indem es
`evaluation/scripts/tenant_isolation_probe.py --setup-only` über einen
`kubectl port-forward` gegen den Cluster laufen lässt. Auch dafür muss also
nichts öffentlich freigegeben werden.

Der Grund für den Aufwand: Ein Systemadministrator beendet die Mandantenprüfung
in ihrer ersten Zeile. Ein Lauf als `admin@local` würde die Kosten der
Durchsetzung deshalb als null ausweisen. Falls die Nutzeranlage beim Aufbau
fehlschlägt, warnt `eval-up.sh` und die Anmeldung lässt sich überschreiben.

```bash
LOGIN_EMAIL=admin@local LOGIN_PASSWORD=admin \
  evaluation/scripts/query-scenario.sh   # ohne Mandantendurchsetzung
```

Standardmäßig zerstört `eval-down.sh` nur den Cluster. Registry und Netzwerk
bleiben, damit die nächste Sitzung auf den bereits gebauten Images aufsetzt.
`eval-down.sh --all` räumt zusätzlich Registry und Images ab, danach ist erst
wieder ein vollständiger Build nötig.

Images neu bauen, falls Quellcode geändert wurde:

```bash
infrastructure/scripts/cloudbuild-all.sh                    # alle acht
infrastructure/scripts/cloudbuild-all.sh ingestion-service  # gezielt
infrastructure/scripts/cloudbuild-all.sh locust-load        # nur der Lastgenerator
```

Der Generator läuft per Voreinstellung als Cloud-Run-Job. Mit `GEN=local` und
gesetztem `BROKER` lässt sich stattdessen vom eigenen Rechner senden, was aber
die öffentlichen Endpunkte voraussetzt und den eigenen Uplink zum Teil der
Messung macht.

## 7 Ergebnisse nachvollziehen

Jeder Lauf schreibt nach [evaluation/results](results) zwei Dateien.

| Datei | Inhalt |
|---|---|
| `<szenario>-<zeitstempel>.txt` | Bericht mit Messfenster, Verlustrate, Latenzperzentilen, Zustand der Erfassung und den Autoskalierungs-Ereignissen |
| `<szenario>-<zeitstempel>-scaling.csv` | Zeitreihe alle 15 s mit Replicas, bereiten Pods, HPA-Auslastung sowie der CPU von Speicher und Erfassung |

Bei QS-PER-03 kommen die Rohdaten von locust dazu. Ein Cloud-Run-Job hat kein
abholbares Dateisystem, deshalb schreibt der Container die CSVs zwischen
Markierungen auf die Standardausgabe, und das Runner-Skript holt sie aus Cloud
Logging zurück.

| Datei | Inhalt |
|---|---|
| `qs-per-03-<zeitstempel>-stats.csv` | Kennzahlen je Endpunkt, darunter p95 und Fehlerzahl |
| `qs-per-03-<zeitstempel>-failures.csv` | Fehlgeschlagene Requests nach Ursache |
| `qs-per-03-<zeitstempel>-stats_history.csv` | Sekundenweiser Verlauf, Grundlage für einen Zeitreihenplot |

Der Bericht entsteht aus zwei SQL-Skripten, die sich auch von Hand gegen ein
beliebiges Fenster fahren lassen.

```bash
kubectl -n heating-platform exec -i measurement-db-0 -- \
  psql -U postgres -d digital_demon_measurements \
  -v start="'2026-09-01 16:00:00+00'" -v end="'2026-09-01 16:30:00+00'" \
  -f - < evaluation/sql/loss-rate.sql
```

- [`evaluation/sql/loss-rate.sql`](sql/loss-rate.sql) liefert die persistierten
  Messwerte im Fenster, die Aufteilung nach Gerätefamilie, abgewiesene
  Nutzlasten mit Begründung und das Minutenprofil der Ankünfte. Das Fenster
  filtert auf `received_at` und nicht auf `time`, sonst könnte eine abweichende
  Geräteuhr Zeilen aus dem Fenster ziehen, die die Plattform sehr wohl darin
  angenommen hat.
- [`evaluation/sql/latency-percentiles.sql`](sql/latency-percentiles.sql) liefert
  p50, p95, p99 und Maximum der Ingest-Latenz, dazu den p95 je Minute für die
  Erholung nach der Spitze, sowie Ende zu Ende getrennt nach Gerätefamilie.

Die Verlustrate ergibt sich erst aus beiden Seiten.

```
Verlustrate = 1 - (persistierte Messwerte / erzeugte Messwerte)
```

Die erzeugte Menge steht in der Abschlusszeile des Generators, die der Bericht
mit ausgibt und die sonst in Cloud Logging liegt.

```bash
gcloud logging read \
  'resource.type=cloud_run_job AND textPayload:"run finished"' \
  --project heating-platform-eval --limit 5

# Format: published=<Nachrichten> measurements=<Messwerte> dropped=<...>
```

`dropped` zählt Nachrichten, die der **Generator** selbst nicht losgeworden ist.
Das ist kein Plattformverlust, bedeutet aber, dass die angebotene Last nicht
erreicht wurde. Beide Größen gehören getrennt ins Protokoll.

## 8 Fallstricke, die einen Lauf still entwerten

Alle folgenden Punkte sind in echten Läufen aufgetreten. Sie sind inzwischen im
Code oder in den Skripten behoben, stehen hier aber, weil sie sich in einem
Bericht nicht von einem gültigen Ergebnis unterscheiden lassen.

- **Zwei Generatoren mit gleicher MQTT-Client-ID schießen sich gegenseitig ab.**
  Der Broker trennt die ältere Verbindung, sobald sich eine zweite mit derselben
  ID meldet. Beide reconnecten dann in einer Schleife. Sichtbar an hohen
  `dropped`- und `errors`-Zählern des Generators. Behoben durch einen
  prozess-eindeutigen Suffix.
- **Der Startvorgang hängt an der Reihenfolge.** Core und notification teilen
  sich die Stammdaten-Datenbank. Wer zuerst migriert, entscheidet, ob die
  Baseline korrekt gesetzt wird. Ebenso legen die Dienste ihre Kafka-Topics nur
  einmal beim Start an. Beides ist über `baseline-version: 0` und
  `spring.kafka.admin.fail-fast` entschärft.
- **Das Plattenkontingent begrenzt den Cluster, nicht die Rechenleistung.**
  `SSD_TOTAL_GB` liegt bei 500 GB je Region, und jeder Autopilot-Knoten belegt
  davon 100 GB für seine Boot-Platte. Da Autopilot je nicht platzierbarem Pod
  einen Knoten nachlegt, entsteht ein Teufelskreis, sobald die Volumes fehlen.
  `eval-up.sh` rollt deshalb gestaffelt aus, erst die Speicher und dann die
  zustandslosen Dienste. Ein zerstörter Cluster nimmt seine Platten außerdem
  nicht mit, weshalb `eval-down.sh` erst die PVCs löscht und dann den Cluster.
- **Der Uhrenversatz der messenden Maschine ist bei der Sichtbarkeitslatenz
  keine Kleinigkeit.** Er lag bei 59 ms und damit in der Größenordnung der
  Messgröße selbst, erkennbar an physikalisch unmöglichen negativen Werten. Vor
  und nach einem solchen Lauf `sntp -t 5 time.apple.com` ausführen und den
  Versatz protokollieren.

## 9 Abweichungen vom ursprünglichen Messplan

- **Der Generator läuft als Cloud-Run-Job in derselben Region** und nicht auf dem
  Rechner der Betreiberin oder des Betreibers. Der Grund ist zum einen, dass
  1.750 Nachrichten/s aus einem Campus-Netz heraus selbst zum Messfaktor
  geworden wären, zum anderen entfällt damit jede öffentliche Freigabe. Die
  Folge ist, dass die WAN-Strecke wegfällt. Für die Ingest-Latenz spielt das
  keine Rolle, weil beide Zeitstempel serverseitig entstehen. Die
  Ende-zu-Ende-Zahl wird dadurch optimistisch und ist entsprechend zu lesen.
- **Die Spitze in QS-PER-02 entsteht durch einen zweiten Generator** auf
  derselben Flotte und nicht durch mehr Geräte. Gemessen wird damit eine
  Erhöhung der Melderate und nicht ein Zuwachs an Verbindungen.
- **Auch der Lastgenerator für die Abfrage-APIs läuft als Cloud-Run-Job.** Damit
  hängt keines der drei Szenarien mehr an der Leistung oder der Anbindung eines
  einzelnen Arbeitsrechners. Die im locustfile dokumentierte WAN-Grundlinie
  misst folglich die Strecke innerhalb der Region und nicht die zum Arbeitsplatz,
  was die client-seitig gemessenen Antwortzeiten näher an die reine
  Verarbeitungszeit der Plattform rückt.

## 10 QS-SEC-02, Auskunft und Löschung

Das einzige Szenario, das nicht im Cluster, sondern auf dem lokalen Dev-Stack
gemessen wird. Es braucht keine Last, und der Löschlauf ist auf einer
synthetischen Person destruktiv, was lokal nichts kostet.

| Szenario | Umgebung | Zielwerte |
|---|---|---|
| QS-SEC-02 | Referenzinventar bekannten Umfangs, eine `PERSON` mit `RESIDES_IN` auf einen Raum | Export deckt 100 % des Inventars ab, 0 Treffer nach dem Löschlauf, Laufzeit unter 15 Minuten |

Der Lauf ist in [`evaluation/scripts/qs_sec_02_privacy_run.py`](scripts/qs_sec_02_privacy_run.py)
vollständig automatisiert. Das Skript erhebt zuerst das Referenzinventar aus
den beiden Speichern, holt dann den Export, vergleicht beides Posten für
Posten, löscht mit Zeitmessung, fährt den Residual-Check und fragt danach die
API und den Messwertspeicher noch einmal ab.

```bash
# 1  Dev-Stack starten
scripts/dev.sh up

# 2  Flotte MIT Personen seeden. Eigenes Präfix, damit die tenanta-Flotte der
#    Lastszenarien unberührt bleibt.
applications/mock-service/.venv/bin/mock-service seed --prefix gdpr --sites 1 --rooms 2 --persons 2

# 3  Zwei Minuten Telemetrie, damit die Messreihen der Person nicht leer sind.
#    device-management braucht bis zu 30 s, bis device.configured den Weg für
#    die neuen Geräte öffnet, deshalb zuerst kurz warten. Der Generator MUSS
#    beendet sein, bevor Schritt 4 läuft, sonst driften die Zeilenzahlen
#    zwischen Inventar und Export.
sleep 40
applications/mock-service/.venv/bin/mock-service run --prefix gdpr --sites 1 --rooms 2 --interval 2 --duration 120

# 4  Der Lauf. Person 1 an Standort 1 ist das Subjekt, ihre ID ist
#    deterministisch und braucht kein Nachschlagen. Das venv braucht neben
#    requests auch psycopg, weil das Inventar direkt aus beiden Speichern
#    gelesen wird (einmalig anlegen):
#      python3 -m venv evaluation/scripts/.venv
#      evaluation/scripts/.venv/bin/pip install 'requests>=2.31' 'psycopg[binary]>=3.1'
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_sec_02_privacy_run.py --prefix gdpr

# nur Export und Abdeckung, ohne Löschung
evaluation/scripts/.venv/bin/python evaluation/scripts/qs_sec_02_privacy_run.py --prefix gdpr --skip-erase
```

Ein erneutes `seed` legt die gelöschte Person wieder an, der Lauf lässt sich
also wiederholen. Mit `--subject-id` lässt sich auch eine beliebige andere
`PERSON` messen.

### Was das Skript als Beleg schreibt

Zwei Dateien in [evaluation/results](results).

| Datei | Inhalt |
|---|---|
| `qs-sec-02-<zeitstempel>.txt` | Inventar, Abgleich je Posten mit Abdeckung in Prozent, Löschbericht mit Dauer, Residual-Check wörtlich, Nachabfrage, Urteil |
| `qs-sec-02-<zeitstempel>-export.json` | der Export unverändert, das ist die Kopie nach Art. 15 Abs. 3 |

Der Kopf des Protokolls hält den Codestand, den Rechner und die drei Befehle
fest, mit denen der Lauf entstanden ist.

Das Referenzinventar wird aus den Daten und nicht aus dem Export gebildet.
[`evaluation/sql/privacy-inventory.sql`](sql/privacy-inventory.sql) enthält
denselben Graph-Walk als eigenständiges psql-Skript, damit sich das Inventar
auch von Hand nachziehen lässt. Der Residual-Check ist
[`evaluation/sql/privacy-residual-check.sql`](sql/privacy-residual-check.sql),
das Skript führt ihn unverändert über `psql` im Container aus und zählt die
Treffer je Abschnitt.

### Wie das Ergebnis zu lesen ist

Die Abdeckung zählt Posten, nicht Bytes. Ein Posten ist der Anzeigename, der
Satz der gespeicherten Eigenschaften, die Menge der Wohnorte, die Menge der
über den Graph erreichbaren Geräte sowie je Gerät die Messreihe, bei der
sowohl die gemeldete Zahl als auch die Zahl der tatsächlich mitgelieferten
Werte mit dem Messwertspeicher übereinstimmen muss.

Der Residual-Check hat sechs Abschnitte, deren Treffer Befunde sind, und einen
Abschnitt E1 mit erwarteten Treffern, weil das Zugriffsprotokoll aus Gründen
der Nachvollziehbarkeit bewusst nicht gelöscht wird.

Die Messreihen bleiben nach der Löschung unverändert stehen, und das Skript
weist die Zeilenzahl vor und nach dem Löschlauf aus. Das ist kein Fehler,
sondern die beabsichtigte Abweichung vom Entwurf in Kapitel 4, der eine
Löschung auch im Messwertspeicher vorsieht. Die Umsetzung kappt stattdessen
die Kante `RESIDES_IN`, wodurch die Reihe ihren Personenbezug verliert, und
behält die Werte wegen der Aufbewahrungspflicht für abrechnungsrelevante Daten
und wegen QA-INT. Diese Zahl ist der Beleg für den Trade-off zwischen QA-SEC
und QA-INT in Kapitel 6 und gehört deshalb ins Protokoll.

### Ergebnis vom 02.09.2026

Protokoll `qs-sec-02-20260902-164933.txt` mit Export
`qs-sec-02-20260902-164933-export.json` in [evaluation/results](results).
Subjekt war eine Person mit einem Raum, einem darüber erreichbaren Sensor und
126 Messwerten aus zwei Minuten Telemetrie.

| Zielwert | Gemessen |
|---|---|
| Abdeckung 100 % | 100 %, 5 von 5 Posten |
| 0 Treffer nach Löschlauf | 0 in allen sechs Abschnitten |
| Nachabfrage | 404, keine Links mehr am Objekt |
| Laufzeit unter 15 min | 0,8 s gesamt, Löschaufruf 0,07 s, Export 0,11 s |
| Messwerte nach Löschung | 126, unverändert, ohne Personenbezug |

Was der Lauf nicht prüft, ist das Event-Backbone. Retention und Tombstones
sind Topic-Konfiguration und werden hier nicht gemessen.

## 11 QS-SEC-01, mandantenübergreifender Zugriffsversuch

Der Angriffslauf unterscheidet sich in zwei Punkten von jedem anderen Szenario,
und beide sind der Grund, warum ein früherer lokaler Probelauf die Messung
nicht ersetzt.

Erstens meldet sich der Angreifer als **mandantengebundener Nutzer** an, nie
als Systemadministrator. Ein Administrator beendet die Mandantenprüfung in
ihrer ersten Zeile, ein Lauf unter seinem Konto würde die Durchsetzung als
kostenlos ausweisen. Das Lastskript verweigert deshalb den Start unter
`admin@local`.

Zweitens läuft der Angriff ausschließlich über den **Proxy der Weboberfläche**,
die einzige nach außen erreichbare Fläche der Plattform. Kein Backend-Dienst
wird direkt adressiert. Der Proxy hängt das Sitzungs-Cookie als Bearer-Token an
und leitet an Core und Analytics weiter, wo die Mandantenprüfung tatsächlich
greift.

| Szenario | Angreifer | Ziel | Zielwerte |
|---|---|---|---|
| QS-SEC-01 | `probe-tenanta@example.org`, Rolle viewer | Mandant `tenantb` | 0 mandantenfremde Datensätze, je Versuch 1 Audit-Eintrag |

### Woher der Angreifer die fremden Kennungen kennt

Er liest sie nicht, denn genau das soll ja verhindert werden. Er **leitet sie
her**. Der mock-service bildet jede Kennung als uuid5 über
`<präfix>:<art>:...`, also folgt die gesamte Angriffsfläche von `tenantb` aus
seinem Präfix und seiner Flottenform. Das ist der realistische Fall, ein
Angreifer, der eine Kennung kennt oder errät und sie ausprobiert. Bei zwei
Standorten mit je zwei Räumen ergibt das 6 Geräte, 20 Messpunkte und
zusammen 42 Kennungen, deren Auftauchen in einer Antwort ein Leck ist.

### Der Katalog, nach OWASP API Security Top 10 (2023)

| Kategorie | Versuche | Erwartung |
|---|---|---|
| API1 Broken Object Level Authorization | Projekt, Messpunkte, Latest-Values, Graph, Health, Channels, Dashboards, Events, Objekte, Liegenschaften, Mandant, dazu fünf Analytics-Routen mit fremden Messpunkt-IDs | 401 oder 403 |
| API2 Broken Authentication | ohne Token, mit kaputtem Token, mit gültig geformtem Token unter falscher Signatur | 401 |
| API3 Broken Object Property Level Authorization | Sammel-Endpunkte, die filtern statt abzulehnen | 2xx ohne fremde Kennung |
| API5 Broken Function Level Authorization | Schreibversuche als viewer auf fremde Objekte, Projekte, Links und Personen | 401, 403 oder 404 |

Die Bewertung je Versuch:

| Ergebnis | Bedeutung | Wertung |
|---|---|---|
| DENIED, 401 oder 403 | der Endpunkt hat abgelehnt | bestanden |
| NOT_FOUND, 404 | nichts herausgegeben | bestanden |
| FILTERED, 2xx ohne fremde Kennung | die Abfrage wurde eingeengt | bestanden |
| LEAK, 2xx **mit** fremder Kennung | der Response Measure ist verletzt | **Fehlschlag** |
| BAD_INPUT, 400 oder 422 | das Skript selbst hat falsch angefragt | Fehler des Skripts, muss null sein |
| ERROR, 5xx oder Transport | gesondert gezählt | Fehlschlag |

Ein Schreibversuch gilt bereits bei jedem 2xx als Leck, unabhängig vom Körper,
denn er hat dann auf fremden Daten gewirkt.

Damit ist die Fehlerzahl von locust genau die Leckzahl von QS-SEC-01, und die
Tabelle je Namen ist die Abdeckungskarte mit einer Zeile je OWASP-Muster.

### Die Grundlast entsteht aus dem Angriff selbst

Das Szenario verlangt eine parallele Grundlast von 50 Requests/s. Bei 25
Nutzern mit je zwei Anfragen pro Sekunde erzeugen die Angriffe genau diese
Rate, ein zweiter Generator ist deshalb nicht nötig. Über zehn Minuten laufen
so mehrere zehntausend Versuche statt der geforderten 100, und jedes Muster
wird tausendfach unter Nebenläufigkeit geprüft.

### Einen Lauf durchführen

```bash
# Vorbedingung: eval-up.sh hat beide Mandanten und die Probe-Nutzer angelegt
# und die internen Endpunkte inklusive frontend-internal ausgerollt.
infrastructure/scripts/eval-up.sh

# Der Lauf, zehn Minuten
evaluation/scripts/security-scenario.sh

# kürzer, oder mit den destruktiven Schreibversuchen
evaluation/scripts/security-scenario.sh 3m
INCLUDE_WRITES=true evaluation/scripts/security-scenario.sh
```

Die Schreibversuche sind auf den synthetischen Fixtures von `tenantb`
destruktiv und deshalb voreingestellt aus. Nach einem Lauf mit
`INCLUDE_WRITES=true` den zweiten Mandanten neu seeden.

Vor der Cluster-Sitzung lohnt ein Trockenlauf auf dem Entwicklungsstack, er
kostet nichts und findet Tippfehler in Pfaden.

```bash
scripts/dev.sh up
applications/mock-service/.venv/bin/mock-service seed --prefix tenanta --sites 1 --rooms 2
applications/mock-service/.venv/bin/mock-service seed --prefix tenantb --sites 2 --rooms 2
evaluation/scripts/.venv/bin/python evaluation/scripts/tenant_isolation_probe.py --setup-only
cd evaluation/load && FRONTEND_HOST=http://localhost:3000 \
  .venv/bin/locust -f security_locustfile.py --headless -u 5 -r 5 --run-time 60s
```

### Ergebnisse

| Datei | Inhalt |
|---|---|
| `qs-sec-01-<zeitstempel>.txt` | Bericht mit Fenster, Angreifer, Ziel, Ergebniszusammenfassung, Abdeckungskarte je OWASP-Muster, Fehlschlägen und Audit-Abdeckung |
| `qs-sec-01-<zeitstempel>-stats.csv` | Kennzahlen je Angriffsmuster, Spalte Failures ist die Leckzahl |
| `qs-sec-01-<zeitstempel>-failures.csv` | jede Zeile ein Leck oder eine fehlerhafte Anfrage des Skripts |
| `qs-sec-01-<zeitstempel>-stats_history.csv` | sekundenweiser Verlauf |

Der zweite Response Measure, je Versuch ein Audit-Eintrag, kommt aus
[`evaluation/sql/audit-coverage.sql`](sql/audit-coverage.sql), das der Runner
gegen den Stammdatenspeicher fährt. Beim Lesen ist eines zu beachten, und es
gehört in den Kapiteltext statt in eine Fußnote. Nicht jeder Versuch kann eine
Zeile erzeugen. Der Filter protokolliert, wenn er den adressierten Mandanten
benennen kann. Ein Sammel-Endpunkt wie `/api/v1/projects` nennt gar keinen
Mandanten, er engt seine Abfrage nur ein, und hinterlässt deshalb keine Zeile.
Das SQL trennt diese beiden Mengen in Abschnitt 5, statt eine Quote über alles
zu berichten.

Abschnitt 4 desselben SQL trennt außerdem, welcher Dienst die Zeile geschrieben
hat. Analytics schreibt für den Audit selbst in den Stammdatenspeicher, was die
dokumentierte Abweichung der geteilten Datenbank vertieft und in Kapitel 6 als
Sensitivity Point gehört.

## 11 QS-SEC-01, mandantenübergreifender Zugriffsversuch

| Szenario | Umgebung | Zielwerte |
|---|---|---|
| QS-SEC-01 | zwei Mandanten mit je einer Flotte, je ein Nutzer mit Rolle `viewer`, Grundlast 50 Requests/s aus QS-PER-03 | 0 mandantenfremde Datensätze in den Antworten, je Versuch genau 1 Audit-Eintrag, mindestens 100 Versuche |

Die Sonde ist [`evaluation/scripts/tenant_isolation_probe.py`](scripts/tenant_isolation_probe.py).
Sie legt über den Einladungsfluss je Mandant einen Nutzer an, sammelt als
Administrator die Kennungen beider Flotten und fährt dann jeden Versuch in
beide Richtungen, Nutzer A gegen Daten von B und umgekehrt. Jede Antwort wird
nach der Art der Abwehr eingeordnet, nicht nur nach bestanden oder nicht.

| Einordnung | Bedeutung |
|---|---|
| `DENIED` | 401 oder 403, der einzige Ausgang, der Durchsetzung beweist |
| `FILTERED` | 2xx ohne fremde Kennung im Body, der Endpunkt hat die Abfrage eingeengt statt abzulehnen |
| `LEAK` | 2xx mit fremder Kennung im Body, oder ein angenommener mandantenübergreifender Schreibversuch |
| `NOT_FOUND` | 404, sagt nichts über Durchsetzung aus |
| `BAD_REQUEST` | 400, ein Fehler der Sonde selbst, muss null sein |

Zwei Familien von Versuchen, weil der Core sie an zwei Stellen abwehrt.

- **Kennungen in der URL** (`/projects/{B}`, `/objects/{B}/metrics`,
  `?tenantId=B`) löst der `TenantScopeInterceptor` auf, der jede Pfadvariable
  ihrem Mandanten zuordnet und Fremde mit 403 abweist.
- **Kennungen im Request-Body** (`{"siteId": B}`, `{"sourceId": A, "targetId": B}`,
  `{"bindings": [{"metricPointId": B}]}`, `?metricPointIds=B`) sieht der
  Interceptor nicht. Sie prüft der `TenantBodyGuard` in den betroffenen
  Handlern mit derselben Entscheidungstabelle. Diese Familie sind
  Schreibversuche mit eigenem Anker und fremder Kennung im Payload. Ein
  angenommener Schreibversuch zählt als `LEAK`, auch wenn die Antwort die
  fremde Kennung nicht zurückgibt. Im Selbsttest werden sie ausgelassen, weil
  sie echte Zeilen anlegen würden.

Der Analytics-Dienst prüft die Kennungen im Body selbst (`require_tenant_scope`)
und wird direkt angesprochen. Dazu gehören zwei Aufrufe ohne jede Kennung an
`/stats/ingest-rate`, die vor der Korrektur ein Aggregat über den gesamten
Messwertspeicher lieferten.

```bash
# lokal: das Dev-Profil schaltet die Durchsetzung AUS, deshalb den Core mit
# TENANT_ENFORCEMENT_MODE=ENFORCE starten, sonst misst die Sonde das Dev-Profil
applications/mock-service/.venv/bin/mock-service seed --prefix tenanta --sites 1 --rooms 2 --persons 1
applications/mock-service/.venv/bin/mock-service seed --prefix tenantb --sites 1 --rooms 2 --persons 1
evaluation/scripts/.venv/bin/python evaluation/scripts/tenant_isolation_probe.py \
  --csv evaluation/results/qs-sec-01-<datum>.csv \
  --dsn postgresql://postgres:password@localhost:5432/digital_demon

# Gegenprobe: dieselben Aufrufe gegen die eigenen Ressourcen, muss 2xx liefern.
# Ohne sie wäre "0 Lecks" auch das Ergebnis eines Mechanismus, der alles ablehnt.
evaluation/scripts/.venv/bin/python evaluation/scripts/tenant_isolation_probe.py --self-check

# im Cluster: CORE_HOST und ANALYTICS_HOST auf die internen Endpunkte setzen,
# die Audit-Zählung danach per kubectl exec gegen stammdaten-db
```

### Vorbereitung vom 02.09.2026, lokal

Vor der Messung wurden alle Endpunkte von Core, Analytics und Frontend-Proxy
auf genau dieses Muster durchgesehen. Der Interceptor war lückenlos, aber
zwölf Core-Endpunkte nahmen Kennungen im Body ungeprüft an, Analytics lieferte
ohne Kennungsliste plattformweite Aggregate, und das Frontend-Proxy ließ über
`..%2F` den Präfix `/api/v1` verlassen. Alle drei sind geschlossen, der Guard
hat einen eigenen Unit-Test für seine Entscheidungstabelle.

| Lauf | Versuche | DENIED | FILTERED | LEAK | Audit-Einträge |
|---|---|---|---|---|---|
| mandantenfremd, Durchsetzung an | 138 | 132 | 6 | 0 | 132 |
| Selbsttest gegen eigene Ressourcen | 106 | 6 | 35 | 65 | 0 |

Die sechs `FILTERED` sind die Listen-Endpunkte `/projects`, `/tenants` und
`/events`, die keinen fremden Mandanten benennen und deshalb einengen statt
abzulehnen. Sie erzeugen bewusst keinen Audit-Eintrag, weil kein fremder
Mandant adressiert wurde. Die sechs Verweigerungen im Selbsttest sind
Rollenprüfungen für `viewer` (`/tenants/{id}/members`, `/fleet/status`,
`/discovered-devices`), keine Mandantenfehler. `LEAK` im Selbsttest bedeutet
"eigene Daten geliefert" und ist dort das erwartete Ergebnis.

Die Messung für Kapitel 6 erfolgt im Cluster unter der Grundlast aus QS-PER-03.
