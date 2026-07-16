import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

/**
 * POST /api/auth/login — Exchange email + password for a backend-issued JWT.
 * The token is stored in an httpOnly session cookie; the response body only
 * contains the user profile.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  try {
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
      // Secure by default in production; COOKIE_SECURE=false permits the
      // plain-HTTP evaluation deployment (LoadBalancer without TLS).
      secure:
        process.env.COOKIE_SECURE != null
          ? process.env.COOKIE_SECURE === "true"
          : process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Login proxy error:", error);
    return NextResponse.json({ error: "Backend unavailable" }, { status: 502 });
  }
}
