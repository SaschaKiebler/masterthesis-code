# Kernfunktionen im Code

Fünf Stellen tragen die Logik des Services. Die Auszüge sind gekürzt, die
Zeilenangaben führen zur vollständigen Fassung.

## 1. Event-Loop `run`

[src/mqtt.rs#L52-L99](../../../applications/ingestion-service/src/mqtt.rs#L52-L99)

```rust
loop {
    match eventloop.poll().await {
        Ok(Event::Incoming(Packet::Publish(publish))) => {
            let received_at = Utc::now();
            let topic = publish.topic.clone();
            let payload = String::from_utf8_lossy(&publish.payload).to_string();
            // …
            tokio::spawn(async move {
                if let Err(e) = process_message(&pool_clone, &state_clone, &publisher_clone, &topic, &payload, received_at).await {
                    error!("Error processing message on {}: {:?}", topic, e);
                    if let Err(db_err) = db::insert_error(&pool_clone, &payload, &e.to_string()).await { /* … */ }
                }
            });
        }
        Ok(Event::Incoming(Packet::ConnAck(_))) => {
            subscribe_all(&client, &filters).await?;
        }
        // …
    }
}
```

`received_at` wird auf der Loop gestempelt, nicht im Task. Dadurch zählt die
Wartezeit in der Task-Queue zur Ingest-Latenz und verschwindet nicht vor dem
ersten Messwert. Jede Nachricht bekommt einen eigenen Task, die Loop blockiert
nie, es gibt aber auch keine Obergrenze. Bei jedem `ConnAck` werden die Filter
neu abonniert, weil rumqttc Subscriptions nach einem Reconnect nicht
wiederherstellt. Ohne diese Zeile war der Service nach einem Broker-Neustart
verbunden, aber taub. Die Filter selbst baut
[`subscription_filters`](../../../applications/ingestion-service/src/mqtt.rs#L124-L144),
die überlappende Filter zusammenfasst und den `$share/`-Präfix setzt.

## 2. Pipeline `process_message`

[src/mqtt.rs#L182-L315](../../../applications/ingestion-service/src/mqtt.rs#L182-L315)

```rust
if let Some(shelly_info) = parser::parse_shelly_topic(topic) {
    if !device_state.is_accepted(&shelly_info.device_id).await {
        info!("Dropping Shelly message from unconfigured device: {}", shelly_info.device_id);
        return Ok(());
    }
    let timestamp = received_at;
    let signal_map = device_state.signal_map(&shelly_info.device_id).await;
    let measurements = parser::parse_shelly(&shelly_info, payload, timestamp, signal_map.as_ref())?;
    for m in &measurements {
        db::insert_measurement(pool, &shelly_info.device_id, m.metric_id, m.value, m.time, received_at).await?;
    }
    if !measurements.is_empty() {
        // …
        publisher.publish_batch(&shelly_info.device_id, &points).await;
    }
    return Ok(());
}
```

Die Funktion prüft drei Routen in fester Reihenfolge, Shelly, Tasmota,
generisch, und die erste passende gewinnt. Jede Route folgt demselben Muster.
Gate über die Projektion, Signal-Map holen, parsen, je Messwert ein INSERT,
danach ein Kafka-Batch. Das Gate kommt vor dem Parsen, damit unbekannte Geräte
keine Rechenzeit und keine Fehlerzeile kosten. Das `?` hinter Parser und INSERT
ist die Fehlerbehandlung, alles, was hier scheitert, landet über die Loop in
`ingestion_errors`. Der Kafka-Aufruf hat kein `?`, er ist Fire-and-forget,
weil die Datenbankzeile zu diesem Zeitpunkt schon steht.

## 3. Projektion `DeviceStateStore::start`

[src/device_state.rs#L45-L135](../../../applications/ingestion-service/src/device_state.rs#L45-L135)

```rust
let partitions = wait_for_topic(&consumer, &topic).await?;
for partition in &partitions {
    assignment.add_partition_offset(&topic, *partition, Offset::Beginning)?;
    let (low, high) = consumer.fetch_watermarks(&topic, *partition, Duration::from_secs(10))?;
    high_watermarks.insert(*partition, high);
}
consumer.assign(&assignment)?;

while caught_up.values().any(|done| !done) {
    match tokio::time::timeout(Duration::from_secs(5), consumer.recv()).await {
        Ok(Ok(msg)) => {
            apply_message(&states, msg.key(), msg.payload()).await;
            if msg.offset() + 1 >= high { caught_up.insert(msg.partition(), true); }
        }
        // …
    }
}

tokio::spawn(async move {
    loop {
        match consumer.recv().await {
            Ok(msg) => apply_message(&live_states, msg.key(), msg.payload()).await,
            // …
        }
    }
});
```

Der Consumer weist sich alle Partitionen manuell ab `Beginning` zu und
committet nie Offsets. Es gibt also keine Consumer-Group-Koordination, jede
Replika liest das compacted Topic vollständig und hält denselben Stand. Die
Funktion kehrt erst zurück, wenn jede Partition ihre High Watermark erreicht
hat, deshalb nimmt der Service vor Abschluss des Replays keine MQTT-Nachricht
an. Danach läuft derselbe Consumer in einem Hintergrund-Task weiter und wendet
jede Änderung sofort an. Ein Tombstone (leere Nutzlast) entfernt das Gerät aus
der Map, siehe `apply_message`.

## 4. Datengetriebene Extraktion `extract_by_signal_map`

[src/parser/shelly.rs#L129-L200](../../../applications/ingestion-service/src/parser/shelly.rs#L129-L200)

```rust
let source_key = if component.contains(':') { component.to_string() } else { format!("{}:0", component) };

for (key, entry) in map {
    let entry_source = match entry.get("source").and_then(|s| s.as_str()) { Some(s) => s, None => continue };
    if entry_source != component && entry_source != source_key { continue; }

    let field_path = match entry.get("field").and_then(|f| f.as_str()).filter(|f| !f.is_empty()) {
        Some(f) => f,
        None => match default_field_for_component(component) { Some(default) => default, None => continue },
    };
    let metric_id = match key.parse::<i16>() { Ok(id) => id, Err(_) => continue };

    if let Some(value) = resolve_json_field(json, field_path) {
        measurements.push(Measurement { metric_id, value, time: timestamp });
    }
}
```

Alle drei Routen rufen diese Funktion, sie ist der einzige Ort, an dem aus
JSON ein Messwert wird. Der Parser kennt keine Gerätetypen, er kennt nur die
Regel „Eintrag mit passendem `source`, lies `field`“. Ein neuer Sensortyp
braucht deshalb keine Codeänderung, nur eine Signal-Map. Die
`:0`-Normalisierung macht `em` und `em:0` gleichwertig. Fehlt ein Feld in der
Nutzlast, wird der Eintrag übersprungen statt die Nachricht zu verwerfen.
`resolve_json_field` löst Punktnotation bis drei Ebenen auf und wandelt
Booleans in `1.0` und `0.0`.

## 5. Zeitstempel `resolve_source_time`

[src/parser/mod.rs#L29-L69](../../../applications/ingestion-service/src/parser/mod.rs#L29-L69)

```rust
const SOURCE_TIME_FIELDS: &[&str] = &["ts", "timestamp", "Time", "time"];
const MAX_CLOCK_SKEW_SECONDS: i64 = 24 * 3600;

pub(crate) fn resolve_source_time(json: &serde_json::Value, received_at: DateTime<Utc>) -> (DateTime<Utc>, bool) {
    for field in SOURCE_TIME_FIELDS {
        let Some(raw) = json.get(*field) else { continue };
        let Some(parsed) = parse_source_time(raw) else { continue };
        let skew = (parsed - received_at).num_seconds().abs();
        if skew > MAX_CLOCK_SKEW_SECONDS { continue; }
        return (parsed, true);
    }
    (received_at, false)
}
```

Die Funktion entscheidet, was in der Spalte `time` steht. Sie bevorzugt eine
Uhr aus der Nutzlast und fällt auf `received_at` zurück. Der zweite
Rückgabewert sagt, welche der beiden es war. Die 24-Stunden-Grenze ist der
Schutz gegen Geräte ohne NTP, die Epoch 0 melden und sonst einen
Hypertable-Chunk im Jahr 1970 öffnen würden. Ein unbrauchbares erstes Feld
verdeckt kein brauchbares späteres. Für die Evaluation ist die Funktion
zentral, weil nur mit einer Geräteuhr in `time` die Transportzeit von der
Verarbeitungszeit getrennt werden kann.
