import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * GET /auth/logout — Clear the session cookie and return to the login page.
 * Kept as a plain link target so existing <a href="/auth/logout"> usages work.
 */
export async function GET(req: NextRequest) {
  const response = NextResponse.redirect(new URL("/auth/login", req.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
