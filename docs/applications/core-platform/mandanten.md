# Mandanten und Sicherheit

Das Paket `tenancy` beantwortet an einer Stelle, welchen Mandanten eine
Anfrage adressiert und ob der Aufrufer ihn sehen darf. Das Paket `audit`
protokolliert jeden Versuch über die Mandantengrenze hinweg. Beide zusammen
sind das, was die Evaluation unter QS-SEC-01 misst.

## Identität

- **Login** mit E-Mail und Passwort (BCrypt) gegen `POST /api/v1/auth/login`.
  Die Antwort enthält ein selbst signiertes HS256-JWT mit `sub`, `email`,
  `name` und einer Gültigkeit von 24 Stunden.
- **Prüfung** übernimmt Spring Security als OAuth2 Resource Server mit
  demselben Schlüssel, zustandslos, ohne externen Identity Provider.
- **Service-Token** für n8n. Ein statisches Bearer-Token wird vor der
  JWT-Prüfung erkannt und in einen synthetischen Principal übersetzt, der wie
  ein normaler Nutzer aufgelöst wird.

## Rollen

| Ebene                            | Rollen                                                                        | Wirkung                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Global (`users.global_role`)     | `system_admin`, `consultant`, `landlord`, `technician`, `resident`, `viewer`  | `system_admin` sieht alles, `consultant` darf Mandanten und Einladungen verwalten         |
| Mandant (`user_tenant_roles`)    | `owner` > `manager` > `member` > `viewer`                                     | Mitgliedschaft und Stufe je Mandant                                                       |
| Standort (`site_assignments`)    | Zuordnung Nutzer zu Standort                                                  | Ein Techniker behält Zugriff auf einzelne Standorte fremder Mandanten                     |

Die Mitgliedschaft eines Aufrufers wird als `Membership` gecacht. Ein
`system_admin` ist `unlimited`, ein unbekanntes Subjekt gehört nirgends hin
und sieht nichts. Beide Fälle unterscheiden sich im Code durch ein Boolean
und nicht durch eine leere Liste, damit niemand versehentlich offen ausfällt.

## Zentrale Autorisierung

Der `TenantScopeInterceptor` läuft für jeden Handler unter `/api/v1/**`,
ausgenommen `/auth/**` und `/invitations/by-token/**`. Ein Handler kann sich
mit `@TenantUnscoped` ausnehmen, eine Begründung ist dabei Pflicht. Der Test
`TenantScopeCoverageTest` lässt den Build scheitern, wenn ein Handler weder
auflösbar noch ausgenommen ist.

1. Aus der URL werden die adressierten Ressourcen gelesen. Entscheidend ist
   das literale Segment vor der Pfadvariable, nicht deren Name.
   `/projects/{id}` ist ein Projekt, `/metric-points/{id}` ein Objekt. Auch
   `?tenantId=` zählt.
2. Jede Ressource wird per SQL auf ihren Mandanten aufgelöst (`ResourceKind`)
   und gecacht. Das Ergebnis ist `RESOLVED`, `GLOBAL` (mandantenlose
   Referenzdaten) oder `UNKNOWN` (keine Zeile).
3. Der `TenantAccessEvaluator` entscheidet je Ressource nach dieser Tabelle.

| Mitgliedschaft | Auflösung | Methode    | Entscheidung                           |
| -------------- | --------- | ---------- | -------------------------------------- |
| unlimited      | beliebig  | beliebig   | ALLOW                                  |
| Mitglied       | RESOLVED  | beliebig   | ALLOW                                  |
| kein Mitglied  | RESOLVED  | beliebig   | DENY, außer per Standort zugewiesen    |
| beliebig       | GLOBAL    | lesend     | ALLOW                                  |
| beliebig       | GLOBAL    | schreibend | DENY, außer unlimited                  |
| beliebig       | UNKNOWN   | beliebig   | ALLOW, der Handler antwortet 404       |

Ein `DENY` wird nach `TENANT_ENFORCEMENT_MODE` behandelt. `ENFORCE` schreibt
403 direkt in die Antwort, `OBSERVE` loggt nur und lässt durch, `OFF`
überspringt den Interceptor ganz. Der Modus wird je Anfrage gelesen.

Was der Interceptor nicht sieht, sind IDs im Request-Body. Dafür rufen die
Controller den `TenantBodyGuard`, der bei fremden IDs eine
`CrossTenantAccessException` wirft. Der globale Handler beantwortet sie als
403 mit derselben Meldung. gRPC und Kafka sind nicht mandantengeprüft und
gelten als intern vertrauenswürdig.

## Zugriffs-Audit

Der `AccessAuditFilter` sitzt in der Security-Kette nach der
Authentifizierung. Er liest das Subjekt vor der Verarbeitung und den
adressierten Mandanten danach, weil der Interceptor dazwischen läuft. In
`access_audit` landet ein Eintrag je Versuch mit einem von drei Ergebnissen.

| Ergebnis          | Wann                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED` | Status 401                                                                                                  |
| `DENIED`          | Status 403                                                                                                  |
| `FILTERED`        | Status 2xx, obwohl der genannte Mandant nicht zu den eigenen gehört. Der Endpunkt hat gefiltert statt abgelehnt |

Verkehr im eigenen Mandanten wird nicht protokolliert. Die Aufzeichnung kann
eine Anfrage nie scheitern lassen, Fehler werden geloggt und geschluckt. Mit
`audit.access.enabled=false` lässt sich derselbe Build ohne Audit messen.

## Datenschutz

Der `PrivacyController` bedient Auskunft (Art. 15) und Löschung (Art. 17) für
Bewohner (`PERSON`-Objekte im Graph) und Plattformnutzer. Für den Export liest
das Paket als einziges in core aus dem Messwertspeicher, über eine eigene,
nur lesende Datenquelle. Die Löschung fasst Messwerte nie an, sie trennt die
Verknüpfung der Person, womit die Reihen anonym werden.
