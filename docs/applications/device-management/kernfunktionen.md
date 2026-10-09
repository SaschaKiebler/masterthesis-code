# Kernfunktionen im Code

Fünf Stellen tragen die Logik des Services. Die Auszüge sind gekürzt, die
Zeilenangaben führen zur vollständigen Fassung. Alle Pfade liegen unter
`src/main/java/com/heatingplatform/devicemanagement/`.

## 1. Sweep der Projektion `DeviceConfigProjection.sweep`

[projection/DeviceConfigProjection.java#L64-L121](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/projection/DeviceConfigProjection.java#L64-L121)

```java
@Scheduled(fixedDelayString = "${device-management.projection.sweep-interval-ms:30000}", initialDelay = 2000)
public void sweep() {
    Map<String, DeviceConfig.Builder> configs = loadConfigsFromDatabase();
    applySiteCoordinates(configs);

    for (Map.Entry<String, DeviceConfig.Builder> entry : configs.entrySet()) {
        String deviceId = entry.getKey();
        int fingerprint = Arrays.hashCode(entry.getValue().build().toByteArray());
        Integer previous = published.get(deviceId);
        if (previous != null && previous == fingerprint) {
            continue;
        }
        DeviceConfig config = entry.getValue().setUpdatedAt(/* jetzt */).build();
        kafka.send(props.getTopics().getDeviceConfigured(), deviceId.getBytes(StandardCharsets.UTF_8), config.toByteArray());
        published.put(deviceId, fingerprint);
    }

    for (String deviceId : new ArrayList<>(published.keySet())) {
        if (!configs.containsKey(deviceId)) {
            kafka.send(props.getTopics().getDeviceConfigured(), deviceId.getBytes(StandardCharsets.UTF_8), null);
            published.remove(deviceId);
        }
    }

    if (!initialSweepDone) {
        initialSweepDone = true;
    }
}
```

Das Original des Musters, das core später für seine Regeln kopiert hat. Die
Datenbank ist die Wahrheit, das Topic ein Abbild davon, und der Sweep
gleicht beide ab. Der Fingerprint über den Inhalt ohne `updated_at` sorgt
dafür, dass ein unveränderter Stand nichts sendet. Nach einem Neustart ist
die Map leer, der erste Sweep publiziert deshalb alles einmal, was zugleich
der Weg ist, auf dem Konsumenten sich nach einem Verlust wieder
synchronisieren. Die Map `published` dient nebenbei dem Watcher als Liste
bekannter Geräte, und `initialSweepDone` sagt ihm, ab wann er dieser Liste
trauen darf.

## 2. Standort aus dem Graph `DeviceConfigProjection.applySiteCoordinates`

[projection/DeviceConfigProjection.java#L187-L244](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/projection/DeviceConfigProjection.java#L187-L244)

```sql
WITH RECURSIVE lt AS (
    SELECT id, name FROM link_types
    WHERE name IN ('REALIZED_BY', 'CONTAINS', 'INSTALLED_AT', 'INSTALLED_IN')
),
device_assets AS (
    SELECT pd.device_id, l.source_object_id AS object_id
    FROM physical_devices pd
    JOIN links l ON l.target_object_id = pd.id
    JOIN lt ON lt.id = l.link_type_id AND lt.name = 'REALIZED_BY'
),
up AS (
    SELECT device_id, object_id, 0 AS depth FROM device_assets
    UNION ALL
    SELECT up.device_id, parents.next_object, up.depth + 1
    FROM up
    JOIN LATERAL (
        SELECT l.target_object_id AS next_object FROM links l JOIN lt ON lt.id = l.link_type_id
        WHERE l.source_object_id = up.object_id AND lt.name IN ('INSTALLED_AT', 'INSTALLED_IN')
        UNION
        SELECT l.source_object_id FROM links l JOIN lt ON lt.id = l.link_type_id
        WHERE l.target_object_id = up.object_id AND lt.name = 'CONTAINS'
    ) parents ON TRUE
    WHERE up.depth < 6
)
SELECT u.device_id, u.depth, o.properties::text AS properties
FROM up u JOIN objects o ON o.id = u.object_id
WHERE o.properties IS NOT NULL AND o.properties::text LIKE '%latitude%'
ORDER BY u.device_id, u.depth
```

Hier zahlt sich das Objektmodell aus. Ein Gerät kennt seinen Standort nicht,
aber der Graph kennt ihn. Die rekursive Abfrage läuft vom Gerät zum Asset,
von dort über `INSTALLED_AT` und `INSTALLED_IN` in den Raum und die
`CONTAINS`-Kette hinauf bis zum Gebäude, höchstens sechs Ebenen. Das nächste
Objekt mit Koordinaten in seinem JSON gewinnt, in Java wird nur noch die
erste Zeile je Gerät genommen und `latitude` und `longitude` aus
`properties.custom` oder `properties.attributes` gelesen. Weil die
Koordinaten Teil des Fingerprints sind, publiziert ein Standortwechsel im
Graph das Gerät ohne weiteres Zutun neu, und der analytics-service holt die
Außentemperatur am richtigen Ort.

## 3. Unbekannte Geräte melden `BrokerWatcher.onMessage`

[watcher/BrokerWatcher.java#L63-L100](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/watcher/BrokerWatcher.java#L63-L100)

```java
void onMessage(String topic, String payload) {
    if (!projection.isReady()) {
        return;
    }
    DeviceTopicParser.extractDeviceId(topic).ifPresent(deviceId -> {
        if (projection.isKnownDevice(deviceId)) {
            return;
        }
        Instant now = Instant.now();
        Duration throttle = Duration.ofMinutes(props.getWatcher().getDiscoveredThrottleMinutes());
        Instant last = lastAnnounced.get(deviceId);
        if (last != null && Duration.between(last, now).compareTo(throttle) < 0) {
            return;
        }
        lastAnnounced.put(deviceId, now);

        String sample = payload.length() > maxChars ? payload.substring(0, maxChars) : payload;
        DeviceDiscovered event = DeviceDiscovered.newBuilder()
                .setDeviceId(deviceId).setProtocol("MQTT")
                .setSampleTopic(topic).setSamplePayload(sample)
                .setSeenAt(/* now */).build();
        kafka.send(props.getTopics().getDeviceDiscovered(), deviceId.getBytes(StandardCharsets.UTF_8), event.toByteArray());
    });
}
```

Vier Filter hintereinander, jeder billig. Ohne abgeschlossenen ersten Sweep
gilt nichts als unbekannt, sonst würde nach jedem Neustart die ganze Flotte
gemeldet. Die Geräte-ID kommt aus
[`DeviceTopicParser.extractDeviceId`](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/watcher/DeviceTopicParser.java#L16-L46),
der dieselben Topic-Konventionen kennt wie die Parser im ingestion-service,
damit beide Dienste dasselbe Gerät meinen. Bekannte Geräte kosten nur einen
Map-Lookup. Die Drosselung je Gerät hält gesprächige Geräte vom Topic fern,
zehn Minuten sind der Standard. Erst dann wird ein Event gebaut, mit Topic
und einer gekürzten Nutzlastprobe als Hinweis für die spätere
Template-Erstellung.

## 4. Eine Verbindung für alle `MqttConnection.connect`

[mqtt/MqttConnection.java#L48-L108](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/mqtt/MqttConnection.java#L48-L108)
und
[`registerHandler`](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/mqtt/MqttConnection.java#L114-L136)

```java
@EventListener(ApplicationReadyEvent.class)
@Order(0)
public void connect() {
    MqttConnectOptions options = new MqttConnectOptions();
    options.setAutomaticReconnect(true);
    options.setCleanSession(true);
    options.setKeepAliveInterval(30);

    client = new MqttAsyncClient(props.getBrokerUrl(), props.getClientId(), new MemoryPersistence());
    client.setCallback(new MqttCallbackExtended() {
        @Override
        public void connectComplete(boolean reconnect, String serverURI) {
            client.subscribe(CATCH_ALL_TOPIC, 0);
        }
        @Override
        public void messageArrived(String topic, MqttMessage message) {
            for (var entry : handlers.entrySet()) {
                try {
                    entry.getValue().accept(topic, message);
                } catch (Exception e) {
                    log.warn("MQTT handler '{}' failed on topic {}: {}", entry.getKey(), topic, e.getMessage());
                }
            }
        }
        // …
    });
    client.connect(options).waitForCompletion(15_000);
}
```

Der Service hält genau eine Subscription auf `#` und verteilt jede Nachricht
an alle registrierten Handler. Der Watcher ist dauerhaft registriert,
Discovery-Sitzungen kommen und gehen. Weil die Subscription der Verbindung
gehört und nicht den Handlern, kann eine endende Sitzung dem Watcher nie den
Strom abdrehen. Das Abonnieren passiert in `connectComplete` und damit auch
nach jedem automatischen Reconnect, derselbe Kniff wie beim `ConnAck` im
ingestion-service. Ein Handler, der wirft, kostet die anderen nichts.
`registerHandler` wartet bis zu fünf Sekunden auf eine laufende Verbindung
und wirft danach, damit eine Sitzung, die ohne Broker startet, dem Nutzer
einen echten Fehler zeigt statt still nichts zu sammeln.

## 5. Signal-Map vorschlagen `DeviceDiscoveryService.analyzePayloads`

[discovery/DeviceDiscoveryService.java#L95-L157](../../../applications/device-management/src/main/java/com/heatingplatform/devicemanagement/discovery/DeviceDiscoveryService.java#L95-L157)

```java
public Map<String, Object> analyzePayloads(UUID sessionId) {
    List<CapturedMessage> messages = session.getMessageList();
    Map<String, Set<String>> fieldsBySource = new LinkedHashMap<>();
    Map<String, String> fieldTypes = new LinkedHashMap<>();

    for (CapturedMessage msg : messages) {
        if (msg.getParsedPayload() == null || !msg.getParsedPayload().isObject()) continue;
        String source = extractSource(msg.getTopic(), session.getDeviceId());
        extractFields(msg.getParsedPayload(), "", 0).forEach((fieldName, type) -> {
            fieldsBySource.computeIfAbsent(source, k -> new LinkedHashSet<>()).add(fieldName);
            fieldTypes.putIfAbsent(source + "/" + fieldName, type);
        });
    }

    List<Map<String, String>> suggestedSignalMap = new ArrayList<>();
    int metricIdx = 1;
    for (Map.Entry<String, Set<String>> entry : fieldsBySource.entrySet()) {
        for (String field : entry.getValue()) {
            if (!"number".equals(fieldTypes.getOrDefault(entry.getKey() + "/" + field, "string"))) continue;
            Map<String, String> signal = new LinkedHashMap<>();
            signal.put("metricId", String.valueOf(metricIdx++));
            signal.put("source", entry.getKey());
            signal.put("field", field);
            signal.put("name", humanize(field));
            signal.put("unit", guessUnit(field));
            suggestedSignalMap.add(signal);
        }
    }
    // …
}
```

Die Brücke zwischen dem, was ein Gerät sendet, und dem, was der
ingestion-service braucht. Die Quelle ist derselbe Topic-Teil, den später
`source` in der Signal-Map trägt, und die Felder werden bis zwei Ebenen tief
in Punktnotation aufgelöst, genau so tief, wie der Parser im
ingestion-service sie wieder auflöst. Aus jedem numerischen Feld wird ein
Vorschlag mit fortlaufender `metricId`, einem lesbaren Namen und einer
geratenen Einheit. Der Nutzer korrigiert in der Oberfläche, core schreibt
die `metric_points`, der nächste Sweep publiziert die Konfiguration, und ab
dann nimmt der ingestion-service das Gerät an.
