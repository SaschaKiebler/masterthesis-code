import { NextRequest, NextResponse } from "next/server";
import {
  analyticsPost,
  bucketParams,
  ChannelDto,
  coreGet,
  parseEpoch,
  seriesToMeasurements,
  serviceUnavailable,
  toAnalyticsChannels,
} from "../../../_compose/helpers";

/**
 * BFF composition for the former core endpoint
 * GET /api/v1/sites/{siteId}/measurements (dashboard health freshness).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ siteId: string }> }
) {
  const { siteId } = await params;
  const url = new URL(req.url);
  const to = parseEpoch(url.searchParams.get("to")) ?? Math.floor(Date.now() / 1000);
  const from = parseEpoch(url.searchParams.get("from")) ?? to - 24 * 3600;
  const bucketMinutes = url.searchParams.has("bucketMinutes")
    ? Number(url.searchParams.get("bucketMinutes"))
    : null;

  try {
    const channelsResponse = await coreGet(req, `/sites/${siteId}/channels`);
    if (!channelsResponse.ok) {
      return new NextResponse(channelsResponse.body, { status: channelsResponse.status });
    }
    const { channels } = (await channelsResponse.json()) as { channels: ChannelDto[] };
    if (!channels.length) {
      return NextResponse.json({ measurements: [], bucketMinutes: 0, count: 0 });
    }

    const seriesResponse = await analyticsPost(req, "/stats/series", {
      channels: toAnalyticsChannels(channels),
      start: from,
      end: to,
      ...bucketParams(bucketMinutes),
    });
    if (!seriesResponse.ok) {
      return serviceUnavailable("Analytics service");
    }
    const { series, bucketSeconds } = await seriesResponse.json();
    const measurements = seriesToMeasurements(series, channels);
    return NextResponse.json({
      measurements,
      bucketMinutes: Math.floor((bucketSeconds ?? 0) / 60),
      count: measurements.length,
    });
  } catch (error) {
    console.error(`Site measurements composition failed for ${siteId}`, error);
    return serviceUnavailable("Measurement composition");
  }
}
