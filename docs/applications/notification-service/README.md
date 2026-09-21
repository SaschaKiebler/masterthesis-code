# notification-service

Die Ausgangsseite der Erkennung. Detektoren im analytics-service melden
Befunde als Events, dieser Service macht daraus Meldungen für die Nutzer.
Er wendet je Mandant Benachrichtigungsregeln an (welche Ereignisse, ab
welcher Schwere, wie oft höchstens), speichert jede Meldung und liefert sie
zusätzlich an einen Webhook, etwa n8n. Java 21, Spring Boot 4, Spring Kafka,
Spring JDBC, Flyway.

| Seite                                        | Inhalt                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| [API und Regeln](api.md)                     | REST-Endpunkte, Felder einer Regel und einer Meldung, Konfiguration |
| [Betrieb](betrieb.md)                        | Bauen, Starten, Cluster, bekannte Grenzen                          |
| [Kernfunktionen im Code](kernfunktionen.md)  | Zwei Stellen, die Regelanwendung und die Mandantenauflösung        |

## Von Event zu Meldung

1. Der Listener konsumiert `threshold.breached` und `anomaly.detected` in
   der Consumer-Group `notification`. Nicht dekodierbare Nachrichten gehen in
   das jeweilige `.dlq`-Topic.
2. Das Event trägt den Mandanten. Für ihn werden die aktiven Regeln geladen,
   gecacht für 30 Sekunden. Hat der Mandant keine Regel, gilt eine implizite
   Standardregel aus der Konfiguration, damit unkonfigurierte Mandanten
   nicht leer ausgehen.
3. Je Regel wird geprüft, ob der Ereignistyp passt, ob die Schwere die
   Mindestschwere erreicht und ob dieselbe Erkennung innerhalb des
   Cooldowns schon gemeldet wurde.
4. Passt alles, entsteht eine Meldung in der Datenbank und der Befund geht
   als JSON an den Webhook der Regel, ersatzweise an den globalen Webhook.
   Eine `ALERT`-Zeile im Log gibt es immer.

Ein Event ohne Mandanten läuft nur durch die globale Richtlinie und wird nur
geloggt, es entsteht keine Meldung.

## Schnittstellen

| Richtung | Kanal                                                 | Inhalt                                                                    |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| ein      | Kafka `threshold.breached`, `anomaly.detected`        | `DetectionEvent` vom analytics-service, konfigurierbar über `NOTIFICATION_TOPICS` |
| ein      | REST `/api/v1/notifications`, `/api/v1/notification-rules` auf Port 8083 | Meldungen lesen und quittieren, Regeln pflegen. Token von core, Mandant aus dem Token |
| aus      | Kafka `threshold.breached.dlq`, `anomaly.detected.dlq` | Dead Letter der eigenen Subscriptions, vom Service angelegt              |
| aus      | HTTP-Webhook, optional                                | Befund als JSON mit Bearer-Token                                          |
| beides   | PostgreSQL `stammdaten-db`                            | Eigene Tabellen `notification_rules` und `notifications`, eigene Flyway-History. Lesend `users`, `user_tenant_roles`, `tenants` für die Mandantenauflösung |

Zwei Arten von Regeln bleiben strikt getrennt. Schwellwert- und
Anomalieregeln sind Erkennungskonfiguration und gehören core.
Benachrichtigungsregeln sind Richtlinie je Mandant und gehören diesem
Service.

## Was beim Start passiert

1. Flyway migriert die eigenen Tabellen in der geteilten Datenbank, mit
   eigener History-Tabelle und Baseline 0.
2. Die `.dlq`-Topics werden angelegt. Ohne erreichbaren Broker bricht der
   Start ab.
3. Der Listener startet. Beim allerersten Start ab dem aktuellen Ende, alte
   Events werden nicht nachgeholt, weil Alarme nur live sinnvoll sind.
