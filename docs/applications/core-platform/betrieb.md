# Betrieb

## Bauen und testen

Voraussetzung ist ein JDK 21. `protoc` ist nicht nötig, das Protobuf-Plugin
lädt den Compiler selbst und übersetzt die Verträge aus `apis/proto`.

```bash
cd applications/core-platform
./gradlew build          # kompiliert, testet, baut das Boot-Jar
./gradlew test
./gradlew bootRun        # gegen den lokalen Compose-Stack, liest .env
```

Drei Tests starten den vollen Spring-Kontext gegen ein PostgreSQL in
Testcontainers und brauchen deshalb Docker. Das sind
`CorePlatformApplicationTests`, `JdbcTemplateWiringTest` und
`TenantScopeCoverageTest`. Die übrigen brauchen weder Docker noch Datenbank.

## Lokal

`scripts/dev.sh up` startet core als ersten Service mit `./gradlew bootRun`
und wartet bis zu fünf Minuten auf Port 8080, weil core das Schema migriert
und seine Topics anlegt, bevor die anderen Services sinnvoll starten können.
Ohne gesetztes Profil gilt die gesicherte Filterkette, Login mit `admin@local`
und `admin`. Eine `.env` im Service-Ordner kann `SPRING_PROFILES_ACTIVE`
setzen.

```bash
scripts/dev.sh logs core
curl -s http://localhost:8080/actuator/health
```

## Datenbank

- **Flyway** verwaltet das Schema mit den Migrationen `V1` bis `V30` unter
  `src/main/resources/db/migration`. Vor jedem `migrate` läuft ein `repair`,
  Baseline ist 0 und `out-of-order` ist erlaubt.
- **Geteilt.** notification-service migriert dieselbe Datenbank mit eigener
  History-Tabelle, device-management liest `physical_devices` und
  `metric_points` daraus. JPA validiert das Schema nur (`ddl-auto: validate`).
- **TimescaleDB ist optional.** `events` wird nur dann Hypertable, wenn die
  Erweiterung vorhanden ist. Auf dem `postgres:16` des Compose-Stacks ist es
  eine normale Tabelle.
- **Altlast.** `V1` legt `measurements` und `ingestion_errors` auch in der
  Stammdaten-DB an. Sie bleiben leer, geschrieben wird in den
  Messwertspeicher.

## Container

Das Image wird vom Repo-Root aus gebaut, damit `apis/proto` mit in den
Kontext kommt. Ein `sed` im Dockerfile biegt den Proto-Pfad auf das flache
Layout um.

```bash
docker build -f applications/core-platform/Dockerfile -t core-platform .
```

Zweistufig, Builder auf `eclipse-temurin:21-jdk-jammy` mit `bootJar -x test`,
Laufzeit auf `eclipse-temurin:21-jre-jammy` als unprivilegierter Nutzer mit
`curl` für Healthchecks.

## Im Cluster

Die Werte stehen in `infrastructure/kubernetes/base/core-platform.yaml`.

| Aspekt                    | Wert                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| Replikas                  | 1                                                                               |
| Ressourcen                | 500m CPU, 1Gi bis 1536Mi Speicher                                               |
| Readiness                 | `/actuator/health`, erste Prüfung nach 30 s                                     |
| Ports                     | 8080 HTTP, 9090 gRPC                                                            |
| `TENANT_ENFORCEMENT_MODE` | `ENFORCE`, wird zwischen den Probe-Läufen von QS-SEC-01 umgeschaltet            |

## Bekannte Grenzen

- **Eine Replika.** Latest-Value-Projektion, Regel-Fingerprints und der
  Mitgliedschafts-Cache liegen im Speicher einer Instanz. Mehrere Replikas
  würden unterschiedliche Stände halten.
- **Leer nach Neustart.** Aktuelle Werte und Flottengesundheit füllen sich
  erst mit neuer Telemetrie. Bis dahin melden Geräte „keine Daten“.
- **Kafka ist Startvoraussetzung.** Ohne Broker bricht der Kontext ab und der
  Pod startet neu, bis Kafka erreichbar ist.
- **Regeländerungen brauchen einen Sweep.** Über die API sofort, sonst bis zu
  30 Sekunden.
- **KPI-Auswertung blockiert den Listener.** Sie läuft auf dem
  Consumer-Thread, der Offset wird erst danach committet.
- **Nicht mandantengeprüft** sind IDs im Request-Body ohne `TenantBodyGuard`,
  gRPC und Kafka. Das Audit sieht nur Mandanten in der URL.
