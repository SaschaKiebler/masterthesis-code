# Betrieb

## Installieren

Voraussetzung ist Python ab 3.10.

```bash
cd applications/mock-service
python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/mock-service plan
```

`scripts/dev.sh up` legt diese Umgebung nicht selbst an, der Startbanner
nennt aber die beiden Befehle für Seed und Run.

## Lokal gegen den Compose-Stack

Die Standardwerte passen zum lokalen Stack, Broker auf `localhost:1883` und
Stammdaten-DB auf `localhost:5432`.

```bash
.venv/bin/mock-service seed --sites 2 --rooms 2
.venv/bin/mock-service run  --sites 2 --rooms 2 --interval 10
```

Ob die Werte ankommen, zeigt `scripts/dev.sh logs ingest` (Zeilen mit
`Processed`) oder das Frontend im Projekt „Mock Fleet“ nach dem Login mit
`admin@local`.

## Container

Das Image wird aus dem Service-Ordner gebaut, nicht vom Repo-Root, weil das
Dockerfile nur die eigenen Dateien kopiert. Der Einstiegspunkt ist
`mock-service`, das Standardkommando `run`.

```bash
docker build -t mock-service applications/mock-service
docker run --rm mock-service seed --dsn postgresql://postgres:password@stammdaten-db:5432/digital_demon
docker run --rm mock-service run --broker mosquitto:1883 --sites 10 --rooms 3
```

## Im Cluster und in der Evaluation

Der mock-service läuft nie dauerhaft im Cluster. Er wird als Job gestartet.

| Einsatz          | Wo                                   | Parameter                                                                                  |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Flotte anlegen   | Kubernetes-Job `mock-seed`           | `--prefix=tenanta --sites=25 --rooms=3`, DSN auf `stammdaten-db`                           |
| Zweiter Mandant  | Kubernetes-Job `mock-seed-tenantb`   | `--prefix=tenantb --sites=2 --rooms=2`                                                     |
| Funktionslauf    | Kubernetes-Job `mock-run`            | 600 s, 4 Verbindungen, eine `overheat`-Störung                                             |
| Rauchtest        | `eval-up.sh --smoke`                 | Kurzer Lauf als Pod, prüft, dass Zeilen im Messwertspeicher ankommen                       |
| Lastmessung      | Cloud-Run-Job `mock-load`            | Außerhalb des Clusters, damit der Generator nicht mit den Services um Ressourcen konkurriert |

Die Lastszenarien (`ramp`, QS-PER-01, QS-PER-02) setzen die Parameter über
`evaluation/scripts/ingest-scenario.sh`, dort muss nichts von Hand angepasst
werden. Details in [evaluation/README.md](../../../evaluation/README.md).

## Bekannte Grenzen

- **Kein Rückkanal.** Der mock-service sieht nicht, ob Nachrichten
  verarbeitet wurden. Die Verlustrate ergibt sich erst aus dem Vergleich von
  `seeded` in der Abschlusszeile mit den Zeilen im Messwertspeicher.
- **Zwei Generatoren gleichzeitig** brauchen verschiedene MQTT-Client-IDs.
  Jeder Prozess bekommt eine zufällige Kennung, mit `MOCK_RUN_ID` lässt sie
  sich festlegen.
- **Seed und Run müssen zusammenpassen.** Ein anderes Präfix oder eine andere
  Anzahl ergibt Geräte, die der ingestion-service nicht kennt.
- **Warteschlange begrenzt.** Ab 20.000 wartenden Nachrichten wird verworfen
  und `dropped` gezählt. Dann fehlen Verbindungen oder der Broker ist am
  Limit.
- **Keine Tests im Repo.**
