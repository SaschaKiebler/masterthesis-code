# Mandanten

Das Frontend setzt keine Mandantengrenzen durch. Das tun core, analytics und
notification, jeder Dienst prüft das Token und die adressierten Ressourcen
selbst. Das Frontend sorgt dafür, dass das Token bei jeder Anfrage ankommt,
und richtet die Oberfläche nach Rolle und aktivem Mandanten aus.

## Anmeldung

1. Die Login-Seite schickt E-Mail und Passwort an `POST /api/auth/login`.
2. Der Server-Teil holt das JWT bei core und legt es in das `httpOnly`-Cookie
   `dd_session`.
3. Beim Laden der Anwendung ruft der `AuthContextProvider` `GET /api/v1/me`
   über den Proxy. Die Antwort enthält das Profil mit globaler Rolle und die
   Liste der Mandanten mit der jeweiligen Rolle. Ein 401 bedeutet nur „nicht
   angemeldet“.

## Rollen und Rechte

Die Rollen sind dieselben wie in core. Aus globaler Rolle und Rolle im
aktiven Mandanten leitet `resolvePermissions` eine Menge von Rechten ab, die
Komponenten mit `can("...")` abfragen, um Knöpfe, Menüs und Seiten ein- oder
auszublenden.

| Rolle                                   | Beispiele für Rechte im Client                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| jeder Angemeldete                       | `site:view`, `asset:view`, `measurement:view`, `template:view`                            |
| `owner`, `manager` im Mandanten         | dazu `contact:manage`, `report:view`                                                      |
| `manager` im Mandanten                  | dazu `site:create`, `asset:configure`, `report:generate`, `team:manage`                   |
| `consultant`, `system_admin` (global)   | alles oben, dazu `tenant:create`, `tenant:manage`, `fleet:view`, `invitation:manage`      |
| `system_admin`                          | zusätzlich `user:manage`, `template:manage`                                               |

Ein Nutzer ohne Mandanten und ohne globale Sonderrolle gilt als
`hasNoAccess`, die Oberfläche zeigt dann den Hinweis auf eine fehlende
Einladung.

## Aktiver Mandant

Berater und Administratoren gehören zu mehreren Mandanten. Der
`TenantSwitcher` in der Navigation lässt sie einen Mandanten wählen oder in
die Flottenansicht über alle wechseln. Die Wahl liegt im `AuthContext` und
wird in `localStorage` unter `dd_active_tenant` gemerkt. Hat ein Nutzer
genau einen Mandanten, ist der automatisch aktiv.

Der aktive Mandant wirkt im Client an drei Stellen.

- **Rechte.** Die Rolle im aktiven Mandanten fließt in `resolvePermissions`.
- **Listen.** Standorte und Analysevorlagen werden mit `?tenantId=`
  abgefragt, sonst liefert core alles, worauf der Nutzer Zugriff hat.
- **Anlegen.** Neue Projekte, Standorte und Vorlagen bekommen den aktiven
  Mandanten als `tenantId` in den Body.

Der Mandant wird nie als Header oder Cookie übertragen. Er steht in URL oder
Body, wo core ihn über den Interceptor und den Body-Guard prüft.

## Was das Frontend nicht prüft

- Ob der Nutzer eine Ressource sehen darf. Das entscheidet der Dienst, das
  Frontend zeigt bei 403 einen Fehler.
- Ob das Token gültig ist. Der Proxy hängt es nur an. Ein abgelaufenes Token
  führt zu 401, der Client leitet dann zur Anmeldung.
- Die Rechteliste im Client steuert nur die Anzeige. Wer eine Aktion direkt
  gegen `/api/v1` aufruft, wird vom Dienst geprüft.
