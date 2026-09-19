# REST-API

Alle Endpunkte liegen unter `/api/v1`. Antworten sind JSON. Fehler haben die
Form `{"error": "..."}` mit 400 bei Validierung, 401 ohne Anmeldung und 404
bei unbekannter Ressource. Ein Zugriff auf die Ressource eines fremden
Mandanten antwortet mit 403 und
`{"message": "Access denied to another tenant's resource"}`.

## Anmeldung

```bash
curl -s http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local","password":"admin"}'
# {"token":"<jwt>","user":{...}}

curl -s http://localhost:8080/api/v1/me -H "Authorization: Bearer <jwt>"
```

Ohne Token erreichbar sind `/api/v1/auth/**`, `/api/v1/invitations/by-token/**`
und `/actuator/**`. Alles andere braucht das Bearer-Token. Ein statisches
Service-Token für n8n ist als Alternative konfigurierbar, siehe
[Konfiguration](konfiguration.md).

## Endpunktfamilien

| Bereich                 | Pfade                                                                                                                                                                                                                                                       | Controller                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Identität               | `/auth/login`, `/me`, `/users`, `/tenants`, `/tenants/{id}/members`, `/invitations`                                                                                                                                                                        | `LocalAuthController`, `AuthController`, `UserController`, `TenantController`, `InvitationController`                                       |
| Objektmodell            | `/object-types`, `/device-templates`, `/link-types`, `/objects`, `/objects/{id}/links`, `/links`, `/sites/{id}/objects`, `/sites/{id}/graph`                                                                                                              | `RegistryController`, `GraphController`                                                                                                     |
| Standorte und Räume     | `/sites`, `/sites/{id}/channels`, `/assets/{id}`, `/sites/{id}/spaces`                                                                                                                                                                                     | `RestGateway` (über gRPC), `SpaceController`                                                                                                |
| Geräte                  | `/objects/{id}/device`, `/device-discovery`, `/discovered-devices`                                                                                                                                                                                         | `GraphController`, `DeviceDiscoveryController` (Proxy), `DiscoveredDeviceController`                                                        |
| Messpunkte und Regeln   | `/objects/{id}/metrics`, `/metric-points/{id}`, `/metric-points/{id}/rules`, `/threshold-rules/{id}`, `/anomaly-rules`, `/anomaly-rule-templates`, `/channels`, `/physical-quantities`                                                                     | `MetricPointController`, `ThresholdRuleController`, `AnomalyRuleController`, `PhysicalQuantityController`                                   |
| Projekte und Auswertung | `/projects`, `/projects/{id}/…` (sites, settings, graph, metric-points, channels, events, health, latest-values), `/dashboards`, `/dashboard-templates`, `/analysis-views`, `/analysis-templates`, `/objects/{id}/kpi-formulas`, `/kpi-formulas/{id}`, `/derived-properties` | `ProjectController`, `DashboardController`, `DashboardTemplateController`, `AnalysisController`, `KpiFormulaController`, `DerivedPropertyController` |
| Ereignisse              | `/objects/{id}/events`, `/events`, `/events/{id}/resolve`, `/event-templates`                                                                                                                                                                              | `EventController`, `EventTemplateController`                                                                                                |
| KI über n8n             | `/analysis-ai/analyze`, `/projects/{id}/dashboard-ai/converse`, `/objects/{id}/kpi-formulas/generate`, `/object-types/{id}/generate-svg`, `/templates/generate`                                                                                            | `AnalysisAiController`, `DashboardAiController`, `KpiFormulaController`, `RegistryController`                                               |
| Datenschutz             | `/privacy/persons/{id}/export`, `/privacy/persons/{id}`, `/privacy/users/{id}/export`, `/privacy/users/{id}`                                                                                                                                               | `PrivacyController`                                                                                                                         |
| Flotte                  | `/fleet/status`                                                                                                                                                                                                                                            | `FleetController`                                                                                                                           |

Die vollständige Liste der Methoden steht in den Klassenkommentaren der
Controller unter `src/main/java/com/digitaldemon/core/`.

## Was die API nicht liefert

- **Zeitreihen und Statistiken.** Core löst Messpunkte nur bis zum Kanal auf,
  also bis zum Paar aus `device_id` und `metric_id` (`ChannelResolver`).
  Reihen holt das Frontend beim analytics-service.
- **Aktuelle Werte nur aus dem Speicher.** `/projects/{id}/latest-values` und
  die Gesundheitsangaben in `/fleet/status` und `/projects/{id}/health`
  stammen aus der In-Memory-Projektion des `measurement.ingested`-Stroms.
  Nach einem Neustart sind sie leer, bis wieder Telemetrie eintrifft.

## gRPC

Auf Port 9090 laufen `SiteService` und `AssetService` aus
`apis/proto/core/v1/`. Einziger Aufrufer ist das eigene `RestGateway`, das
über eine Loopback-Verbindung darauf zugreift. Kein anderer Service und nicht
das Frontend nutzen gRPC.
