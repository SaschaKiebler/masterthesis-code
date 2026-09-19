# Kernfunktionen im Code

Fünf Stellen tragen die Architekturentscheidungen des Services, zwei auf dem
Abfragepfad und drei auf dem Detection-Pfad. Die Auszüge sind gekürzt, die
Zeilenangaben führen zur vollständigen Fassung. Alle Pfade liegen unter
`analytics_service/`.

## 1. Mandantenprüfung `require_tenant_scope`

[tenancy.py#L219-L265](../../../applications/analytics-service/analytics_service/tenancy.py#L219-L265)

```python
async def require_tenant_scope(request: Request, _: None = Depends(require_token)) -> None:
    if settings.tenant_enforcement == "off":
        return
    subject = getattr(request.state, "subject", None)
    if subject is None:
        return
    try:
        body = await request.json()
    except Exception:
        return
    if not isinstance(body, dict):
        return

    metric_point_ids, channels, unscoped_aggregate = _collect_ids(body, request.url.path)
    membership = await _membership(subject)

    if unscoped_aggregate and not membership.unlimited:
        return await _refuse(request, subject, membership,
                             "aggregate over the whole measurement store requires metric_point_ids")

    foreign: list[str] = []
    if metric_point_ids:
        for mp_id, tenant in (await _tenants_of_metric_points(metric_point_ids)).items():
            if not membership.covers(tenant):
                foreign.append(mp_id)
    if channels:
        for key, tenant in (await _tenants_of_channels(channels)).items():
            if not membership.covers(tenant):
                foreign.append(key)

    if foreign:
        return await _refuse(request, subject, membership,
                             f"{len(foreign)} of the addressed channels belong to another tenant", ...)
```

Eine Router-Abhängigkeit statt Änderungen an jedem Endpunkt. Das geht, weil
Starlette den Body beim ersten Lesen cacht und FastAPI ihn danach unverändert
an das Modell bindet. Die Funktion zieht aus allen dreizehn Request-Formen
die adressierten IDs, löst Messpunkte über die Registry und Kanäle rückwärts
über den eindeutigen Schlüssel aus `device_id` und `metric_id` auf. Das
`ref`-Feld eines Kanals ist Aufrufer-Eingabe und wird nie zur Autorisierung
benutzt. Die Mitgliedschaft wird aus der Stammdaten-DB gelesen und nicht bei
core erfragt, damit ein synchroner Hop auf dem heißen Pfad entfällt. Ein
Aufruf von `/stats/ingest-rate` ohne IDs gilt als Zugriff auf den ganzen
Speicher und bleibt Admins vorbehalten. `_refuse` schreibt den Versuch in
`access_audit` und wirft im Modus `enforce` 403.

## 2. Aggregation in der Datenbank `fetch_timeseries`

[db/queries.py#L124-L158](../../../applications/analytics-service/analytics_service/db/queries.py#L124-L158)

```python
async def fetch_timeseries(pool, device_metric_pairs, start, end, bucket_seconds, aggregation="mean"):
    device_ids = [d for d, _ in device_metric_pairs]
    metric_ids = [m for _, m in device_metric_pairs]
    agg_fn = {"mean": "AVG", "min": "MIN", "max": "MAX", "sum": "SUM"}.get(aggregation, "AVG")

    rows = await pool.fetch(
        f"""
        WITH pairs AS (
            SELECT unnest($1::text[]) AS device_id, unnest($2::int[]) AS metric_id
        )
        SELECT
            EXTRACT(EPOCH FROM time_bucket(make_interval(secs => $5), m.time))::bigint AS bucket,
            m.device_id,
            m.metric_id,
            {agg_fn}(m.value) AS value
        FROM measurements m
        JOIN pairs p ON m.device_id = p.device_id AND m.metric_id = p.metric_id
        WHERE m.time >= to_timestamp($3) AND m.time < to_timestamp($4)
        GROUP BY bucket, m.device_id, m.metric_id
        ORDER BY bucket
        """,
        device_ids, metric_ids, start, end, float(bucket_seconds),
    )
    return [dict(r) for r in rows]
```

Die eine Abfrage hinter Zeitreihen, Differenz, Regression, Compute und
Histogramm. Die Kanäle kommen als zwei parallele Arrays, die `unnest` zu einer
Paar-Tabelle macht, damit ein Aufruf beliebig viele Kanäle in einem Statement
holt. `time_bucket` von TimescaleDB übernimmt die Aggregation, Python
bekommt nur noch fertige Buckets. Die Aggregatfunktion wird aus einer festen
Zuordnung gewählt und nie aus der Eingabe übernommen, die übrigen Werte sind
gebundene Parameter.

## 3. Replay eines compacted Topics `CompactedStore.start`

[detection/compacted.py#L31-L58](../../../applications/analytics-service/analytics_service/detection/compacted.py#L31-L58)

```python
async def start(self) -> None:
    consumer = AIOKafkaConsumer(bootstrap_servers=settings.kafka_bootstrap_servers,
                                enable_auto_commit=False, auto_offset_reset="earliest")
    await consumer.start()
    self._consumer = consumer

    partitions = await self._wait_for_topic()
    tps = [TopicPartition(self.topic, p) for p in partitions]
    consumer.assign(tps)
    for tp in tps:
        await consumer.seek_to_beginning(tp)
    end_offsets = await consumer.end_offsets(tps)

    remaining = {tp: end for tp, end in end_offsets.items() if end > 0}
    while remaining:
        batches = await consumer.getmany(timeout_ms=1000)
        for tp, messages in batches.items():
            for msg in messages:
                self._apply(msg.key, msg.value)
            if tp in remaining and messages and messages[-1].offset + 1 >= remaining[tp]:
                del remaining[tp]

    self._follow_task = asyncio.create_task(self._follow(), name=f"{type(self).__name__}-follow")
```

Event-carried State Transfer in einer Klasse, von der die drei Stores für
Regeln, Anomalieregeln und Geräte erben. Der Consumer weist sich die
Partitionen selbst zu und committet nie, es gibt also keine Gruppe und jede
Instanz liest alles. Die Funktion kehrt erst zurück, wenn jede Partition ihren
End-Offset erreicht hat, deshalb startet der Messwert-Consumer nie mit halbem
Regelstand. `_apply` der Unterklasse sieht Tombstones als `None` und entfernt
den Schlüssel. Auf ein noch nicht angelegtes Topic wartet `_wait_for_topic`
in Zwei-Sekunden-Schritten, weil der Besitzer es anlegt und nicht dieser
Service.

## 4. Messwert-Consumer `MeasurementConsumer._run`

[detection/consumer.py#L60-L81](../../../applications/analytics-service/analytics_service/detection/consumer.py#L60-L81)
und
[`_evaluate_batch`](../../../applications/analytics-service/analytics_service/detection/consumer.py#L83-L109)

```python
async def _run(self) -> None:
    dlq = settings.topic_measurement_ingested + ".dlq"
    async for msg in self._consumer:
        try:
            batch = measurement_ingestion_pb2.MeasurementBatch.FromString(msg.value)
        except DecodeError:
            await self._publisher.publish_raw(dlq, msg.key, msg.value)
            await self._consumer.commit()
            continue
        try:
            await self._evaluate_batch(batch)
        except Exception:
            log.exception("Evaluation failed for device=%s", batch.device_id)
        await self._consumer.commit()

async def _evaluate_batch(self, batch) -> None:
    device_id = batch.device_id
    for m in batch.measurements:
        findings = self._evaluator.evaluate(device_id, m.metric_id, m.value)
        for finding in findings:
            event = self._publisher.build_event(topic=settings.topic_threshold_breached, ...)
            await self._publisher.publish(event, settings.topic_threshold_breached)
        if self._observer is not None:
            self._observer(device_id, m.metric_id, m.value, ts)
```

At-least-once mit manuellem Commit nach der Auswertung. Nicht dekodierbare
Nachrichten gehen unverändert in die DLQ und werden committet, dasselbe
Verhalten wie in core auf demselben Topic. Eine Ausnahme in der Auswertung
wird geloggt und der Offset trotzdem committet, weil ein Batch, der immer
wieder scheitert, sonst den Consumer festhielte. Je Messwert läuft erst der
Schwellwert-Evaluator, dann geht der Wert als Beobachtung an die
Anomalie-Engine. Die Reihenfolge je Gerät kommt aus dem Kafka-Key.

## 5. Auswertung einer Anomalieregel `AnomalyEngine._evaluate_rule`

[detection/engine.py#L138-L174](../../../applications/analytics-service/analytics_service/detection/engine.py#L138-L174)

```python
async def _evaluate_rule(self, rule: AnomalyRule) -> None:
    now = time.monotonic()
    last = self._last_fired.get(rule.rule_id)
    if last is not None and now - last < rule.cooldown_seconds:
        return

    suppress = rule.binding(SUPPRESS_ROLE)
    if suppress is not None:
        latest = self._last_value(suppress)
        if latest is not None and latest > 0.5:
            return

    finding = await self._dispatch(rule)
    if finding is None:
        return
    summary, detail = finding

    detail = {**detail, "kind": f"{rule.detector}:{rule.rule_id}", "anomaly_rule": rule.name,
              "detector": rule.detector, "metric_point_id": rule.bindings[0].metric_point_id}
    event = self._publisher.build_event(
        topic=settings.topic_anomaly_detected, severity=rule.severity,
        device_id=rule.bindings[0].device_id, metric_id=rule.bindings[0].metric_id,
        asset_ref=rule.bindings[0].metric_point_id, tenant_id=rule.tenant_id,
        summary=summary, detail=json.dumps(detail, separators=(",", ":")),
    )
    await self._publisher.publish(event, settings.topic_anomaly_detected)
    self._last_fired[rule.rule_id] = now
```

Der Takt dieser Funktion ist unabhängig von der Messrate, sie läuft alle
300 Sekunden über alle Regeln. Drei Stufen vor der eigentlichen Prüfung.
Cooldown je Regel, die optionale Unterdrückungsbindung `suppress_while`, dann
`_dispatch`, das nach dem Template der Regel verzweigt. Ein Template gibt
entweder nichts zurück oder ein Paar aus Einzeiler und Detail-Werten. Die
Engine ergänzt Detektor, Regelname und den Schlüssel `kind`, mit dem
notification-service gleichartige Findings zusammenfasst, und bindet das
Event an die erste Bindung der Regel. Welche Kanäle überhaupt gepuffert
werden, folgt aus den Bindungen aller Regeln und nicht aus Heuristiken über
Einheit oder Namen, deshalb greift eine neue Regel ohne Neustart.
