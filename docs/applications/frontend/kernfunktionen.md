# Kernfunktionen im Code

Fünf Stellen tragen den Proxy und die Mandantenlogik. Die Auszüge sind
gekürzt, die Zeilenangaben führen zur vollständigen Fassung. Alle Pfade
liegen unter `applications/frontend/`.

## 1. Pfadhärtung `joinProxyPath`

[lib/api/proxy-path.ts#L15-L28](../../../applications/frontend/lib/api/proxy-path.ts#L15-L28)

```ts
export function joinProxyPath(segments: string[]): string | null {
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\")
    ) {
      return null;
    }
  }
  return segments.map(encodeURIComponent).join("/");
}
```

Next.js zerlegt einen Catch-all-Pfad an den Schrägstrichen und dekodiert
jedes Segment erst danach. Ein Segment kann deshalb `..` oder einen
kodierten Schrägstrich enthalten, und `fetch` löst Punktsegmente auf. So
hätte `/api/v1/..%2F..%2Factuator` den Proxy verlassen und `/actuator` in
core erreicht, das außerhalb der authentifizierten Pfade liegt. Die Funktion
lehnt solche Segmente ab, jeder Proxy antwortet dann mit 400, und kodiert
die übrigen erneut, damit sie auch beim Dienst genau ein Segment bleiben.
Gefunden bei der Prüfung zu QS-SEC-01.

## 2. Weiterleitung `proxyRequest`

[app/api/v1/[...path]/route.ts#L12-L57](../../../applications/frontend/app/api/v1/[...path]/route.ts#L12-L57)

```ts
async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathStr = joinProxyPath(path);
  if (pathStr === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const url = new URL(req.url);
  const target = `${BACKEND_URL}/api/v1/${pathStr}${url.search}`;

  const headers = new Headers();
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const authorization = req.headers.get("authorization");
  if (authorization) {
    headers.set("authorization", authorization);
  } else if (sessionToken) {
    headers.set("authorization", `Bearer ${sessionToken}`);
  }
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", req.headers.get("accept") || "application/json");

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? await req.blob() : undefined,
  });
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}
```

Der ganze Proxy in einer Funktion, die dreimal fast gleich existiert, für
core, analytics und notification. Das Cookie wird in einen Bearer-Header
übersetzt und bleibt am Proxy, ein mitgeschickter `Authorization`-Header hat
Vorrang. Nur `Content-Type` und `Accept` gehen mit, sonst nichts aus dem
Browser. Antwortstatus und Body kommen unverändert zurück, deshalb sieht ein
Client eine Mandantenablehnung von core als 403 und nicht als Fehler des
Frontends. Nur wenn der Dienst gar nicht erreichbar ist, entsteht ein 502.

## 3. Anmeldung `POST /api/auth/login`

[app/api/auth/login/route.ts#L11-L50](../../../applications/frontend/app/api/auth/login/route.ts#L11-L50)

```ts
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const backendResponse = await fetch(`${BACKEND_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  const data = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(data, { status: backendResponse.status });
  }

  const response = NextResponse.json({ user: data.user });
  response.cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE != null
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
```

Die einzige Stelle, an der das Token den Server-Teil verlässt, und sie legt
es in ein `httpOnly`-Cookie statt in den Body. JavaScript im Browser kann es
damit nicht lesen, die Antwort enthält nur das Profil. Die Lebensdauer von
24 Stunden entspricht der Token-Gültigkeit in core. `COOKIE_SECURE=false`
existiert nur für den LoadBalancer der Evaluation ohne TLS, sonst würde der
Browser ein sicheres Cookie über HTTP verwerfen und niemand käme über die
Login-Seite hinaus.

## 4. Fehler durchreichen `downstreamError`

[app/api/v1/_compose/helpers.ts#L131-L144](../../../applications/frontend/app/api/v1/_compose/helpers.ts#L131-L144)

```ts
export async function downstreamError(response: Response, which: string): Promise<NextResponse> {
  if (response.status >= 400 && response.status < 500) {
    const body = await response.text();
    try {
      return NextResponse.json(JSON.parse(body), { status: response.status });
    } catch {
      return NextResponse.json({ error: body || which }, { status: response.status });
    }
  }
  return serviceUnavailable(which);
}
```

Die zusammengesetzten Routen rufen zwei Dienste nacheinander, erst core für
die Kanäle, dann analytics für die Reihen. Scheitert der zweite Aufruf, muss
der Grund erkennbar bleiben. Ein 4xx ist ein Urteil über diese Anfrage, etwa
die Ablehnung fremder Kanäle durch analytics, und geht deshalb unverändert
an den Browser. Würde es zu 502, sähe eine korrekte Mandantenablehnung wie
ein Ausfall aus, in der Oberfläche und in den Logs. Nur 5xx und
Verbindungsfehler bedeuten wirklich, dass der Dienst nicht da ist.

## 5. Profil und aktiver Mandant `fetchProfile`

[lib/auth/AuthContext.tsx#L70-L117](../../../applications/frontend/lib/auth/AuthContext.tsx#L70-L117)

```ts
const fetchProfile = useCallback(async () => {
  const response = await fetch("/api/v1/me", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    setBackendProfile(null);
    setTenants([]);
    return;
  }
  const data: { user: UserProfile; tenants: TenantMembership[] } = await response.json();
  setBackendProfile(data.user);
  setTenants(data.tenants);

  const stored = localStorage.getItem(ACTIVE_TENANT_KEY);
  if (stored && data.tenants.some((t) => t.id === stored)) {
    setActiveTenantIdState(stored);
  } else if (data.tenants.length === 1) {
    setActiveTenantIdState(data.tenants[0].id);
  }
}, []);

const setActiveTenantId = useCallback((id: string | null) => {
  setActiveTenantIdState(id);
  if (id) localStorage.setItem(ACTIVE_TENANT_KEY, id);
  else localStorage.removeItem(ACTIVE_TENANT_KEY);
}, []);
```

Alles, was der Client über den Nutzer weiß, kommt aus einer Antwort von core
und wird nie aus dem Token gelesen. Der gemerkte Mandant aus `localStorage`
gilt nur, wenn er in der aktuellen Mitgliederliste vorkommt, ein entzogener
Zugang kann also nicht per Browser-Speicher weiterleben. Aus globaler Rolle
und der Rolle im aktiven Mandanten entstehen danach die Rechte für die
Anzeige. Die Wahl `null` ist die Flottenansicht der Berater über alle
Mandanten.
