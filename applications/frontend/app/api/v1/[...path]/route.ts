import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { joinProxyPath } from "@/lib/api/proxy-path";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

/**
 * Catch-all API proxy — forwards /api/v1/* requests to core-platform at runtime.
 * Uses BACKEND_URL env var (server-side only, set via docker-compose).
 * The session JWT from the httpOnly cookie is forwarded as a Bearer token.
 */
async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathStr = joinProxyPath(path);
  if (pathStr === null) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const url = new URL(req.url);
  const target = `${BACKEND_URL}/api/v1/${pathStr}${url.search}`;

  // Only forward essential headers — cookies stay at the proxy boundary
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
    // Remove transfer-encoding as Next.js handles this
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`API proxy error: ${target}`, error);
    return NextResponse.json(
      { error: "Backend unavailable" },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
