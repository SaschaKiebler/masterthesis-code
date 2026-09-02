import { NextRequest, NextResponse } from "next/server";
import {
  analyticsPost,
  bucketParams,
  coreGet,
  parseEpoch,
  serviceUnavailable,
  downstreamError,
} from "../../../_compose/helpers";

interface QuantityChannel {
  siteId: string;
  siteName: string;
  deviceId: string;
  metricId: number;
}

/**
 * BFF composition for the former core endpoint
 * GET /api/v1/projects/{id}/compare — per-site average series for one
 * physical quantity, composed from quantity channels + analytics series.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const quantityName = url.searchParams.get("quantityName");
  if (!quantityName) {
    return NextResponse.json({ message: "quantityName is required" }, { status: 400 });
  }
  const to = parseEpoch(url.searchParams.get("to")) ?? Math.floor(Date.now() / 1000);
  const from = parseEpoch(url.searchParams.get("from")) ?? to - 24 * 3600;
  const bucket = url.searchParams.has("bucket") ? Number(url.searchParams.get("bucket")) : 60;

  try {
    const channelsResponse = await coreGet(
      req,
      `/projects/${encodeURIComponent(id)}/quantity-channels?quantityName=${encodeURIComponent(quantityName)}`
    );
    if (!channelsResponse.ok) {
      return new NextResponse(channelsResponse.body, { status: channelsResponse.status });
    }
    const { channels } = (await channelsResponse.json()) as { channels: QuantityChannel[] };
    if (!channels.length) {
      return NextResponse.json({ series: [] });
    }

    const seriesResponse = await analyticsPost(req, "/stats/series", {
      channels: channels.map((c) => ({ device_id: c.deviceId, metric_id: c.metricId })),
      start: from,
      end: to,
      ...bucketParams(bucket),
    });
    if (!seriesResponse.ok) {
      return downstreamError(seriesResponse, "Analytics service");
    }
    const { series } = (await seriesResponse.json()) as {
      series: Array<{
        deviceId: string;
        metricId: number;
        points: Array<{ bucket: number; value: number | null }>;
      }>;
    };

    // Average across a site's channels per bucket (the former SQL grouped by
    // bucket + site over all matching channels).
    const siteByChannel = new Map(
      channels.map((c) => [`${c.deviceId}|${c.metricId}`, c] as const)
    );
    const perSite = new Map<string, { siteName: string; buckets: Map<number, number[]> }>();
    for (const s of series) {
      const channel = siteByChannel.get(`${s.deviceId}|${s.metricId}`);
      if (!channel) continue;
      const site = perSite.get(channel.siteId) ?? {
        siteName: channel.siteName,
        buckets: new Map<number, number[]>(),
      };
      for (const p of s.points) {
        if (p.value === null) continue;
        const values = site.buckets.get(p.bucket) ?? [];
        values.push(p.value);
        site.buckets.set(p.bucket, values);
      }
      perSite.set(channel.siteId, site);
    }

    const result = [...perSite.entries()].map(([siteId, site]) => ({
      siteId,
      siteName: site.siteName,
      measurements: [...site.buckets.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([time, values]) => ({
          time,
          value: values.reduce((sum, v) => sum + v, 0) / values.length,
        })),
    }));
    result.sort((a, b) => a.siteName.localeCompare(b.siteName));
    return NextResponse.json({ series: result });
  } catch (error) {
    console.error(`Project comparison composition failed for ${id}`, error);
    return serviceUnavailable("Measurement composition");
  }
}
