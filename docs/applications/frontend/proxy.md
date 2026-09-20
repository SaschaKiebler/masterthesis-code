# Proxy

Der Server-Teil des Frontends ist der einzige Weg vom Browser zu den
Diensten. Drei Catch-all-Routen leiten weiter, sechs zusammengesetzte Routen
kombinieren zwei Dienste zu einer Antwort.

## Die drei Weiterleitungen

| Browser ruft            | Ziel                                   | Methoden                        | Datei                                       |
| ----------------------- | -------------------------------------- | ------------------------------- | ------------------------------------------- |
| `/api/v1/*`             | `BACKEND_URL/api/v1/*` (core)          | GET, POST, PUT, PATCH, DELETE   | `app/api/v1/[...path]/route.ts`             |
| `/api/analytics/*`      | `ANALYTICS_URL/*`                      | GET, POST                       | `app/api/analytics/[...path]/route.ts`      |
| `/api/notifications/*`  | `NOTIFICATION_URL/api/v1/*`            | GET, POST, PATCH, DELETE        | `app/api/notifications/[...path]/route.ts`  |

Alle drei tun dasselbe.

1. Die Pfadsegmente werden geprüft und neu kodiert, siehe unten.
2. Aus dem Cookie `dd_session` wird das JWT gelesen und als
   `Authorization: Bearer` gesetzt. Ein bereits vorhandener
   `Authorization`-Header hat Vorrang, so können Skripte den Proxy auch mit
   eigenem Token nutzen.
3. Nur `Content-Type` und `Accept` werden weitergegeben, Cookies bleiben am
   Proxy. Der Query-String geht mit.
4. Die Antwort des Dienstes wird mit Status und Body unverändert
   durchgereicht. Ist der Dienst nicht erreichbar, antwortet der Proxy mit
   502.

Der Browser-Client in `lib/api/client.ts` spricht `/api/v1` an und leitet
bei 401 auf die Login-Seite um. `lib/api/analytics-client.ts` spricht
`/api/analytics` an.

## Sitzung

Der Login läuft nicht über den Catch-all, sondern über eine eigene Route
`POST /api/auth/login`. Sie reicht E-Mail und Passwort an core weiter, nimmt
das JWT aus der Antwort und legt es in ein Cookie.

| Eigenschaft   | Wert                                                          |
| ------------- | ------------------------------------------------------------- |
| Name          | `dd_session`                                                  |
| `httpOnly`    | ja, JavaScript im Browser sieht das Token nie                 |
| `sameSite`    | `lax`                                                         |
| `secure`      | in Produktion, außer `COOKIE_SECURE=false`                    |
| Lebensdauer   | 24 Stunden, passend zur Token-Gültigkeit in core              |

Die Antwort an den Browser enthält nur das Nutzerprofil, nicht das Token.
`GET /auth/logout` löscht das Cookie und leitet zur Login-Seite.

Die Next.js-Middleware in `proxy.ts` leitet Seitenaufrufe ohne Cookie auf
`/auth/login` um und merkt sich das Ziel in `returnTo`. API-Routen lässt sie
durch, dort antwortet der Dienst selbst mit 401. Öffentlich bleiben
`/auth/*` und `/invite/accept`.

## Pfadhärtung

Next.js zerlegt einen Catch-all an den Schrägstrichen und dekodiert danach
jedes Segment. Ein Segment kann also weiterhin `/` (aus `%2F`) oder `..`
enthalten, und `fetch` würde die Punkte auflösen. Ein Aufruf von
`/api/v1/..%2F..%2Factuator` hätte so `/actuator` in core erreicht, das
außerhalb der authentifizierten Pfade liegt. Gefunden bei der Prüfung zu
QS-SEC-01.

`joinProxyPath` lehnt deshalb leere Segmente, `.`, `..` und Segmente mit
Schrägstrich ab (Antwort 400) und kodiert jedes Segment erneut, damit es
auch beim Dienst genau ein Segment bleibt.

## Zusammengesetzte Routen

Core kennt die Struktur, analytics kennt die Messwerte. Sechs Routen unter
`app/api/v1/` sind spezifischer als der Catch-all und liegen deshalb vor
ihm. Sie holen bei core die Kanäle (`device_id`, `metric_id`) eines
Standorts, Assets oder Projekts, fragen damit bei analytics die Reihen ab
und formen das Ergebnis in die Antwort, die die Komponenten schon vor der
Trennung der Speicher erwartet haben.

| Route                                              | core                                       | analytics                                              |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `GET /api/v1/sites/{id}/measurements`              | `/sites/{id}/channels`                     | `/stats/series`                                        |
| `GET /api/v1/sites/{id}/measurements/statistics`   | `/sites/{id}/channels`                     | `/stats/descriptive-by-channel`                        |
| `GET /api/v1/assets/{id}/measurements`             | `/assets/{id}/channels`                    | `/stats/series`                                        |
| `GET /api/v1/assets/{id}/measurements/latest`      | `/assets/{id}/channels`                    | `/stats/latest-by-channel`                             |
| `GET /api/v1/projects/{id}/measurements`           | `/projects/{id}/channels`                  | `/stats/series`                                        |
| `GET /api/v1/projects/{id}/compare`                | `/projects/{id}/quantity-channels`         | `/stats/series`, Mittelwert je Standort im Frontend    |

Die Messpunkt-ID wandert dabei als `ref` mit zu analytics und kommt
unverändert zurück, so lassen sich Reihen wieder den Messpunkten zuordnen.
`bucketMinutes=0` bedeutet Rohdaten, ein Wert größer null eine feste
Bucket-Breite, kein Wert die automatische Wahl von analytics.

Ein 4xx eines Dienstes wird unverändert an den Browser gegeben, damit eine
Ablehnung wegen fremdem Mandanten als 403 ankommt und nicht als vermeintlicher
Ausfall. Nur 5xx und Verbindungsfehler werden zu 502.
