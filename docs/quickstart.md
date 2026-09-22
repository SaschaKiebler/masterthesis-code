# Schnellstart

Die kürzeste Anleitung, um die Plattform laufen zu sehen. Hintergründe und
Fehlersuche stehen in [Lokal ausführen](local-development.md) und
[Deployment in Google Cloud](deployment-gcloud.md). Alle Befehle werden im
Wurzelverzeichnis des Repositories ausgeführt.

```bash
git clone https://github.com/SaschaKiebler/masterthesis-code.git
cd masterthesis-code
```

## Lokal

Voraussetzungen

| Werkzeug                              | Version  |
| ------------------------------------- | -------- |
| Docker mit Compose                    | aktuell  |
| JDK                                   | 21       |
| Rust (cargo) mit `protoc` und `cmake` | ab 1.90  |
| Python                                | ab 3.10  |
| Node.js mit npm                       | ab 20    |

Starten, Geräteflotte anlegen, Telemetrie senden

```bash
# Docker-Infrastruktur und alle Services, der erste Start dauert einige Minuten
scripts/dev.sh up

# Simulierte Geräteflotte anlegen
python3 -m venv applications/mock-service/.venv
applications/mock-service/.venv/bin/pip install -e applications/mock-service
applications/mock-service/.venv/bin/mock-service seed --sites 2 --rooms 2

# Telemetrie senden, Abbruch mit Ctrl-C
applications/mock-service/.venv/bin/mock-service run --sites 2 --rooms 2 --interval 10
```

Web-Oberfläche unter http://localhost:3000, Login `admin@local` mit Passwort
`admin`. Nach dem Seed dauert es bis zu 30 Sekunden, bis die ersten Messwerte
ankommen.

Stoppen

```bash
scripts/dev.sh down
```

## Google Cloud

Voraussetzungen

| Was         | Hinweis                                              |
| ----------- | ---------------------------------------------------- |
| GCP-Projekt | Abrechnung aktiviert, eigener Account ist Owner      |
| gcloud CLI  | aktuell                                              |
| terraform   | ab 1.7                                               |
| kubectl     | aktuell                                              |

Projekt angeben. Skripte und Manifeste sind auf das Projekt
`heating-platform-eval` eingestellt. Für ein eigenes Projekt einmalig die
Projekt-ID überall ersetzen, dazu im folgenden Befehl `MEIN-PROJEKT` durch die
eigene ID ersetzen.

```bash
grep -rl --include='*.sh' --include='*.yaml' heating-platform-eval infrastructure evaluation/scripts \
  | xargs perl -pi -e 's/heating-platform-eval/MEIN-PROJEKT/g'
```

Anmelden und vorbereiten, einmalig

```bash
gcloud auth login
gcloud auth application-default login
gcloud services enable cloudbuild.googleapis.com run.googleapis.com --project MEIN-PROJEKT
terraform -chdir=infrastructure/terraform init
```

Hochfahren

```bash
# 1. Images auf Cloud Build bauen, kein lokales Docker nötig, einige Minuten
infrastructure/scripts/cloudbuild-all.sh

# 2. Cluster anlegen, Plattform deployen, 100 Geräte anlegen, 60 s Telemetrie als Test
#    Dauert rund zehn Minuten
infrastructure/scripts/eval-up.sh --smoke

# 3. Adresse der Web-Oberfläche, Spalte EXTERNAL-IP, Port 80
kubectl -n heating-platform get svc frontend
```

Login wie lokal mit `admin@local` und Passwort `admin`.

Abbauen. Der Cluster kostet auch im Leerlauf laufend Geld und sollte nach
jeder Sitzung weg.

```bash
infrastructure/scripts/eval-down.sh          # nur der Cluster, die Images bleiben
infrastructure/scripts/eval-down.sh --all    # alles, inklusive Registry und Images
```
