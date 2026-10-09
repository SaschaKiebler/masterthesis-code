# Kernfunktionen im Code

Fünf Stellen tragen die Architekturentscheidungen des Services. Die Auszüge
sind gekürzt, die Zeilenangaben führen zur vollständigen Fassung. Alle Pfade
liegen unter `src/main/java/com/heatingplatform/core/`.

## 1. Mandantenprüfung `TenantScopeInterceptor.preHandle`

[tenancy/TenantScopeInterceptor.java#L55-L95](../../../applications/core-platform/src/main/java/com/heatingplatform/core/tenancy/TenantScopeInterceptor.java#L55-L95)

```java
public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
    if (properties.isOff() || isUnscoped(handler)) {
        return true;
    }
    String subject = currentSubject();
    if (subject == null) {
        return true;
    }
    List<TenantScope> scopes = scopesOf(request);
    if (scopes.isEmpty()) {
        return true;
    }
    Membership membership = membershipService.forSubject(subject);
    if (membership.unlimited()) {
        return true;
    }
    String method = request.getMethod();
    for (TenantScope scope : scopes) {
        // …
        if (evaluator.decide(membership, scope, method) == TenantAccessEvaluator.Decision.DENY) {
            return deny(request, response, subject, scope);
        }
    }
    markScope(request, firstResolved == null ? null : firstResolved.tenantId(), false);
    return true;
}
```

Ein Interceptor statt eines Filters, weil erst hier die Pfadvariablen
extrahiert sind. Ein Interceptor statt Annotationen je Handler, weil Opt-in
genau der Fehler war, der behoben werden sollte. Jede Route ist standardmäßig
abgedeckt. Die Kette der frühen `return true` ist Absicht, jede Stufe lässt
durch, wenn es nichts zu entscheiden gibt (Modus `OFF`, kein Subjekt, keine
adressierte Ressource, Admin). Erst danach wird je Ressource entschieden, und
ein einziges `DENY` genügt. Auch im Erlaubnisfall hinterlegt `markScope` den
Mandanten, damit der Audit-Filter ihn lesen kann. Welche Ressourcen die URL
adressiert, bestimmt
[`TenantResolverRegistry.resourcesIn`](../../../applications/core-platform/src/main/java/com/heatingplatform/core/tenancy/TenantResolverRegistry.java#L76-L103)
über das literale Segment vor jeder Pfadvariable.

## 2. Zugriffspolicy `TenantAccessEvaluator.decide`

[tenancy/TenantAccessEvaluator.java#L49-L77](../../../applications/core-platform/src/main/java/com/heatingplatform/core/tenancy/TenantAccessEvaluator.java#L49-L77)

```java
public Decision decide(Membership membership, TenantScope scope, String method) {
    if (membership.unlimited()) {
        return Decision.ALLOW;
    }
    return switch (scope.resolution()) {
        case GLOBAL -> isRead(method) ? Decision.ALLOW : Decision.DENY;
        case UNKNOWN -> Decision.ALLOW;
        case RESOLVED -> decideResolved(membership, scope);
    };
}

private Decision decideResolved(Membership membership, TenantScope scope) {
    if (membership.covers(scope.tenantId())) {
        return Decision.ALLOW;
    }
    return isAssignedToSite(membership, scope) ? Decision.ALLOW : Decision.DENY;
}
```

Die Funktion ist die Entscheidungstabelle aus der Thesis als Code, der
parametrisierte Test spiegelt dieselben Zeilen. `GLOBAL` steht für geteilte
Referenzdaten wie Objekttypen, die jeder liest, aber nur ein Admin ändert.
`UNKNOWN` wird erlaubt, damit ein echtes 404 nicht als 403 verkleidet wird
und Fehler sichtbar bleiben. Die Standortzuweisung für Techniker wird erst
geprüft, wenn die Mandantenprüfung schon gescheitert ist. So kostet sie auf
dem heißen Pfad nichts und kann die Mandantenregel nicht aufweichen.

## 3. Zugriffs-Audit `AccessAuditFilter`

[audit/AccessAuditFilter.java#L71-L90](../../../applications/core-platform/src/main/java/com/heatingplatform/core/audit/AccessAuditFilter.java#L71-L90)
und
[#L119-L134](../../../applications/core-platform/src/main/java/com/heatingplatform/core/audit/AccessAuditFilter.java#L119-L134)

```java
protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain) {
    String subject = currentSubject();
    filterChain.doFilter(request, response);
    try {
        audit(request, response.getStatus(), subject, resolvedTenant(request));
    } catch (RuntimeException e) {
        log.warn("Access audit failed for {} {}: {}", request.getMethod(), request.getRequestURI(), e.toString());
    }
}

private AccessOutcome classify(int status, String subject, UUID requestedTenant) {
    if (status == 401) { return AccessOutcome.UNAUTHENTICATED; }
    if (status == 403) { return AccessOutcome.DENIED; }
    if (requestedTenant == null || status < 200 || status >= 300) { return null; }
    return accessAuditService.isCrossTenant(subject, requestedTenant) ? AccessOutcome.FILTERED : null;
}
```

Das Subjekt wird vor der Kette gelesen, weil Spring Security den Kontext auf
dem Rückweg leert. Der Mandant wird nach der Kette gelesen, weil der
Interceptor ihn erst zwischen den beiden Hälften des Filters auflöst. Die
Klassifikation macht sichtbar, was ein 403 allein verbirgt. Ein Endpunkt, der
fremde Zeilen stillschweigend herausfiltert und 2xx antwortet, wird als
`FILTERED` erfasst. Der Null-Check auf den Mandanten steht vor der
Mitgliedschaftsabfrage, damit der Großteil des Verkehrs unter QS-PER-03 die
Datenbank nie berührt. Ein Fehler beim Schreiben wird geschluckt, das Audit
darf keine Anfrage scheitern lassen.

## 4. Regel-Projektion `ThresholdRuleConfigProjection.sweep`

[thresholdrule/ThresholdRuleConfigProjection.java#L52-L101](../../../applications/core-platform/src/main/java/com/heatingplatform/core/thresholdrule/ThresholdRuleConfigProjection.java#L52-L101)

```java
@Scheduled(fixedDelayString = "${kafka.rule-projection.sweep-interval-ms:30000}", initialDelay = 2000)
public synchronized void sweep() {
    Map<String, RuleConfig.Builder> configs = loadEnabledRules();

    for (Map.Entry<String, RuleConfig.Builder> entry : configs.entrySet()) {
        String ruleId = entry.getKey();
        int fingerprint = Arrays.hashCode(entry.getValue().build().toByteArray());
        Integer previous = published.get(ruleId);
        if (previous != null && previous == fingerprint) {
            continue;
        }
        RuleConfig config = entry.getValue().setUpdatedAt(/* jetzt */).build();
        kafka.send(props.getTopics().getRuleConfigured(), ruleId.getBytes(StandardCharsets.UTF_8), config.toByteArray());
        published.put(ruleId, fingerprint);
    }

    for (String ruleId : new ArrayList<>(published.keySet())) {
        if (!configs.containsKey(ruleId)) {
            kafka.send(props.getTopics().getRuleConfigured(), ruleId.getBytes(StandardCharsets.UTF_8), null);
            published.remove(ruleId);
        }
    }
}
```

Das ist der Mechanismus, mit dem core Konfiguration besitzt, ohne dass der
analytics-service je eine Registry liest. Der Sweep lädt alle aktiven Regeln
mit Geräte-ID und Metrik-ID aus dem Messpunkt denormalisiert, bildet einen
Fingerprint über den Inhalt (ohne `updated_at`, sonst sähe jeder Lauf wie
eine Änderung aus) und sendet nur, was sich geändert hat. Was aus der
Datenbank verschwunden oder deaktiviert ist, bekommt einen Tombstone, den die
Compaction im Topic wirksam macht. `synchronized`, weil CRUD-Aufrufe den
Sweep zusätzlich sofort anstoßen. Die Anomalieregeln nutzen denselben Code
in eigener Klasse, und device-management publiziert `device.configured` nach
demselben Muster.

## 5. Aktuelle Werte `LatestValueProjection.apply`

[measurement/LatestValueProjection.java#L34-L54](../../../applications/core-platform/src/main/java/com/heatingplatform/core/measurement/LatestValueProjection.java#L34-L54),
aufgerufen aus
[`MeasurementBatchListener.onMessage`](../../../applications/core-platform/src/main/java/com/heatingplatform/core/measurement/MeasurementBatchListener.java#L43-L58)

```java
public void apply(MeasurementBatch batch) {
    String deviceId = batch.getDeviceId();
    Instant batchTime = batch.hasIngestedAt() ? /* ingested_at */ : Instant.now();

    Instant newest = batchTime;
    for (IngestedMeasurement m : batch.getMeasurementsList()) {
        Instant time = m.hasTime() ? /* time */ : batchTime;
        byChannel.merge(key(deviceId, m.getMetricId()), new LatestValue(m.getValue(), time),
                (old, candidate) -> candidate.time().isBefore(old.time()) ? old : candidate);
        if (time.isAfter(newest)) {
            newest = time;
        }
    }
    Instant finalNewest = newest;
    lastSeenByDevice.merge(deviceId, finalNewest,
            (old, candidate) -> candidate.isBefore(old) ? old : candidate);
}
```

Das ist alles, was von core's Messwertzugriff nach der Trennung der Speicher
übrig ist. Zwei `ConcurrentHashMap`s, gefüttert aus dem Strom, den core
ohnehin konsumiert. Die `merge`-Lambdas behalten den jeweils jüngeren
Zeitstempel, deshalb stört es nicht, dass Batches eines Geräts über die
Shared Subscription des ingestion-service in beliebiger Reihenfolge
eintreffen. KPI-Auswertung, `/latest-values` und die Flottengesundheit lesen
hier, nie aus dem Messwertspeicher. Der Preis ist die leere Map nach einem
Neustart. Der Listener ruft `apply` vor dem KPI-Evaluator, weil dieser die
Werte liest, die der Batch gerade geliefert hat.
