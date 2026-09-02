import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { joinProxyPath } from "@/lib/api/proxy-path";

const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://localhost:8100";

/**
 * Catch-all proxy — forwards /api/analytics/* requests to analytics-service.
 * The session JWT is forwarded as a Bearer token; the analytics service does
 * not validate it today, but can verify the shared HS256 secret if needed.
 */
async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathStr = joinProxyPath(path);
  if (pathStr === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const url = new URL(req.url);
  const target = `${ANALYTICS_URL}/${pathStr}${url.search}`;

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

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? await req.blob() : undefined,
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`Analytics proxy error: ${target}`, error);
    return NextResponse.json(
      { error: "Analytics service unavailable" },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
