# frontend

Die Web-Oberfläche der Plattform, eine Next.js-Anwendung mit App Router.
Der Browser spricht nie direkt mit den Backend-Diensten. Jede Anfrage geht
an den eigenen Server-Teil des Frontends, der als Backend-for-Frontend (BFF)
die Sitzung hält, das Token anhängt und an core, analytics oder notification
weiterleitet. TypeScript, Next.js 16, React 19, Tailwind, SWR.

Diese Doku beschränkt sich bewusst auf zwei Dinge, den Proxy und die
Mandantenfähigkeit. Seiten, Komponenten und Charts sind hier nicht
beschrieben.

| Seite                                        | Inhalt                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Proxy](proxy.md)                            | Wie Anfragen aus dem Browser zu den Diensten kommen, Sitzung, Pfadhärtung, zusammengesetzte Routen  |
| [Mandanten](mandanten.md)                    | Anmeldung, Rollen und Rechte im Client, aktiver Mandant, was das Frontend prüft und was nicht       |
| [Kernfunktionen im Code](kernfunktionen.md)  | Die fünf wichtigsten Funktionen mit Auszug und Link in die Quelle                                   |

## Weg einer Anfrage

1. Ein Aufruf im Browser geht an `/api/v1/...`, `/api/analytics/...` oder
   `/api/notifications/...` auf demselben Host wie die Seite. Der Browser
   schickt das Session-Cookie automatisch mit.
2. Eine Route im Server-Teil des Frontends nimmt den Aufruf an, liest das JWT
   aus dem Cookie und setzt es als `Authorization: Bearer`.
3. Die Route ruft den zuständigen Dienst über seine interne Adresse auf und
   gibt Status und Body unverändert zurück.

Der Browser sieht das Token nie, die Dienste sehen das Cookie nie.

## Konfiguration

| Variable           | Standard                  | Bedeutung                                                                                                 |
| ------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `BACKEND_URL`      | `http://localhost:8080`   | core-platform, auch für den Login                                                                         |
| `ANALYTICS_URL`    | `http://localhost:8100`   | analytics-service                                                                                         |
| `NOTIFICATION_URL` | `http://localhost:8083`   | notification-service                                                                                      |
| `COOKIE_SECURE`    | `true` in Produktion      | `false` erlaubt das Session-Cookie über reines HTTP, nötig für den LoadBalancer der Evaluation ohne TLS   |

Alle vier gelten nur serverseitig. Ins Bundle für den Browser gelangt keine
Adresse.

## Betrieb in Kürze

```bash
cd applications/frontend
npm install
npm run dev                      # http://localhost:3000
npm run build && npm run start
```

`scripts/dev.sh up` installiert die Abhängigkeiten beim ersten Lauf und
startet den Dev-Server unter dem Namen `frontend`. Das Image wird vom
Repo-Root aus gebaut, dreistufig auf `node:22-alpine` mit `standalone`-Ausgabe,
der Prozess läuft als unprivilegierter Nutzer auf Port 3000. Im Cluster ist
der `frontend`-Service der einzige öffentliche Einstiegspunkt (LoadBalancer
auf Port 80), mit `BACKEND_URL`, `ANALYTICS_URL` und `COOKIE_SECURE=false`.

`NOTIFICATION_URL` ist im Cluster-Manifest nicht gesetzt. Der
Notifications-Proxy zeigt dort auf `localhost:8083` und damit ins Leere.
