/**
 * BFF composition helpers (measurement-read-decoupling design §6).
 *
 * Core resolves structure down to channels; analytics owns the measurement
 * store. These routes intercept the former core measurement URLs (more
 * specific than the /api/v1 catch-all proxy), compose channels + series and
 * return the exact response shapes the components already parse — so the
 * frontend components stay unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";
const ANALYTICS_URL = process.env.ANALYTICS_URL || "http://localhost:8100";

export interface ChannelDto {
  metricPointId: string;
  deviceId: string;
  metricId: number;
  metricName: string;
  unit: string | null;
  source: string | null;
}

export interface SeriesPoint {
  bucket: number;
  value: number | null;
}

export interface ChannelSeries {
  deviceId: string;
  metricId: number;
  ref: string | null;
  points: SeriesPoint[];
}

export function authHeaders(req: NextRequest): HeadersInit {
  const headers: Record<string, string> = { accept: "application/json" };
  const authorization = req.headers.get("authorization");
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  if (authorization) {
    headers.authorization = authorization;
  } else if (sessionToken) {
    headers.authorization = `Bearer ${sessionToken}`;
  }
  return headers;
}

export async function coreGet(req: NextRequest, path: string): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/v1${path}`, { headers: authHeaders(req) });
}

export async function analyticsPost(
  req: NextRequest,
  path: string,
  body: unknown
): Promise<Response> {
  return fetch(`${ANALYTICS_URL}${path}`, {
    method: "POST",
    headers: { ...authHeaders(req), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function toAnalyticsChannels(channels: ChannelDto[]) {
  return channels.map((c) => ({
    device_id: c.deviceId,
    metric_id: c.metricId,
    ref: c.metricPointId,
  }));
}

/** bucketMinutes semantics of the former core endpoints: 0 = raw, unset = auto. */
export function bucketParams(bucketMinutes: number | null): {
  resample?: string;
  bucket_seconds?: number;
} {
  if (bucketMinutes === 0) return { resample: "raw" };
  if (bucketMinutes && bucketMinutes > 0) return { bucket_seconds: bucketMinutes * 60 };
  return {};
}

/** Flatten channel series into the legacy measurements array (time DESC). */
export function seriesToMeasurements(
  series: ChannelSeries[],
  channels: ChannelDto[]
): Array<{
  time: number;
  deviceId: string;
  metricId: number;
  metricName: string;
  value: number | null;
}> {
  const nameByChannel = new Map(
    channels.map((c) => [`${c.deviceId}|${c.metricId}`, c.metricName] as const)
  );
  const measurements = series.flatMap((s) =>
    s.points.map((p) => ({
      time: p.bucket,
      deviceId: s.deviceId,
      metricId: s.metricId,
      metricName: nameByChannel.get(`${s.deviceId}|${s.metricId}`) ?? "unknown",
      value: p.value,
    }))
  );
  measurements.sort((a, b) => b.time - a.time);
  return measurements;
}

export function parseEpoch(value: string | null): number | null {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return Math.floor(asNumber);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

export function serviceUnavailable(which: string): NextResponse {
  return NextResponse.json({ error: `${which} unavailable` }, { status: 502 });
}

/**
 * Turn a failed downstream response into the right client-facing one.
 *
 * A 4xx is a verdict about this request and must reach the caller unchanged —
 * mapping a 403 to 502 would make a correct tenant refusal look like an
 * infrastructure outage, and would hide it from anyone reading the logs. Only
 * 5xx and transport failures mean the service really is unavailable.
 */
export async function downstreamError(
  response: Response,
  which: string,
): Promise<NextResponse> {
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
