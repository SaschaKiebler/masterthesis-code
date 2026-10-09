# Kernfunktionen im Code

Zwei Stellen tragen den Service. Die Auszüge sind gekürzt, die Zeilenangaben
führen zur vollständigen Fassung. Beide Pfade liegen unter
`src/main/java/com/heatingplatform/notification/`.

## 1. Regelanwendung `MeldungService.process`

[MeldungService.java#L43-L63](../../../applications/notification-service/src/main/java/com/heatingplatform/notification/MeldungService.java#L43-L63)

```java
public void process(UUID tenantId, DetectionEvent event) {
    List<NotificationRule> rules = ruleCache.enabledRulesFor(tenantId);
    if (rules.isEmpty()) {
        rules = List.of(defaultRule(tenantId));
    }
    for (NotificationRule rule : rules) {
        if (!rule.eventTypes().contains(event.getType())) {
            continue;
        }
        if (!Severity.atLeast(event.getSeverity(), rule.minSeverity())) {
            continue;
        }
        if (isDuplicate(tenantId, rule, event)) {
            continue;
        }
        persist(tenantId, rule, event);
        deliverer.deliver(event, rule.webhookUrl(), rule.webhookToken());
    }
}
```

Der ganze Weg von Event zu Meldung in einer Schleife. Drei Filter je Regel,
Ereignistyp, Mindestschwere und Cooldown, danach Speichern und Zustellen.
Ein Mandant ohne eigene Regel bekommt eine implizite Regel aus der
Konfiguration, damit niemand still leer ausgeht. Die Meldung wird immer
gespeichert, der Webhook ist nur der zusätzliche Kanal. Mehrere Regeln
desselben Mandanten können aus einem Event mehrere Meldungen machen, das
ist gewollt, weil jede Regel ihren eigenen Cooldown und ihren eigenen
Webhook hat.

## 2. Mandantenauflösung `TenantResolver.resolveTenant`

[auth/TenantResolver.java#L30-L76](../../../applications/notification-service/src/main/java/com/heatingplatform/notification/auth/TenantResolver.java#L30-L76)

```java
public UUID resolveTenant(UUID requestedTenantId) {
    String subject = currentSubject();
    UserRow user = jdbc.sql("SELECT id, global_role FROM users WHERE subject = :subject")
            .param("subject", subject)
            .query(/* id, globalRole */)
            .optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.FORBIDDEN, "Unknown user"));

    boolean systemAdmin = "SYSTEM_ADMIN".equalsIgnoreCase(user.globalRole());
    if (systemAdmin) {
        if (requestedTenantId != null) {
            return requestedTenantId;
        }
        return jdbc.sql("SELECT id FROM tenants ORDER BY created_at LIMIT 1").query(UUID.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No tenants exist"));
    }

    List<UUID> accessible = jdbc.sql("SELECT tenant_id FROM user_tenant_roles WHERE user_id = :userId ORDER BY created_at")
            .param("userId", user.id())
            .query(UUID.class)
            .list();
    if (accessible.isEmpty()) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No tenant access");
    }
    if (requestedTenantId == null) {
        return accessible.get(0);
    }
    if (!accessible.contains(requestedTenantId)) {
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No access to tenant");
    }
    return requestedTenantId;
}
```

Jeder REST-Aufruf läuft durch diese Funktion, bevor eine Abfrage die
Tabellen berührt. Der Mandant kommt nie aus dem Request allein, sondern aus
dem Subjekt im Token und den Mitgliedschaften in den Stammdaten. Ein
`system_admin` darf jeden Mandanten wählen, alle anderen nur einen, zu dem
sie gehören, und `?tenantId=` ist für sie eine Auswahl, keine Behauptung.
Ein Subjekt ohne Nutzer oder ohne Mitgliedschaft bekommt 403. Die Regeln
sind dieselben wie in core, aber als Kopie und nicht als gemeinsame
Bibliothek, der Zusammenhalt kommt aus dem Token-Vertrag.
