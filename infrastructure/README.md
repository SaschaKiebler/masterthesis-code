# Infrastruktur (GKE-Evaluationsumgebung)

Infrastructure as Code für den Betrieb der Plattform in Google Cloud während
der Evaluation (Kapitel 6 der Arbeit). Terraform legt die Cloud-Ressourcen
an, Kustomize deployt die Workloads, und zwei Skripte fahren eine Messsitzung
hoch und wieder herunter.

Was hier **nicht** steht, ist der Messaufbau selbst, also Szenarien,
Latenzbegriffe, Flottenarithmetik und die Auswertung eines Laufs. Das steht
in [evaluation/README.md](../evaluation/README.md). Diese Datei beschreibt
nur die Umgebung, die diese Läufe brauchen. Eine kompakte Übersicht über
Terraform, Kubernetes und Skripte gibt es zusätzlich in
[docs/infrastructure.md](../docs/infrastructure.md).

```
infrastructure/
├── terraform/               # GKE-Autopilot-Cluster, Artifact Registry, VPC mit Subnetz
├── cloudbuild.yaml          # eine Build-Konfiguration, je Service parametrisiert
├── kubernetes/
│   ├── base/                # Namespace, Secrets, 2 Datenbanken, Kafka, Mosquitto, 6 Services
│   ├── overlays/gke/        # bindet die Deployments an die Images der Artifact Registry
│   ├── eval/                # Einstiegspunkte je Sitzung, intern und extern
│   └── jobs/                # mock-seed (tenanta), mock-seed-tenantb, mock-run
└── scripts/
    ├── eval-up.sh           # Cluster, Plattform, Flotten, Probe-Nutzer, Generatoren
    ├── eval-down.sh         # Einstiegspunkte, PVCs, Cluster, optional die Registry
    ├── cloudbuild-all.sh    # alle acht Images auf Cloud Build, ohne lokales Docker
    └── build-push.sh        # Rückfall mit lokalem Docker, sieben Images, ohne locust-load
```

## Runbook

Voraussetzungen sind ein GCP-Projekt mit aktivierter Abrechnung, `gcloud auth
login` plus `gcloud auth application-default login`, Terraform ab 1.7 und
kubectl. Ein lokales Docker braucht nur `build-push.sh`, der Weg über Cloud
Build kommt ohne aus.

Das Hochfahren ist von Anfang bis Ende geskriptet. Die manuelle Sequenz
weiter unten ist nur dann dran, wenn das Skript irgendwo scheitert und man
sehen will, wo.

```bash
# 1. Images. Einmal je Codeänderung, auf Cloud Build.
infrastructure/scripts/cloudbuild-all.sh                     # alle acht
infrastructure/scripts/cloudbuild-all.sh ingestion-service   # oder nur eines

# 2. Alles andere. Cluster, Plattform, beide Flotten, die mandantengebundenen
#    Probe-Nutzer, die internen Einstiegspunkte und die zwei Cloud-Run-Jobs.
#    --smoke hängt 60 s Telemetrie an und prüft, dass Zeilen ankommen.
infrastructure/scripts/eval-up.sh --smoke

# 3. Die Szenarien selbst, siehe evaluation/README.md
evaluation/scripts/ingest-scenario.sh ramp        # Kapazität zuerst, 12 Minuten
evaluation/scripts/ingest-scenario.sh qs-per-01
evaluation/scripts/ingest-scenario.sh qs-per-02
evaluation/scripts/query-scenario.sh              # QS-PER-03

# 4. Abbauen. Entfernt erst beide Sätze Einstiegspunkte und die PVCs, dann
#    den Cluster, und fragt danach bei GCP nach, was tatsächlich übrig ist.
infrastructure/scripts/eval-down.sh          # Registry und Netz bleiben
infrastructure/scripts/eval-down.sh --all    # entfernt auch die
```

### Manuelle Sequenz

```bash
# Cloud-Ressourcen, rund 10 Minuten, hauptsächlich die Cluster-Erstellung
terraform -chdir=infrastructure/terraform init
terraform -chdir=infrastructure/terraform apply -var project_id=<PROJECT_ID>

# Deployen. Das gke-Overlay trägt den Registry-Pfad schon, es ist nichts zu ersetzen.
gcloud container clusters get-credentials heating-platform \
  --region europe-west3 --project <PROJECT_ID>
kubectl apply -k infrastructure/kubernetes/overlays/gke
kubectl -n heating-platform get pods -w
# erwartete Reihenfolge: erst die zwei Datenbanken, Kafka und Mosquitto, dann
# device-management, dann ingestion (blockiert bis device.configured
# eingelesen ist), dann core, notification, analytics und frontend

# Die gemessene Flotte und den kleinen zweiten Mandanten anlegen
kubectl apply -f infrastructure/kubernetes/jobs/mock-seed.yaml
kubectl -n heating-platform wait --for=condition=complete job/mock-seed --timeout=300s
kubectl apply -f infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml

# Einstiegspunkte für die Generatoren, VPC-intern
kubectl apply -f infrastructure/kubernetes/eval/internal-access.yaml
kubectl -n heating-platform get svc -l eval=internal -w
```

### Woher die Last kommt

Die Lastgeneratoren laufen **außerhalb** des Clusters, weil ein Generator im
Cluster mit den zu messenden Services um Pod-Ressourcen konkurrieren würde.
Sie laufen trotzdem **innerhalb** des Projekts, als Cloud-Run-Jobs mit
direktem VPC-Egress, die Mosquitto, core und analytics über die internen
LoadBalancer aus `eval/internal-access.yaml` erreichen. `eval-up.sh` deployt
beide Jobs, `mock-load` für die Telemetrie und `locust-load` für die
Abfrage-APIs.

Das hält zwei Dinge zugleich fest. Nichts muss öffentlich erreichbar sein,
und der Uplink des Bedieners bleibt aus der Messung heraus. Das zählt, weil
QS-PER-02 rund 1750 Nachrichten je Sekunde verlangt und ein Laptop hinter
einem Campus-NAT das unter Umständen gar nicht erzeugen kann.

`eval/external-access.yaml` ist der Rückfall für die Fälle, die trotzdem eine
öffentliche Adresse brauchen, etwa die Web-Oberfläche von Hand öffnen oder
einen Generator vom eigenen Rechner fahren. Jeder LoadBalancer darin ist per
`loadBalancerSourceRanges` auf eine einzelne `/32` gepinnt. Das ist Pflicht
und keine Option, weil Mosquitto mit `allow_anonymous` läuft und ein offener
MQTT-Port fremde Publikationen annähme und die Messung verfälschte. Die
eigene Adresse mit `curl -4` ermitteln, sonst liefert eine
Dual-Stack-Verbindung eine IPv6-Adresse und die Regel passt nie auf den
tatsächlichen Verkehr. Diese Services **vor** dem Cluster löschen, siehe den
Abschnitt zum Abbau.

## Entwurfsnotizen und Abwägungen

- **GKE Autopilot**, weil nach angeforderten Pod-Ressourcen abgerechnet wird
  und keine Knoten zu verwalten sind. Der Stack fordert im Ruhezustand rund
  6,9 vCPU und 9,1 GiB an, am Autoscaler-Limit von ingestion rund 8,9 vCPU
  und 11,1 GiB. Der Messwertspeicher allein steht für 4 dieser CPUs. Der
  Bedarf hat sich etwa verdreifacht, als der Speicher nach dem Laststufenlauf vom
  2026-09-01 von 500m auf 4 CPU ging, und weil Autopilot das Angeforderte
  abrechnet, haben sich die laufenden Kosten mit verdreifacht. `eval-down.sh`
  nach jeder Sitzung hält das nahe null.
- **Zwei Speicher, nicht einer.** `measurement-db` ist TimescaleDB und hält
  die Messwerte, `stammdaten-db` ist normales PostgreSQL und hält die
  Stammdaten. Beide laufen im Cluster, TimescaleDB, weil weder Cloud SQL noch
  AlloyDB die Erweiterung anbieten. Die Schemata legt der jeweils besitzende
  Service beim ersten Start per Flyway an. Beide laufen mit `max_connections
  = 100`, woraus sich das Verbindungsbudget von ingestion weiter unten
  ableitet.
- **Kafka ist ein einzelner KRaft-Broker im Cluster** (StatefulSet mit PVC),
  wie im lokalen Compose-Stack. Die Evaluation zielt auf die
  Plattformarchitektur und nicht auf Broker-Hochverfügbarkeit, daher
  Replikationsfaktor 1 und `KAFKA_AUTO_CREATE_TOPICS_ENABLE=false` wie
  lokal. Topics legt ausschließlich der besitzende Service an.
- **Die Startreihenfolge ergibt sich aus Konvergenz.** Services starten neu
  oder warten, bis ihre Abhängigkeiten da sind. Ingestion blockiert
  absichtlich, bis es `device.configured` eingelesen hat, und wird deshalb
  erst nach dem ersten Sweep von device-management bereit. Zwei Fallen der
  Reihenfolge sind in der Konfiguration geschlossen und nicht in einem
  Startskript. Core und notification teilen sich die Stammdaten-Datenbank,
  wer zuerst migriert, entscheidet über die Baseline, was
  `baseline-version: 0` regelt. Und weil jeder Service seine Topics nur einmal beim Start
  anlegt, lässt `spring.kafka.admin.fail-fast` einen Service, der vor dem
  Broker hochkam, laut scheitern, statt ohne seine Topics weiterzulaufen.
- **Öffentliche Fläche.** Der Service `frontend` ist in `base` ein
  LoadBalancer und damit in einem Standard-Deployment der einzige öffentliche
  Einstiegspunkt der Plattform. Alles andere ist ClusterIP, bis eine Datei
  aus `eval/` für die Sitzung einen Einstiegspunkt ergänzt.
- **Nicht deployt** ist kafka-ui. Stattdessen `kubectl port-forward` mit
  lokalem Werkzeug. Frontend und analytics-service *sind* deployt, QS-PER-03
  fährt die Abfrage-API von analytics direkt an.
- **Secrets** liegen mit Evaluationswerten in `base/secrets.yaml`. Für alles
  jenseits eines Wegwerf-Clusters das Secret `platform-secrets`
  überschreiben.

## Skalierungsregler für die Evaluation

- **Flottengröße und Rate** über `--prefix/--sites/--rooms/--interval` bei
  `mock-service run`. Der Seed muss dazu passen, Präfix eingeschlossen, weil
  die Mandanten-ID daraus abgeleitet wird. `evaluation/scripts/ingest-scenario.sh`
  setzt diese Werte je Szenario, von Hand ist normalerweise nichts
  anzupassen. `jobs/mock-run.yaml` bleibt für funktionale Läufe im Cluster
  und wird von keiner Messung benutzt, `eval-up.sh --smoke` fährt einen
  eigenen kurzen Lauf.
- **Consumer-Scale-out** mit `kubectl -n heating-platform scale
  deploy/core-platform --replicas=2`. `measurement.ingested` hat 3
  Partitionen, also höchstens 3 wirksame Consumer je Gruppe.
- **Ingestion-Scale-out** mit `kubectl -n heating-platform scale
  deploy/ingestion-service --replicas=4`. Jeder Pod leitet seine
  MQTT-Client-ID aus dem Pod-Namen ab und abonniert über die
  Shared-Subscription-Gruppe `ingestion` (`MQTT_SHARE_GROUP`), Mosquitto gibt
  jede Nachricht also an genau einen Pod, statt sie an jede Replika
  zuzustellen. Ein leeres `MQTT_SHARE_GROUP` fällt auf einfache Subscriptions
  zurück, für Broker ohne Shared Subscriptions, und begrenzt den Service dann
  auf eine Replika.
- **Ingestion-Autoscaling.** Ein HPA skaliert das Deployment nach CPU
  zwischen 2 und 10 Pods bei 70 % Zielauslastung. Beobachten mit `kubectl -n
  heating-platform get hpa ingestion-service -w`. Für eine kontrollierte
  Messung die Replikazahl festnageln, indem man den HPA vorher löscht.
- **Verbindungsbudget**, `DB_MAX_CONNECTIONS` auf ingestion, derzeit 6. Das
  ist der eine Regler, der neu hergeleitet werden muss, sobald das HPA-Limit
  oder `max_connections` sich ändert, siehe den ersten Sensitivity Point
  unten.

## Sensitivity Points, gemessen

Das sind Ergebnisse der Läufe vom 2026-09-01 und 2026-09-02, keine
Erwartungen. Das vollständige Bild steht in Kapitel 6 der Arbeit, die
Kurzfassung gehört hierher, weil jeder Punkt eine Betriebsfalle ist.

- **Das Verbindungsbudget ist der schärfste.** Unbegrenzt bemisst deadpool
  den Pool von ingestion nach der CPU-Zahl des *Knotens*, die nichts damit zu
  tun hat, was der Speicher bedienen kann. Unter der Spitze von QS-PER-02
  ging der Autoscaler auf neun Replikas, die Summe der Pools überschritt
  `max_connections = 100` des Speichers, und der Lauf verlor 5,65 % seiner
  Messwerte bei einem p95 von 224 s, während der Speicher selbst nur halb
  ausgelastet war. Mit einem festen Budget von 6 je Replika, hergeleitet aus
  `max_connections` und dem HPA-Limit, verliert dieselbe Last nichts bei
  einem p95 von 15 ms.
- **Die CPU des Speichers ist der Durchsatzhebel der ganzen Kette**, weil
  ingestion je Messwert einmal committet. Bei 500m sättigt die Kette um 1400
  Messwerte je Sekunde, bei 2 CPU um 2300, viermal so viel CPU bringt also
  den Faktor 1,6. Der Speicher hat jetzt 4 CPU statt der 2, weil der Pod bei
  2 CPU 2472 Millicores zog, also über seine eigene Anforderung hinaus, und
  die Messung sich auf Kapazität stützte, die ihr nicht garantiert war.
- **Mosquitto bleibt ein einzelner Pod** und lässt sich weder durch Zuteilung
  noch durch Replikation entlasten wie ingestion und der Speicher. Er war in
  keinem Lauf der Engpass, begrenzt aber strukturell sowohl die
  Nachrichtenrate als auch die Zahl gleichzeitig verbundener Geräte.
- **Shared Subscriptions erhalten die Reihenfolge je Gerät nicht.** Mosquitto
  verteilt im Round-Robin ohne Affinität je Schlüssel, aufeinanderfolgende
  Nachrichten eines Geräts können also auf verschiedenen Pods landen, und
  die Ankunftsreihenfolge von `measurement.ingested` je Gerät ist nicht
  bestimmt. Maßgeblich bleibt `time` je Messwert.
- **Ingestion übt keine eigene Backpressure aus.** Es startet je eingehender
  Nachricht einen Task ohne Obergrenze. Ein Überlauf wurde nicht beobachtet,
  aber nur, weil die Warteschlangen des Brokers vorher bremsen, womit die
  Sicherheit eine Eigenschaft der Mosquitto-Queue-Größe ist und nicht des
  Services.

## Abbau, zwei Wege, Geld zu verlieren

Beides ist tatsächlich passiert, und `eval-down.sh` behandelt beides. Sie
stehen hier, weil ein manueller Abbau wieder hineinläuft.

- **Forwarding Rules können den Cluster überleben.** Zuerst die
  LoadBalancer-Services aus `eval/` löschen, GCP einen Moment geben, dann
  `destroy`. `eval-down.sh` prüft danach und meldet alles, was überlebt hat.
- **Persistent Disks werden mit dem Cluster nicht gelöscht.** Die PVCs
  verschwinden mit ihm, bevor der CSI-Treiber die Disks freigeben kann, und
  hinterlassen rund 30 GB verwaiste pd-balanced je Sitzung. Vierzehn davon
  haben einmal die regionale SSD-Quota gefüllt und ein späteres Hochfahren an
  Volumes scheitern lassen, die nicht binden wollten. StatefulSets und PVCs
  löschen, solange der Cluster noch da ist.
