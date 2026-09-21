# Betrieb

## Bauen und starten

Voraussetzung ist ein JDK 21. Der Protobuf-Vertrag `DetectionEvent` kommt
über das Protobuf-Plugin aus `apis/proto`, `protoc` muss nicht installiert
sein.

```bash
cd applications/notification-service
./gradlew build
./gradlew bootRun
```

Im Repo liegen keine Tests für diesen Service.

## Lokal

`scripts/dev.sh up` startet den Service unter dem Namen `notify` nach
core-platform. Er braucht die Stammdaten-DB, in der core sein Schema schon
angelegt hat, und Kafka.

```bash
scripts/dev.sh logs notify
curl -s http://localhost:8083/actuator/health
```

Ob Meldungen entstehen, zeigt das Log an den `ALERT`-Zeilen oder die Seite
„Notifications“ im Frontend. Für eine schnelle Probe reicht der mock-service
mit einer `overheat`-Störung, siehe [mock-service](../mock-service/cli.md).

## Container

Das Image wird vom Repo-Root aus gebaut, wie bei den anderen Java-Diensten
mit einem `sed` für den Proto-Pfad. Laufzeit auf `eclipse-temurin:21-jre` als
unprivilegierter Nutzer, `JAVA_OPTS` mit `-Xmx256m -Xms128m`.

```bash
docker build -f applications/notification-service/Dockerfile -t notification-service .
```

## Im Cluster

Die Werte stehen in `infrastructure/kubernetes/base/notification-service.yaml`.

| Aspekt      | Wert                                                                  |
| ----------- | --------------------------------------------------------------------- |
| Replikas    | 1                                                                     |
| Ressourcen  | 250m CPU, 512Mi bis 768Mi Speicher                                    |
| Readiness   | `/actuator/health`, erste Prüfung nach 20 s                           |
| Webhook     | Auskommentiert, im Cluster wird nur geloggt und gespeichert           |

Das Manifest enthält nur ein Deployment und keinen Kubernetes-Service. Die
REST-API ist im Cluster deshalb unter keinem Namen erreichbar, und das
Frontend setzt dort auch kein `NOTIFICATION_URL`. Der Kafka-Pfad und die
Speicherung funktionieren, die Seite „Notifications“ im Frontend nicht.

## Bekannte Grenzen

- **Eine Replika.** Cooldowns und Regel-Cache liegen im Speicher. Der
  Rückfall auf die jüngste gespeicherte Meldung fängt nur den Neustart ab,
  nicht mehrere Instanzen.
- **Kein Nachholen.** Beim allerersten Start beginnt die Gruppe am Ende des
  Topics. Danach gilt der committete Offset.
- **Webhook ohne Wiederholung.** Ein fehlgeschlagener Webhook-Aufruf wird
  geloggt und nicht wiederholt, die Meldung existiert trotzdem.
- **Mandantenauflösung liest fremde Tabellen.** `users` und
  `user_tenant_roles` gehören core. Das ist dieselbe bewusste Abweichung wie
  bei device-management.
- **Kein Health-Endpunkt für Kafka.** `/actuator/health` sagt nichts darüber,
  ob der Listener Events erhält.
