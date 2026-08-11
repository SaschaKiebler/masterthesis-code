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
 * GET /api/v1/projects/{id}/measurements (analysis canvas).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const to = parseEpoch(url.searchParams.get("to")) ?? Math.floor(Date.now() / 1000);
  const from = parseEpoch(url.searchParams.get("from")) ?? to - 24 * 3600;
  const bucket = url.searchParams.has("bucket")
    ? Number(url.searchParams.get("bucket"))
    : null;
  const metricPointIds = url.searchParams.get("metricPointIds");

  try {
    const channelsResponse = await coreGet(
      req,
      `/projects/${id}/channels${
        metricPointIds ? `?metricPointIds=${encodeURIComponent(metricPointIds)}` : ""
      }`
    );
    if (!channelsResponse.ok) {
      return new NextResponse(channelsResponse.body, { status: channelsResponse.status });
    }
    const { channels } = (await channelsResponse.json()) as { channels: ChannelDto[] };
    if (!channels.length) {
      return NextResponse.json({ measurements: [], count: 0, bucketMinutes: 0 });
    }

    const seriesResponse = await analyticsPost(req, "/stats/series", {
      channels: toAnalyticsChannels(channels),
      start: from,
      end: to,
      ...bucketParams(bucket),
    });
    if (!seriesResponse.ok) {
      return downstreamError(seriesResponse, "Analytics service");
    }
    const { series, bucketSeconds } = await seriesResponse.json();
    const measurements = seriesToMeasurements(series, channels);
    return NextResponse.json({
      measurements,
      count: measurements.length,
      bucketMinutes: Math.floor((bucketSeconds ?? 0) / 60),
    });
  } catch (error) {
    console.error(`Project measurements composition failed for ${id}`, error);
    return serviceUnavailable("Measurement composition");
  }
}
