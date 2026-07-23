import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const NOTIFICATION_URL = process.env.NOTIFICATION_URL || "http://localhost:8083";

/**
 * Catch-all proxy — forwards /api/notifications/* requests to the
 * notification service (/api/v1/*). The session JWT is forwarded as a
 * Bearer token; the notification service validates it against the shared
 * HS256 secret and resolves the tenant itself.
 */
async function proxyRequest(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const pathStr = path.join("/");
  const url = new URL(req.url);
  const target = `${NOTIFICATION_URL}/api/v1/${pathStr}${url.search}`;

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
    console.error(`Notification proxy error: ${target}`, error);
    return NextResponse.json(
      { error: "Notification service unavailable" },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
