import { NextRequest, NextResponse } from "next/server";
import {
  analyticsPost,
  bucketParams,
  ChannelDto,
  coreGet,
  parseEpoch,
  seriesToMeasurements,
  serviceUnavailable,
  downstreamError,
  toAnalyticsChannels,
} from "../../../_compose/helpers";

/**
 * BFF composition for the former core endpoint
 * GET /api/v1/assets/{id}/measurements — channels from core, series from
 * analytics, legacy response shape preserved.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const to = parseEpoch(url.searchParams.get("to")) ?? Math.floor(Date.now() / 1000);
  const from = parseEpoch(url.searchParams.get("from")) ?? to - 24 * 3600;
  const bucketMinutes = url.searchParams.has("bucketMinutes")
    ? Number(url.searchParams.get("bucketMinutes"))
    : 60;
  const metrics = url.searchParams.get("metrics");

  try {
    const channelsResponse = await coreGet(
      req,
      `/assets/${id}/channels${metrics ? `?metrics=${encodeURIComponent(metrics)}` : ""}`
    );
    if (!channelsResponse.ok) {
      return new NextResponse(channelsResponse.body, { status: channelsResponse.status });
    }
    const { channels } = (await channelsResponse.json()) as { channels: ChannelDto[] };
    if (!channels.length) {
      return NextResponse.json({ measurements: [] });
    }

    const seriesResponse = await analyticsPost(req, "/stats/series", {
      channels: toAnalyticsChannels(channels),
      start: from,
      end: to,
      ...bucketParams(bucketMinutes),
    });
    if (!seriesResponse.ok) {
      return downstreamError(seriesResponse, "Analytics service");
    }
    const { series } = await seriesResponse.json();
    return NextResponse.json({ measurements: seriesToMeasurements(series, channels) });
  } catch (error) {
    console.error(`Asset measurements composition failed for ${id}`, error);
    return serviceUnavailable("Measurement composition");
  }
}
