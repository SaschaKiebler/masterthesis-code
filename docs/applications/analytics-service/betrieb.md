# Betrieb

## Installieren und starten

Voraussetzung ist Python ab 3.10, im Container läuft 3.12.

```bash
cd applications/analytics-service
python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/uvicorn analytics_service.main:app --port 8100 --reload
```

`scripts/dev.sh up` legt die Umgebung beim ersten Lauf selbst an und startet
den Service unter dem Namen `analytics`. Ohne erreichbaren Kafka-Broker
bricht der Start ab, für reine API-Arbeit hilft `KAFKA_ENABLED=false`.

```bash
scripts/dev.sh logs analytics
curl -s http://localhost:8100/health
```

## Protobuf

Der Python-Code für die Protobuf-Verträge liegt fertig generiert unter
`analytics_service/proto_gen/` im Repository und wird nicht beim Build
erzeugt. Nach einer Änderung an `apis/proto` muss er von Hand neu generiert
werden, dafür braucht es die Dev-Abhängigkeiten.

```bash
.venv/bin/pip install -e '.[dev]'
scripts/generate_protos.sh
```

## Container

Das Image wird vom Repo-Root aus gebaut. Zweistufig auf `python:3.12-slim`,
die Abhängigkeiten werden vor dem Quellcode installiert, damit der Cache bei
Codeänderungen hält. Der Prozess läuft als root, ein eigener Nutzer ist nicht
angelegt.

```bash
docker build -f applications/analytics-service/Dockerfile -t analytics-service .
```

## Im Cluster

Die Werte stehen in `infrastructure/kubernetes/base/analytics-service.yaml`.

| Aspekt                  | Wert                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Replikas                | 1                                                                                                           |
| Ressourcen              | 250m CPU, 512Mi bis 768Mi Speicher                                                                          |
| Readiness               | `/health`, erste Prüfung nach 5 s                                                                           |
| `LOCAL_AUTH_JWT_SECRET` | Aus dem Secret `platform-secrets`, muss mit core übereinstimmen, sonst antwortet jeder `/stats`-Aufruf mit 401 |
| `TENANT_ENFORCEMENT`    | `enforce`, wird für QS-SEC-01 zwischen den Läufen umgeschaltet                                              |

## Bekannte Grenzen

- **Eine Replika.** Cooldowns, letzte Werte, die Puffer der Engine und die
  Caches der Mandantenprüfung liegen im Speicher. Mehrere Replikas hielten
  je eigenen Zustand.
- **Leer nach Neustart.** Zustandswechsel-Regeln feuern erst ab dem zweiten
  Messwert, Anomalie-Fenster füllen sich erst wieder.
- **Erster Start ab Ende.** Die Consumer-Group beginnt beim allerersten
  Start am aktuellen Ende, ältere Batches werden nicht ausgewertet. Danach
  gilt der committete Offset.
- **Externe Abhängigkeit Open-Meteo.** Ohne Antwort schweigen die
  wetterabhängigen Regeln, es gibt keinen Fehler.
- **Schreibt in die Stammdaten-DB.** Abgelehnte Zugriffe landen in
  `access_audit`, damit QS-SEC-01 einen Eintrag je Versuch bekommt. Dieser
  Schreibzugriff dient allein der Messung in der Evaluation und ist per
  `ANALYTICS_AUDIT_ENABLED` abschaltbar.
- **Registry-Lookups auf dem Abfragepfad.** Die Endpunkte mit
  `metric_point_ids` lesen die Stammdaten-DB je Aufruf für den Anzeigekontext.
  Die Mandantenprüfung liest sie für jede Anfrage, bei Kanälen ohne Cache.
- **CORS ist offen** für alle Origins, der Schutz ist der Token.
