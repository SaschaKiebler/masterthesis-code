# Betrieb

## Bauen und testen

Zusätzlich zur Rust-Toolchain (ab 1.90) braucht der Build `protoc` für die
Protobuf-Verträge aus `apis/proto` und `cmake`, weil rdkafka die mitgelieferte
librdkafka selbst kompiliert. Unter macOS `brew install protobuf cmake`.

```bash
cd applications/ingestion-service
cargo build
cargo test            # Unit-Tests, keine Infrastruktur nötig
cargo run             # gegen den lokalen Compose-Stack
```

Die Tests decken Topic-Filter, Routing, Signal-Map-Extraktion und die
Zeitstempel-Auflösung ab und brauchen weder Broker noch Datenbank.

## Lokal

`scripts/dev.sh up` startet den Service unter dem Namen `ingest` mit den
Standardwerten. Beim Hochfahren wartet er auf das Topic `device.configured`,
das device-management anlegt. Solange das noch nicht läuft, wiederholt er alle
fünf Sekunden `Topic not available yet`.

```bash
scripts/dev.sh logs ingest
```

Ein Gerät wird erst angenommen, wenn es in der Plattform angelegt wurde (zum
Beispiel per `mock-service seed`) und device-management die Konfiguration
publiziert hat, der Sweep läuft alle 30 Sekunden. Bis dahin loggt der Service
`Dropping ... message from unconfigured device`.

## Container

Das Image wird vom Repo-Root aus gebaut, weil `build.rs` die Protos unter
`apis/proto` relativ referenziert.

```bash
docker build -f applications/ingestion-service/Dockerfile -t ingestion-service .
```

Zweistufig, Builder auf `rust:1.90-bookworm`, Laufzeit auf
`debian:bookworm-slim` als unprivilegierter Nutzer. Kein HTTP-Port, keine
Probes.

## Skalierung im Cluster

Die Werte stehen in `infrastructure/kubernetes/base/ingestion-service.yaml`.

| Aspekt               | Wert                                                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| Replikas             | 2, HPA bis 10 bei 70 % CPU                                                        |
| Rollout              | RollingUpdate mit `maxUnavailable: 0`, damit immer ein Gruppenmitglied abonniert bleibt |
| Scale-up             | 2 Pods je Minute nach 30 s Stabilisierung                                         |
| Scale-down           | 1 Pod je Minute nach 300 s Stabilisierung                                         |
| Ressourcen           | 250m CPU, 256Mi bis 512Mi Speicher                                                |
| `DB_MAX_CONNECTIONS` | 6, mit 10 Replikas also höchstens 60 der 100 Verbindungen des Speichers           |

Drei Eigenschaften machen mehrere Replikas möglich.

- **Eigene Client-ID je Pod**, abgeleitet vom Pod-Namen. Sonst würden sich die
  Replikas gegenseitig vom Broker werfen.
- **Shared Subscription** über `MQTT_SHARE_GROUP`. Mosquitto gibt jede Nachricht
  an genau ein Gruppenmitglied. Verlässt ein Pod die Gruppe, übernehmen die
  anderen seinen Anteil.
- **Vollständiges Replay je Pod.** Jede Replika liest `device.configured`
  komplett und committet keine Offsets, alle Replikas gaten auf demselben Stand.
  Deshalb skaliert der HPA in Schritten, jeder neue Pod muss erst das Replay
  durchlaufen.

## Bekannte Grenzen

- **Keine Backpressure.** Jede Nachricht wird in einem eigenen Task ohne
  Obergrenze verarbeitet. Der begrenzte Pool lässt Tasks auf eine Verbindung
  warten, der Puffer vor dem Service ist die Warteschlange des Brokers.
- **Ein INSERT je Messwert.** Der Durchsatz der Kette hängt an der CPU des
  Messwertspeichers, nicht am Service.
- **Keine Reihenfolge je Gerät.** Mosquitto verteilt Shared Subscriptions ohne
  Affinität, aufeinanderfolgende Nachrichten eines Geräts können auf
  verschiedenen Pods landen. Maßgeblich ist `time` je Messwert, nicht die
  Ankunftsreihenfolge.
- **At-least-once.** MQTT mit QoS 1 und der idempotente Kafka-Producer
  verhindern Verluste, nicht Duplikate. Eine vom Broker erneut zugestellte
  Nachricht ergibt eine zweite Zeile, die Tabelle hat keinen eindeutigen Schlüssel.
- **Kafka-Ausfall kostet Events, keine Daten.** Ein Batch, der binnen 10 s
  nicht zugestellt ist, wird mit Warnung verworfen. Die Zeile steht bereits in
  der Datenbank, nur die nachgelagerte Auswertung dieses Batches fehlt.
- **Kein Health-Endpunkt.** Ein hängender Start, etwa durch einen falschen
  `DB_PORT`, ist von außen nicht von einem gesunden Pod zu unterscheiden. Das
  Log ist die einzige Quelle.
