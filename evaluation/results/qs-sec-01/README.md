# QS-SEC-01, mandantenübergreifender Zugriffsversuch

| Stimulus | Response Measure |
|---|---|
| Ein authentifizierter Nutzer von Mandant A fordert Ressourcen von Mandant B an, mindestens 100 Versuche über alle REST-Endpunkte, dazu 50 Requests/s Grundlast | 0 mandantenfremde Datensätze in den Antworten, je Versuch genau 1 Audit-Eintrag |

Zwei Eigenschaften machen den Lauf aussagekräftig.

Der Angreifer meldet sich als **mandantengebundener Nutzer** mit der Rolle
Viewer an, nie als Systemadministrator. Ein Administrator beendet die
Mandantenprüfung in ihrer ersten Zeile, ein Lauf unter seinem Konto würde die
Durchsetzung als kostenlos ausweisen. Das Lastskript verweigert deshalb den
Start unter `admin@local`.

Der Angriff läuft ausschließlich über das **Proxy der Weboberfläche**, die
einzige nach außen erreichbare Fläche. Kein Backend-Dienst wird direkt
adressiert.

Die fremden Kennungen werden nicht ausgelesen, sondern hergeleitet. Der
mock-service bildet jede Kennung deterministisch als uuid5 über
`<präfix>:<art>:...`, also folgt die gesamte Angriffsfläche des zweiten
Mandanten aus seinem Präfix und seiner Flottenform. Das ist der realistische
Fall einer erratenen oder abgeschriebenen Kennung.

## Zwei Familien von Kennungen

Der Prototyp wehrt sie an verschiedenen Stellen ab, weshalb der Katalog beide
getrennt prüft.

- **Kennungen in der URL** löst ein zentraler Interceptor auf, der jede
  Pfadvariable ihrem Mandanten zuordnet.
- **Kennungen im Anfragekörper** sieht der Interceptor nicht, und der
  Audit-Filter ebenso wenig, weil er dafür jede Anfrage puffern müsste.
  Zwischen ihnen und einem mandantenübergreifenden Zugriff steht allein der
  `TenantBodyGuard`. Diese Versuche sind sein Regressionstest. Sie setzen auf
  einem Anker des Angreifers auf und tragen nur die fremde Kennung im Körper,
  etwa eine fremde `siteId` in ein eigenes Projekt oder einen fremden Messpunkt
  als Formelvariable. Ein angenommener Schreibversuch zählt als Leck, auch wenn
  die Antwort die Kennung nicht zurückgibt.

Der Katalog ist nach den OWASP API Security Top 10 in der Fassung von 2023
geordnet und deckt API1, API2, API3, API5 und API9 ab. Die übrigen fünf
Kategorien bleiben mit Begründung außen vor, siehe Abschnitt 10 von
[evaluation/README.md](../../README.md).

## Ergebnis vom 03.09.2026, bestanden

Zehn Minuten, 25 Nutzer mit je zwei Anfragen pro Sekunde, Schreibversuche
eingeschaltet. Die Angriffe erzeugen die geforderte Grundlast von 50 Requests
pro Sekunde selbst, ein zweiter Generator ist nicht nötig.

| Kenngröße | Zielwert | Gemessen |
|---|---|---|
| Versuche | mindestens 100 | 122.787 in 54 Mustern |
| fremde Datensätze in Antworten | 0 | 0 |
| angenommene Schreibversuche | 0 | 0 |
| erreichbare Angriffsfläche | 0 | 0 |
| Fehler der Sonde | 0 | 0 |
| Audit-Einträge | 1 je Versuch mit Mandantenbezug | 107.401, davon 100.518 mit adressiertem Mandanten |

Die Ausgänge verteilen sich auf 115.131 abgewiesene, 4.914 eingeengte und
2.742 mit 404 beantwortete Versuche. Die 14 Muster der Körper-Familie mit je rund 850 Versuchen wurden
vollständig abgewiesen. Im Log des Core lassen sich die Abweisungen der
abweisenden Stelle zuordnen, nach zwei Minuten standen dort 8.545 Abweisungen
des Interceptors und 1.412 des Guards. Der Analytics-Dienst schrieb seine
16.091 Abweisungen selbst in dieselbe Tabelle, ein schreibender Zugriff allein
zu Messzwecken, damit auch die Statistik-Routen einen Eintrag je Versuch
liefern.

### Die 15.386 Versuche ohne Audit-Eintrag

Sie zerfallen in drei erklärbare Gruppen und sind kein Verstoß gegen den
zweiten Response Measure, der sich auf Versuche mit benennbarem
Mandantenbezug bezieht.

| Gruppe | Anzahl | Grund |
|---|---|---|
| beschädigtes oder falsch signiertes Token | 6.812 | der Authentifizierungsfilter weist ab, bevor der Audit-Filter läuft |
| Lesezugriffe auf Sammel-Endpunkte | 4.900 | benennen keinen Mandanten, sie engen ihre Abfrage nur ein |
| Inventarsonden | rund 3.650 | erreichten keinen Dienst, Analytics antwortet mit 404 und das Proxy weist die Traversal-Anfrage mit 400 ab |

Die erste Gruppe ist eine echte Lücke des Audit-Trails, weil ein
systematisches Ausprobieren von Signaturen dort nicht sichtbar wird. Sie liegt
außerhalb des Stimulus, der einen authentifizierten Nutzer voraussetzt, gehört
aber in die Grenzen des Kapitels. Anfragen ganz ohne Token werden dagegen
erfasst, sie erscheinen als 1.704 Einträge mit dem Ausgang UNAUTHENTICATED.

## Dateien

| Datei | Inhalt |
|---|---|
| `qs-sec-01-20260903-125158.txt` | **der berichtete Lauf**, mit Fenster, Angreifer, Ziel, Abdeckungskarte je OWASP-Muster, Fehlschlägen und Audit-Abdeckung |
| `qs-sec-01-20260903-125158-stats.csv` | Kennzahlen je Angriffsmuster, die Spalte Failures ist die Leckzahl |
| `qs-sec-01-20260903-125158-failures.csv` | leer bis auf die Kopfzeile, also kein Fehlschlag |
| `qs-sec-01-20260903-125158-stats_history.csv` | sekundenweiser Verlauf |

Dazu drei Protokolle der lokalen Sonde vom 11.08.2026, die den Nutzen der
Durchsetzung überhaupt erst gezeigt haben. Jedes enthält dieselben 106
Versuche, direkt gegen Core und Analytics statt über das Proxy.

| Datei | Modus | Ausgang |
|---|---|---|
| `qs-sec-01-2-observe.csv` | Durchsetzung aus, nur beobachtend | 43 Lecks, 47 eingeengt, 16 abgewiesen |
| `qs-sec-01-3-enforce.csv` | Durchsetzung an | 0 Lecks, 100 abgewiesen, 6 eingeengt |
| `qs-sec-01-4-selfcheck.csv` | Gegenprobe gegen eigene Ressourcen | 65 eigene Datensätze geliefert, 6 abgewiesen |

Die Gegenprobe ist unverzichtbar. Ohne sie wäre eine Leckzahl von null auch
das Ergebnis eines Mechanismus, der schlicht alles ablehnt. Die sechs
Abweisungen dort sind Rollenprüfungen für einen Viewer und keine
Mandantenfehler.

## Reproduktion

```bash
# Vorbedingung: eval-up.sh hat beide Mandanten, die Probe-Nutzer und die
# internen Endpunkte inklusive frontend-internal angelegt
infrastructure/scripts/eval-up.sh

evaluation/scripts/security-scenario.sh                    # zehn Minuten, ohne Schreibversuche
INCLUDE_WRITES=true evaluation/scripts/security-scenario.sh # der berichtete Lauf
evaluation/scripts/security-scenario.sh 3m                 # kürzer
```

Die Schreibversuche sind auf den synthetischen Fixtures von `tenantb`
destruktiv und deshalb voreingestellt aus. Nach einem Lauf mit
`INCLUDE_WRITES=true` den zweiten Mandanten neu seeden.

```bash
kubectl delete -f infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml --ignore-not-found
kubectl apply  -f infrastructure/kubernetes/jobs/mock-seed-tenantb.yaml
```

### Schneller Regressionstest ohne Cluster

Die ältere Sonde läuft direkt gegen Core und Analytics und deckt dieselbe
Körper-Familie ab. Das Dev-Profil des Core schaltet die Mandantendurchsetzung
allerdings aus, sie muss deshalb erzwungen werden, sonst misst der Lauf das
Dev-Profil.

```bash
scripts/dev.sh up          # Core mit TENANT_ENFORCEMENT_MODE=ENFORCE starten
applications/mock-service/.venv/bin/mock-service seed --prefix tenanta --sites 1 --rooms 2 --persons 1
applications/mock-service/.venv/bin/mock-service seed --prefix tenantb --sites 1 --rooms 2 --persons 1

evaluation/scripts/.venv/bin/python evaluation/scripts/tenant_isolation_probe.py \
  --csv evaluation/results/qs-sec-01/qs-sec-01-lokal-$(date +%Y%m%d-%H%M%S).csv \
  --dsn postgresql://postgres:password@localhost:5432/digital_demon

evaluation/scripts/.venv/bin/python evaluation/scripts/tenant_isolation_probe.py --self-check
```

## Grenzen

Der Angreifer ist ein Viewer, Rollen innerhalb eines Mandanten sind nicht
Gegenstand des Szenarios. Die Herleitung der Kennungen setzt Kenntnis des
Namensschemas voraus, ein Angreifer ohne dieses Wissen hätte weniger
Angriffsfläche und nicht mehr. Der Nachweis gilt für die geprüfte Menge von
54 Mustern und zeigt die Abwesenheit eines Fehlverhaltens für diese Menge,
nicht dessen generelle Unmöglichkeit.
