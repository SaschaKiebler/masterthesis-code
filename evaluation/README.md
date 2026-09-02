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
Präfix "mock", Seed 42
mock-boiler-001 .. mock-boiler-025
mock-ht-001-01  .. mock-ht-025-03
```

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

Nur nötig, wenn ein Generator vom eigenen Rechner aus laufen soll, etwa `locust`
für QS-PER-03. Jeder LoadBalancer wird dabei per `loadBalancerSourceRanges` auf
eine einzelne Adresse begrenzt. Das ist nicht optional, denn der Broker läuft mit
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

# 4  Abbauen. Entfernt beide Endpunkt-Sätze, dann den Cluster, und prüft danach
#    bei GCP nach, ob wirklich nichts mehr läuft.
infrastructure/scripts/eval-down.sh
```

QS-PER-03 läuft mit `locust` vom eigenen Rechner und braucht dafür die
öffentlichen Endpunkte.

```bash
MY_IP=$(curl -4 -s ifconfig.me)
sed "s|MEINE_IP|$MY_IP|" infrastructure/kubernetes/eval/external-access.yaml \
  | kubectl apply -f -
kubectl -n heating-platform get svc -l eval=external -w

cd evaluation/load && CORE_HOST=http://<core-ip>:8080 \
  ANALYTICS_HOST=http://<analytics-ip>:8100 \
  locust -f locustfile.py --headless -u 50 -r 10 --run-time 10m \
  --csv ../results/qs-per-03
```

Standardmäßig zerstört `eval-down.sh` nur den Cluster. Registry und Netzwerk
bleiben, damit die nächste Sitzung auf den bereits gebauten Images aufsetzt.
`eval-down.sh --all` räumt zusätzlich Registry und Images ab, danach ist erst
wieder ein vollständiger Build nötig.

Images neu bauen, falls Quellcode geändert wurde:

```bash
infrastructure/scripts/cloudbuild-all.sh                    # alle sieben
infrastructure/scripts/cloudbuild-all.sh ingestion-service  # gezielt
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

- **Ein Lauf ohne Spitze sieht aus wie ein vollständiger Lauf.** Schlägt der
  Start des zweiten Generators fehl, etwa durch einen kurzen Netzausfall, lief
  das Szenario früher stumm weiter. `ingest-scenario.sh` bricht deshalb heute mit
  `exit 1` ab, wenn keine Ausführung zustande kommt. Kontrolle im Bericht: das
  Minutenprofil muss die Spitze zeigen.
- **Zwei Generatoren mit gleicher MQTT-Client-ID schießen sich gegenseitig ab.**
  Der Broker trennt die ältere Verbindung, sobald sich eine zweite mit derselben
  ID meldet. Beide reconnecten dann in einer Schleife. Sichtbar an hohen
  `dropped`- und `errors`-Zählern des Generators. Behoben durch einen
  prozess-eindeutigen Suffix.
- **Ein Pod kann laufen und trotzdem nichts tun.** Der Erfassungsdienst hat keine
  HTTP-Oberfläche und damit keine Probes. Mit falschem DB-Port hing er
  minutenlang im Verbindungsaufbau und stand dabei als `1/1 Running` da.
  `eval-up.sh` prüft deshalb auf echte Bereitschaft und bricht nach 15 Minuten
  mit Podliste ab.
- **Der Startvorgang hängt an der Reihenfolge.** Core und notification teilen
  sich die Stammdaten-Datenbank. Wer zuerst migriert, entscheidet, ob die
  Baseline korrekt gesetzt wird. Ebenso legen die Dienste ihre Kafka-Topics nur
  einmal beim Start an. Beides ist über `baseline-version: 0` und
  `spring.kafka.admin.fail-fast` entschärft.

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
