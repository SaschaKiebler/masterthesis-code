# Infrastruktur und Skripte

Alles, was die Plattform lokal oder in Google Cloud zum Laufen bringt, in
einer Übersicht. Die Entwurfsnotizen, Skalierungsregler und gemessenen
Sensitivity Points stehen ausführlich in
[infrastructure/README.md](../infrastructure/README.md), der Ablauf einer
Sitzung in [deployment-gcloud.md](deployment-gcloud.md).

## Ordner

| Pfad                                   | Inhalt                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `infrastructure/terraform/`            | Cloud-Ressourcen, vier Dateien, lokaler State                                   |
| `infrastructure/kubernetes/base/`      | Namespace, Secrets, zwei Datenbanken, Kafka, Mosquitto, sechs Services          |
| `infrastructure/kubernetes/overlays/gke/` | Bindet die Images an die Artifact Registry                                   |
| `infrastructure/kubernetes/eval/`      | Einstiegspunkte für Messläufe, intern und extern                                |
| `infrastructure/kubernetes/jobs/`      | Seed und Funktionslauf des mock-service als Kubernetes-Jobs                     |
| `infrastructure/cloudbuild.yaml`       | Eine Build-Konfiguration, je Service parametrisiert                             |
| `infrastructure/scripts/`              | Images bauen, Umgebung hoch- und runterfahren                                   |
| `scripts/dev.sh`                       | Der lokale Stack                                                                |
| `docker/`                              | Compose-Datei, Schema des Messwertspeichers, Mosquitto-Konfiguration            |
| `evaluation/scripts/`                  | Messläufe der Evaluation, siehe [evaluation/README.md](../evaluation/README.md) |
| `evaluation/load/`, `evaluation/sql/`  | Locust-Generatoren und die Auswertungsabfragen                                  |

## Terraform

Bewusst minimal. Alles Zustandsbehaftete (Kafka, Datenbanken) läuft im
Cluster, deshalb räumt `terraform destroy` die ganze Umgebung ab.

| Ressource                    | Wert                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| APIs                         | Compute, Container, Artifact Registry, bleiben bei `destroy` aktiv          |
| VPC und Subnetz              | `heating-platform-vpc`, `10.10.0.0/20`, keine automatischen Subnetze        |
| GKE Autopilot                | `heating-platform` in `europe-west3`, Release-Channel `REGULAR`, ohne Löschschutz |
| Artifact Registry            | `heating-platform`, Format Docker                                          |

| Variable       | Standard             |
| -------------- | -------------------- |
| `project_id`   | Pflicht              |
| `region`       | `europe-west3`       |
| `cluster_name` | `heating-platform`   |
| `registry_id`  | `heating-platform`   |

Die Ausgaben `registry_url` und `get_credentials_command` liefern den
Image-Präfix und den `gcloud`-Befehl für die kubeconfig. Terraform ab 1.7,
Provider `google` 6.x. Der State liegt lokal im Ordner und ist per
`.gitignore` ausgeschlossen, es gibt kein Remote-Backend.

## Kubernetes

Alles im Namespace `heating-platform`, deployt mit `kubectl apply -k
infrastructure/kubernetes/overlays/gke`. Die Reihenfolge beim Hochfahren
ergibt sich aus Abhängigkeiten, nicht aus einem Skript. Services starten neu
oder warten, bis ihre Voraussetzungen da sind.

| Workload               | Art                          | Anforderung        | Bemerkung                                                       |
| ---------------------- | ---------------------------- | ------------------ | --------------------------------------------------------------- |
| `stammdaten-db`        | StatefulSet, PostgreSQL 16   | 250m, 512Mi        | Schema von core, geteilt mit notification und device-management |
| `measurement-db`       | StatefulSet, TimescaleDB     | 4 CPU, 4Gi         | Schema aus ConfigMap, `max_connections=100`, der Durchsatzhebel |
| `kafka`                | StatefulSet, KRaft 3.9       | 500m, 1Gi          | Ein Broker, 5Gi Volume, keine automatischen Topics              |
| `mosquitto`            | Deployment                   | 100m, 128Mi        | `allow_anonymous`, eine Instanz                                 |
| `device-management`    | Deployment                   | 250m, 512Mi        | Muss vor ingestion bereit sein                                  |
| `ingestion-service`    | Deployment, HPA 2 bis 10     | 250m, 256Mi        | Shared Subscription, `DB_MAX_CONNECTIONS=6`                     |
| `core-platform`        | Deployment                   | 500m, 1Gi          | HTTP 8080 und gRPC 9090                                         |
| `notification-service` | Deployment                   | 250m, 512Mi        | Ohne Kubernetes-Service, REST im Cluster nicht erreichbar       |
| `analytics-service`    | Deployment                   | 250m, 512Mi        |                                                                 |
| `frontend`             | Deployment, LoadBalancer     | 250m, 512Mi        | Der einzige öffentliche Einstiegspunkt, Port 80                 |

Die Secrets `DB_PASSWORD` und `LOCAL_AUTH_JWT_SECRET` liegen mit
Evaluationswerten in `base/secrets.yaml`. Für alles jenseits eines
Wegwerf-Clusters das Secret `platform-secrets` überschreiben.

**Einstiegspunkte** unter `eval/` gelten je Sitzung und werden vor dem Abbau
gelöscht. `internal-access.yaml` legt vier interne LoadBalancer für
Mosquitto, core, analytics und frontend an, über die die Lastgeneratoren als
Cloud-Run-Jobs aus dem VPC zugreifen. `external-access.yaml` ist der
Rückfall mit öffentlichen Adressen, jede auf eine einzelne `/32` gepinnt,
weil Mosquitto ohne Authentifizierung läuft.

**Jobs** unter `jobs/` legen die Flotten an, `mock-seed` mit 25 Standorten
für `tenanta`, `mock-seed-tenantb` mit 2 Standorten als zweiter Mandant, und
`mock-run` fährt einen zehnminütigen Funktionslauf mit einer Störung.

## Skripte

| Skript                                    | Zweck                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure/scripts/cloudbuild-all.sh` | Baut alle acht Images auf Cloud Build. Lädt den Quellcode einmal hoch, startet die Builds parallel auf `E2_HIGHCPU_8`, wartet auf alle. Mit Servicenamen als Argument nur diese |
| `infrastructure/scripts/build-push.sh`    | Rückfall mit lokalem Docker, sieben Images (ohne locust) per buildx für `linux/amd64`                                                     |
| `infrastructure/scripts/eval-up.sh`       | Cluster, Plattform, beide Flotten, Probe-Nutzer, interne Einstiegspunkte, Cloud-Run-Jobs. Mit `--smoke` 60 s Telemetrie mit Zeilenzählung  |
| `infrastructure/scripts/eval-down.sh`     | Einstiegspunkte und Volumes weg, dann der Cluster, danach Kontrolle in GCP. Mit `--all` auch Registry, Netz und Images                     |
| `scripts/dev.sh`                          | `up`, `down`, `status`, `logs` für den lokalen Stack, siehe [local-development.md](local-development.md)                                  |
| `evaluation/scripts/ingest-scenario.sh`   | `ramp`, `qs-per-01`, `qs-per-02` über den Cloud-Run-Job `mock-load`, Auswertung per SQL                                                  |
| `evaluation/scripts/query-scenario.sh`    | QS-PER-03, Locust gegen core und analytics bei laufender Grundlast                                                                        |
| `evaluation/scripts/security-scenario.sh` | QS-SEC-01, mandantenübergreifende Angriffe durch den Frontend-Proxy unter Last                                                            |
| `evaluation/scripts/*.py`                 | Probe-Nutzer anlegen, Integrations-, Modifizierbarkeits- und Datenschutzläufe, Sichtbarkeitsmessung                                        |

Was `eval-up.sh` der Reihe nach tut, weil hier die Fallen stecken.

1. `terraform apply` und kubeconfig holen. Ohne den zweiten Schritt spricht
   `kubectl` mit dem Endpunkt eines früheren, gelöschten Clusters.
2. Deployen, dann alle Deployments auf null skalieren, bis die drei Volumes
   gebunden sind, dann erneut deployen. Sonst füllen die Boot-Disks der
   Knoten die SSD-Quota, bevor die Datenbanken ihre Volumes bekommen.
3. Warten, bis alle Pods `N/N` bereit sind, nicht nur `Running`.
4. Beide Flotten seeden, die Probe-Nutzer über Port-Forwards anlegen, 40
   Sekunden auf den Sweep von device-management warten.
5. Interne Einstiegspunkte anlegen und die beiden Cloud-Run-Jobs `mock-load`
   und `locust-load` mit den internen Adressen deployen.

Was `eval-down.sh` absichert, weil beides schon Geld gekostet hat.

- LoadBalancer-Services zuerst löschen und 30 Sekunden warten, sonst
  überleben die Forwarding Rules den Cluster.
- StatefulSets und PVCs löschen, solange der Cluster noch da ist, sonst
  bleiben rund 30 GB verwaiste Disks je Sitzung zurück.
- Nach `destroy` bei GCP nachfragen, ob der Cluster wirklich weg ist, und
  übrig gebliebene Forwarding Rules und `pvc-`-Disks melden oder löschen.

Die Skripte lesen `PROJECT`, `REGION`, `CLUSTER` und `REGISTRY` aus der
Umgebung, Standard ist das Projekt `heating-platform-eval`. Der
Registry-Pfad steht zusätzlich fest im Overlay, in den Jobs und in
`cloudbuild.yaml`.
