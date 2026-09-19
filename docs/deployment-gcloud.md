# Deployment in Google Cloud

Die Plattform läuft für die Evaluation auf einem GKE-Autopilot-Cluster in
`europe-west3`. Terraform legt die Cloud-Ressourcen an, Kustomize deployt die
Workloads, zwei Skripte fahren eine Sitzung hoch und wieder herunter. Details,
Entwurfsentscheidungen und die gemessenen Sensitivity Points stehen in
[infrastructure/README.md](../infrastructure/README.md).

## Was entsteht

- **Terraform.** GKE-Autopilot-Cluster, Artifact Registry, VPC mit Subnetz. Die
  benötigten APIs (Compute, Container, Artifact Registry) werden mit aktiviert.
- **Kustomize.** Namespace `heating-platform` mit Stammdaten-DB, Messwert-DB,
  Kafka, Mosquitto und den sechs Services. Das Frontend ist der einzige
  öffentliche Einstiegspunkt (LoadBalancer), alles andere bleibt ClusterIP.
- **Images.** Werden auf Cloud Build gebaut und in der Artifact Registry
  abgelegt. Ein lokales Docker ist nicht nötig.

## Voraussetzungen

| Werkzeug   | Version  | Hinweis                                                              |
| ---------- | -------- | -------------------------------------------------------------------- |
| GCP-Projekt |         | Abrechnung muss aktiviert sein                                       |
| gcloud CLI | aktuell  | `gcloud auth login` und `gcloud auth application-default login`      |
| terraform  | ab 1.7   |                                                                      |
| kubectl    | aktuell  | Kustomize ist über `kubectl apply -k` enthalten                      |

Die Skripte und Manifeste sind auf das Projekt `heating-platform-eval`
eingestellt. Für ein anderes Projekt sind zwei Anpassungen nötig.

- Die Skripte lesen `PROJECT`, `REGION` und `REGISTRY` aus der Umgebung, zum
  Beispiel `PROJECT=mein-projekt infrastructure/scripts/eval-up.sh`.
- Der Registry-Pfad steht fest in `infrastructure/kubernetes/overlays/gke/kustomization.yaml`,
  `infrastructure/kubernetes/jobs/*.yaml` und als `_REGISTRY` in
  `infrastructure/cloudbuild.yaml`. Dort `heating-platform-eval` durch die
  eigene Projekt-ID ersetzen.

## Hochfahren

```bash
# 1. Images bauen, einmal pro Codeänderung
infrastructure/scripts/cloudbuild-all.sh                     # alle Images
infrastructure/scripts/cloudbuild-all.sh ingestion-service   # oder nur eines

# 2. Cluster, Plattform, Geräteflotte und Lastgeneratoren
#    --smoke schickt zusätzlich 60 s Telemetrie und prüft, dass Messwerte ankommen
infrastructure/scripts/eval-up.sh --smoke

# 3. Adresse der Web-Oberfläche, Login admin@local / admin
kubectl -n heating-platform get svc frontend
```

Der erste Schritt dauert je nach Build-Maschine einige Minuten, der zweite
rund zehn Minuten, weil Autopilot die Knoten erst beim Deploy bereitstellt.

Wenn das Skript fehlschlägt, lässt sich die Sequenz von Hand durchgehen.

```bash
terraform -chdir=infrastructure/terraform init
terraform -chdir=infrastructure/terraform apply -var project_id=<PROJECT_ID>
gcloud container clusters get-credentials heating-platform --region europe-west3 --project <PROJECT_ID>
kubectl apply -k infrastructure/kubernetes/overlays/gke
kubectl -n heating-platform get pods -w
kubectl apply -f infrastructure/kubernetes/jobs/mock-seed.yaml
```

Die Pods kommen in Abhängigkeitsreihenfolge hoch. Erst die Datenbanken, Kafka
und Mosquitto, dann device-management, dann der ingestion-service (er wartet
auf die Gerätekonfiguration), zuletzt die übrigen Services und das Frontend.

## Messläufe

Die Lastszenarien der Evaluation starten von außerhalb des Clusters, siehe
[evaluation/README.md](../evaluation/README.md).

## Abbauen

Autopilot rechnet nach angeforderten Pod-Ressourcen ab. Der Cluster kostet
daher auch im Leerlauf laufend Geld und sollte nach jeder Sitzung weg.

```bash
infrastructure/scripts/eval-down.sh          # nur der Cluster, Registry und Netz bleiben
infrastructure/scripts/eval-down.sh --all    # alles, inklusive aller Images
```

Das Skript entfernt vorher die LoadBalancer-Services und die Persistent Volumes
und listet danach, was in GCP übrig geblieben ist. Beides ist wichtig. Ein
manuelles `terraform destroy` hinterlässt sonst Forwarding Rules, die weiter
abgerechnet werden, und verwaiste Festplatten, die irgendwann die
SSD-Quota der Region füllen.
